"""Star 积分批量任务：批量 star CANN org 项目赚积分，结算后自动逐个取消。

交互模型（2026-10-13 用户审定）：
- 用户在 UI 点项目旁的 star 图标 → 项目进入待 star 队列（stars.json 持久化）；
- 队列常驻后台自动执行：非空即逐个处理（拟人化节奏），无需手动点「执行」；
- 队列可暂停/继续；暂停时当前项目完成后停下，剩余项留在队列；
- star 成功即登记延迟取消（随机 6-15 小时），取消队列只处理 source=batch 的记录，
  绝不触碰用户手动 star 的项目；
- 项目清单缓存在服务端（cann-projects.json），仅用户点「更新清单」时才请求 GitCode；
- 全程与 daily/full 共享 manager.run_lock 全局串行。

积分机制（task 104 cann-star-project-v2）：每 star 一个 CANN 项目 +50，
服务端 1 小时内自动结算（estimated=0）；每项目一次，可跨项目重复得。
"""

import logging
import random
import time

from .client import ApiError, GitCodeClient
from .config import SITE_BASE

log = logging.getLogger(__name__)

CANN_ORG = "cann"

# 拟人节奏（秒）：覆盖 85 项目约需 2.5-4 小时，刻意慢
BROWSE_DELAY_RANGE = (8.0, 25.0)      # 打开项目页之后、点 star 之前
STAR_DELAY_RANGE = (20.0, 70.0)       # 相邻两次 star 之间
REST_EVERY = (6, 12)                  # 每打 N 个 star 随机休整一次
REST_RANGE = (120.0, 360.0)           # 休整时长
UNSTAR_DELAY_RANGE = (6 * 3600, 15 * 3600)  # star 后 6-15 小时才取消
UNSTAR_GAP_RANGE = (25.0, 90.0)       # 取消之间的间隔

_STOP_CHECK_INTERVAL_S = 5.0
_QUEUE_POLL_INTERVAL_S = 10.0


def list_cann_projects(client: GitCodeClient) -> list[dict]:
    """拉取 CANN org 全部项目（自动翻页）。"""
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


def _now() -> str:
    return time.strftime("%H:%M:%S")


def _new_run(manager, account: dict) -> dict:
    run_id = f"bs{int(time.time())}-{account['id'][:6]}"
    run = {
        "id": run_id, "account_id": account["id"],
        "username": account.get("username"), "kind": "batch_star",
        "status": "running",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "finished_at": None, "log": [], "summary": None,
        "progress": {"total": 0, "done": 0, "starred": 0, "failed": 0},
        "cancel_requested": False,
    }
    manager.runs[run_id] = run
    manager.runs_order.append(run_id)
    del manager.runs_order[:-30]
    return run


def _finished_log(run, summary: str) -> None:
    run["summary"] = summary
    run["status"] = "ok"
    run["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")


# ---------- 待 star 队列 worker ----------

def queue_worker(manager) -> None:
    """常驻后台：任何账号的待 star 队列非空且未暂停时，自动逐个执行。"""
    while not manager._unstar_stop.wait(_QUEUE_POLL_INTERVAL_S):
        try:
            account_ids = {s["account_id"] for s in manager.store.list_stars()
                           if s.get("source") == "batch" and s.get("status") == "queued"}
            for account_id in account_ids:
                if manager._unstar_stop.is_set():
                    return
                if account_id in manager.queue_paused:
                    continue
                account = manager.store.get_account(account_id)
                if account is None or not account.get("enabled", True):
                    continue
                if not manager.run_lock.acquire(blocking=False):
                    break  # daily/full 在跑，下轮再看
                try:
                    _process_queue(manager, account)
                finally:
                    manager.run_lock.release()
        except Exception:  # noqa: BLE001 —— worker 永不退出
            log.exception("[batch-star] 队列 worker 异常")


