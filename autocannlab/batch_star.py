"""Star 积分批量任务：批量 star CANN org 项目赚积分，结算后自动逐个取消。

安全设计（2026-10-13 用户审定）：
- 手动触发，永不进 daily/full 调度；
- 拟人化：随机顺序、star 前先浏览项目页、动作间长随机间隔、批次间休整；
- 只取消本功能打出的 star（stars.json 按 source=batch 记账），不碰用户手动 star；
- 全程与 daily/full 共享 manager 的全局串行锁。

积分机制（task 104 cann-star-project-v2）：每 star 一个 CANN 项目 +50，
服务端 1 小时内自动结算（estimated=0，无需领取调用）；项目可重复得（每项目一次）。
"""

import logging
import random
import threading
import time

from .client import ApiError, GitCodeClient
from .config import SITE_BASE
from . import tasks as task_api

log = logging.getLogger(__name__)

TASK_CANN_STAR = 104
CANN_ORG = "cann"

# 拟人节奏（秒）：覆盖 85 项目约需 2.5-4 小时，刻意慢
BROWSE_DELAY_RANGE = (8.0, 25.0)      # 浏览项目页之后、点 star 之前
STAR_DELAY_RANGE = (20.0, 70.0)       # 相邻两次 star 之间
REST_EVERY = (6, 12)                  # 每打 N 个 star 随机休整一次
REST_RANGE = (120.0, 360.0)           # 休整时长
UNSTAR_DELAY_RANGE = (6 * 3600, 15 * 3600)  # star 后 6-15 小时才取消（结算+积分到账）
UNSTAR_GAP_RANGE = (25.0, 90.0)       # 取消之间的间隔

# 批次中断检查间隔：run 被外部标记取消/服务重启时及时退出
_STOP_CHECK_INTERVAL_S = 5.0


def list_cann_projects(client: GitCodeClient) -> list[dict]:
    """拉取 CANN org 全部项目（自动翻页）。字段取 id + path_with_namespace。"""
    out: list[dict] = []
    page = 1
    while True:
        body = client.get_json(
            f"/api/v1/groups/{CANN_ORG}/projects",
            params={"page": page, "per_page": 50},
        )
        content = body.get("content") or []
        out.extend({"id": p["id"], "path": p.get("path_with_namespace") or p["path"],
                    "archived": p.get("archived", False)}
                   for p in content)
        if page >= (body.get("page_count") or 1):
            return out
        page += 1


def start(manager, account_id: str, project_ids: list[int] | None = None) -> str:
    """启动一次批量 star 运行（后台线程）。project_ids=None 表示全部未 star 项目。
    返回 run_id；与 daily/full 互斥（复用 manager.run_lock）。"""
    account = manager.store.get_account(account_id)
    if account is None:
        raise KeyError(f"账号不存在: {account_id}")
    if not account.get("enabled", True):
        raise RuntimeError("账号已暂停")
    if not manager.run_lock.acquire(blocking=False):
        raise RuntimeError("已有任务在执行中（全局串行）")

    already = {s["project_id"] for s in manager.store.list_stars(account_id)}
    run_id = f"bs{int(time.time())}-{account_id[:6]}"
    run = {
        "id": run_id, "account_id": account_id,
        "username": account.get("username"), "kind": "batch_star",
        "status": "running",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "finished_at": None, "log": [], "summary": None,
        "progress": {"total": 0, "done": 0, "starred": 0, "skipped": 0, "failed": 0},
        "cancel_requested": False,
    }
    manager.runs[run_id] = run
    manager.runs_order.append(run_id)
    del manager.runs_order[:-30]
    thread = threading.Thread(
        target=_batch_thread, args=(manager, run, account, project_ids, already),
        daemon=True, name=f"batch-star-{run_id}")
    thread.start()
    return run_id


def request_cancel(manager, run_id: str) -> bool:
    """请求中断当前批量运行（优雅：当前动作完成后退出，已 star 的照常进取消队列）。"""
    run = manager.runs.get(run_id)
    if run is None or run.get("kind") != "batch_star":
        return False
    run["cancel_requested"] = True
    return True


def _cancelled(run) -> bool:
    return run.get("cancel_requested") or run["status"] != "running"


def _sleep_interruptible(run, seconds: float) -> bool:
    """可中断 sleep；返回 False 表示已被请求中止。"""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if _cancelled(run):
            return False
        time.sleep(min(_STOP_CHECK_INTERVAL_S, max(0.0, deadline - time.time())))
    return not _cancelled(run)


def _batch_thread(manager, run, account, project_ids, already) -> None:
    capture = _make_capture(run)
    root = logging.getLogger()
    root.addHandler(capture)
    client = None
    try:
        client = manager.build_client(account)
        client.prepare()

        all_projects = list_cann_projects(client)
        by_id = {p["id"]: p for p in all_projects}
        if project_ids is None:
            targets = [p for p in all_projects if p["id"] not in already and not p["archived"]]
        else:
            targets = [by_id[i] for i in project_ids
                       if i in by_id and i not in already]
        run["progress"]["total"] = len(targets)
        if not targets:
            run["summary"] = "没有可 star 的新项目（全部已打过或不存在）"
            run["status"] = "ok"
            return
        run["log"].append({"time": _now(), "level": "info",
                           "message": f"批量 star 启动：{len(targets)} 个项目（org 共 {len(all_projects)}，已打过 {len(already)}）"})

        # 随机顺序：避免按目录序规律扫描
        random.shuffle(targets)
        starred_paths: list[tuple[int, str]] = []  # (project_id, path)

        rest_after = random.randint(*REST_EVERY)
        since_rest = 0
        for idx, proj in enumerate(targets, 1):
            if _cancelled(run):
                run["log"].append({"time": _now(), "level": "info",
                                   "message": "收到中止请求，提前收尾"})
                break
            pid, path = proj["id"], proj["path"]

            # 拟人：先像真人一样打开项目页，停一会儿，再点 star
            try:
                client.request("GET", f"/{path}", api_base=SITE_BASE)
            except ApiError as e:
                run["log"].append({"time": _now(), "level": "warning",
                                   "message": f"{path} 项目页打开失败（{e.message}），跳过"})
                run["progress"]["failed"] += 1
                run["progress"]["done"] += 1
                continue
            if not _sleep_interruptible(run, random.uniform(*BROWSE_DELAY_RANGE)):
                break

            try:
                client.post_json(f"/api/v2/projects/{pid}/star")
            except ApiError as e:
                run["log"].append({"time": _now(), "level": "error",
                                   "message": f"star {path} 失败: {e.message}"})
                run["progress"]["failed"] += 1
                run["progress"]["done"] += 1
                continue
            manager.store.add_star(account["id"], pid, path, source="batch")
            starred_paths.append((pid, path))
            run["progress"]["starred"] += 1
            run["progress"]["done"] += 1
            run["log"].append({"time": _now(), "level": "info",
                               "message": f"[{idx}/{len(targets)}] 已 star {path}（积分将自动结算 +50）"})

            since_rest += 1
            if since_rest >= rest_after and idx < len(targets):
                gap = random.uniform(*REST_RANGE)
                run["log"].append({"time": _now(), "level": "info",
                                   "message": f"休整 {int(gap/60)} 分钟（模拟真人节奏）"})
                rest_after = random.randint(*REST_EVERY)
                since_rest = 0
                if not _sleep_interruptible(run, gap):
                    break
            elif idx < len(targets):
                if not _sleep_interruptible(run, random.uniform(*STAR_DELAY_RANGE)):
                    break

        # 已打出的 star 全部登记延迟取消（持久化在 store，重启不丢）
        now = time.time()
        for pid, path in starred_paths:
            due = now + random.uniform(*UNSTAR_DELAY_RANGE)
            manager.store.enqueue_unstar(account["id"], pid, path, due)
        if starred_paths:
            manager.unstar_wakeup.set()
        run["summary"] = (f"star {run['progress']['starred']} 个，失败/跳过 {run['progress']['failed'] + run['progress']['skipped']} 个，"
                          f"预计 +{run['progress']['starred'] * 50} 积分；取消队列已登记（6-15h 后逐个取消）")
        run["status"] = "ok"
    except ApiError as e:
        run["status"] = "error"
        run["summary"] = f"API 错误: {e.message}"[:200]
        log.error("[batch-star/%s] API 错误: %s", account.get("username"), e)
    except Exception as e:  # noqa: BLE001 —— 后台线程异常要完整落日志
        run["status"] = "error"
        run["summary"] = f"异常: {e}"[:200]
        log.exception("[batch-star/%s] 执行异常", account.get("username"))
    finally:
        if capture is not None:
            root.removeHandler(capture)
        run["finished_at"] = _now()


def _make_capture(run) -> "logging.Handler | None":
    """日志捕获器与 manager._RunCapture 行为一致，但写入 batch run 的 log。"""
    from .manager import _RunCapture
    return _RunCapture(run["log"])


def _now() -> str:
    return time.strftime("%H:%M:%S")


# ---------- 取消队列 ----------

def process_unstar_queue(manager) -> None:
    """unstar 后台循环：到期一个取消一个，带拟人间隔。
    仅处理 source=batch 的记录；非 batch（用户手动 star）永不触碰。"""
    while not manager._unstar_stop.wait(60):
        try:
            due = [s for s in manager.store.list_stars()
                   if s.get("source") == "batch" and not s.get("unstarred")
                   and (s.get("unstar_due") or 0) <= time.time()]
            if not due:
                manager.unstar_wakeup.wait(timeout=600)
                manager.unstar_wakeup.clear()
                continue
            account_cache: dict[str, GitCodeClient | None] = {}
            for rec in due:
                if manager._unstar_stop.is_set():
                    return
                aid = rec["account_id"]
                client = account_cache.get(aid)
                if client is None:
                    account = manager.store.get_account(aid)
                    if account is None:
                        manager.store.mark_unstarred(aid, rec["project_id"])
                        continue
                    client = manager.build_client(account)
                    try:
                        client.prepare()
                    except Exception:  # noqa: BLE001 —— 单账号失败不拖垮队列
                        log.warning("[unstar] 账号 %s prepare 失败，跳过本轮", aid)
                        client = None
                    account_cache[aid] = client
                if client is None:
                    continue
                try:
                    client.post_json(f"/api/v2/projects/{rec['project_id']}/unstar")
                    manager.store.mark_unstarred(aid, rec["project_id"])
                    log.info("[unstar] 已取消 star %s（id=%s）", rec["path"], rec["project_id"])
                except ApiError as e:
                    # 项目 404（已删仓）也视为完成；其他错误留待下轮重试
                    if e.status == 404:
                        manager.store.mark_unstarred(aid, rec["project_id"])
                    else:
                        log.warning("[unstar] %s 取消失败: %s", rec["path"], e)
                time.sleep(random.uniform(*UNSTAR_GAP_RANGE))
        except Exception:  # noqa: BLE001 —— 队列循环永不退出
            log.exception("[unstar] 队列循环异常")