def _process_queue(manager, account: dict) -> None:
    """消费一个账号的待 star 队列，直到清空、暂停或中止。"""
    run = _new_run(manager, account)
    capture = _make_capture(run)
    root = logging.getLogger()
    root.addHandler(capture)
    client = None
    try:
        client = manager.build_client(account)
        client.prepare()
        run["log"].append({"time": _now(), "level": "info",
                           "message": "待 star 队列开始执行（拟人化节奏）"})
        rest_after = random.randint(*REST_EVERY)
        since_rest = 0
        processed = 0

        while True:
            if run["cancel_requested"] or account["id"] in manager.queue_paused:
                run["log"].append({"time": _now(), "level": "info",
                                   "message": "队列已暂停，剩余项目留在队列中"})
                _finished_log(run, f"已暂停（本次 star {run['progress']['starred']} 个）")
                return
            queued = manager.store.queued_projects(account["id"])
            if not queued:
                break
            rec = queued[0]
            pid, path = rec["project_id"], rec["path"]
            run["progress"]["total"] += 1

            # 拟人：先像真人一样打开项目页，停一会儿，再点 star
            try:
                client.request("GET", f"/{path}", api_base=SITE_BASE)
            except ApiError as e:
                run["log"].append({"time": _now(), "level": "warning",
                                   "message": f"{path} 项目页打开失败（{e.message}），跳过"})
                _finish_item(manager, account, rec, run, starred=False)
                run["progress"]["failed"] += 1
                run["progress"]["done"] += 1
                continue
            if not _sleep_interruptible(run, random.uniform(*BROWSE_DELAY_RANGE)):
                continue

            try:
                client.post_json(f"/api/v2/projects/{pid}/star")
            except ApiError as e:
                run["log"].append({"time": _now(), "level": "error",
                                   "message": f"star {path} 失败: {e.message}"})
                _finish_item(manager, account, rec, run, starred=False)
                run["progress"]["failed"] += 1
                run["progress"]["done"] += 1
                continue

            # star 成功：登记 star 时间并排入延迟取消（点一个记一个）
            manager.store.mark_starred(account["id"], pid)
            manager.store.enqueue_unstar(
                account["id"], pid, path,
                time.time() + random.uniform(*UNSTAR_DELAY_RANGE))
            manager.unstar_wakeup.set()
            run["progress"]["starred"] += 1
            run["progress"]["done"] += 1
            processed += 1
            run["log"].append({"time": _now(), "level": "info",
                               "message": f"已 star {path}（+50 积分将自动结算，"
                                          f"6-15 小时后自动取消）"})

            since_rest += 1
            if since_rest >= rest_after:
                gap = random.uniform(*REST_RANGE)
                run["log"].append({"time": _now(), "level": "info",
                                   "message": f"休整 {int(gap / 60)} 分钟（模拟真人节奏）"})
                rest_after = random.randint(*REST_EVERY)
                since_rest = 0
                if not _sleep_interruptible(run, gap):
                    run["log"].append({"time": _now(), "level": "info",
                                       "message": "队列已暂停，剩余项目留在队列中"})
                    _finished_log(run, f"已暂停（本次 star {run['progress']['starred']} 个）")
                    return
            elif not _sleep_interruptible(run, random.uniform(*STAR_DELAY_RANGE)):
                run["log"].append({"time": _now(), "level": "info",
                                   "message": "队列已暂停，剩余项目留在队列中"})
                _finished_log(run, f"已暂停（本次 star {run['progress']['starred']} 个）")
                return

        _finished_log(run, f"队列已清空（本次 star {run['progress']['starred']} 个，"
                           f"失败 {run['progress']['failed']} 个）")
    except ApiError as e:
        run["status"] = "error"
        run["summary"] = f"API 错误: {e.message}"[:200]
        run["finished_at"] = _now()
        log.error("[batch-star/%s] API 错误: %s", account.get("username"), e)
    except Exception as e:  # noqa: BLE001 —— 后台线程异常要完整落日志
        run["status"] = "error"
        run["summary"] = f"异常: {e}"[:200]
        run["finished_at"] = _now()
        log.exception("[batch-star/%s] 执行异常", account.get("username"))
    finally:
        if capture is not None:
            root.removeHandler(capture)


def _finish_item(manager, account, rec, run, *, starred: bool) -> None:
    """失败/跳过的队列项也要离开队列（status=starred 会让它进取消流程？不——
    失败项直接置为 starred 会误触发取消。这里用 unstarred=True 标记终结，
    语义是「本批次不再处理」；star 没打上，无积分也不会取消。"""
    manager.store.abandon_queue_item(account["id"], rec["project_id"])
    _ = starred


def _sleep_interruptible(run, seconds: float) -> bool:
    """可中断 sleep；返回 False 表示已被请求暂停/中止。"""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if run.get("cancel_requested"):
            return False
        time.sleep(min(_STOP_CHECK_INTERVAL_S, max(0.0, deadline - time.time())))
    return not run.get("cancel_requested")


def _make_capture(run):
    from .manager import _RunCapture
    return _RunCapture(run["log"])


# ---------- 取消队列 ----------

def process_unstar_queue(manager) -> None:
    """unstar 后台循环：到期一个取消一个，带拟人间隔。
    仅处理 source=batch 的记录；非 batch（用户手动 star）永不触碰。"""
    while not manager._unstar_stop.wait(60):
        try:
            due = [s for s in manager.store.list_stars()
                   if s.get("source") == "batch" and s.get("status") == "starred"
                   and not s.get("unstarred")
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
