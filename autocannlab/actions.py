"""动作实现。红线（见 .agents/memory/risk-policy-and-scope.md）：

- 只做用户审定范围内的动作；每个动作先查任务状态，已完成即跳过（幂等）。
- star 类领分后一律取消 star。
- 不做：push/建仓、资料修改、赛事报名、课程学习、每日分享、事件型任务。
"""

import json
import logging
import random
import time

import httpx

from . import config, tasks
from .client import ApiError, GitCodeClient

log = logging.getLogger(__name__)

# 每日任务与 star 目标相关任务的任务 ID（2026-10-06 抓包固化，见 memory/gitcode-task-inventory.md）
TASK_SIGNIN = 1
TASK_DAILY_STAR = 62
TASK_DAILY_VIEW = 59
TASK_CANN_VISIT = 96

# star 轮换池：star/unstar 对账号无副作用的大项目，避免长期盯同一仓库
STAR_POOL = [
    "cann/cann-samples",
    "cann/cann-recipes-train",
    "cann/cann-recipes-infer",
    "cann/cannbot-skills",
]


def pause() -> None:
    """动作间拟人间隔。"""
    time.sleep(random.uniform(*config.ACTION_DELAY_RANGE))


def load_state() -> dict:
    try:
        return json.loads(config.STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def save_state(state: dict) -> None:
    config.STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                                 encoding="utf-8")


def _find_task(tasks_list: list[dict], task_id: int) -> dict | None:
    return next((t for t in tasks_list if t.get("task_id") == task_id), None)


def _task_done(tasks_list: list[dict], task_id: int) -> bool:
    t = _find_task(tasks_list, task_id)
    return bool(t and t.get("current_count", 0) >= t.get("need_count", 1))


def visit_cann_community(client: GitCodeClient) -> str:
    """D1：访问 CANN 社区页面。规则明文「访问任意页面即得」，服务端 1h 内自动结算。"""
    resp = client.request("GET", "/cann", api_base=config.SITE_BASE)
    if resp.status_code != 200:
        return f"失败: HTTP {resp.status_code}"
    return "已访问 /cann（自动结算，1h 内入账）"


def do_signin(client: GitCodeClient) -> str:
    """D2：每日签到。签到状态以 sign_status 为准；未签到时尝试 POST /task/1/points。"""
    status = tasks.sign_status(client)
    if status.get("is_sign_in"):
        return "今日已签到"
    ok, msg = tasks.claim(client, TASK_SIGNIN)
    after = tasks.sign_status(client)
    if after.get("is_sign_in"):
        return "签到成功"
    return f"签到未生效（claim={ok}, msg={msg}）——签到端点形态待明日复测"


def _project_id_by_path(client: GitCodeClient, path: str) -> str | None:
    """仓库全路径 → 数字 id。star 接口两者皆可，但用 id 更接近前端真实调用。"""
    try:
        body = client.get_json(f"/api/v2/projects/{path.replace('/', '%2F')}")
    except ApiError:
        return None
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    pid = data.get("id") or data.get("project_id")
    return str(pid) if pid else None


def star_daily(client: GitCodeClient) -> str:
    """D3：star → 等结算 → 领分 → unstar。全程幂等；中断时通过 runtime 状态续接。"""
    task_list = tasks.all_tasks(client)
    state = load_state()

    # 上次运行遗留：star 已打但未走完领分+取消，先续接
    pending = state.get("pending_unstar")
    if pending:
        pid = pending.get("project_id")
        ok, msg = tasks.claim(client, TASK_DAILY_STAR)
        _unstar(client, pending.get("path"), pid)
        state.pop("pending_unstar", None)
        save_state(state)
        if ok:
            return f"续接上次 star（{pending.get('path')}）：领分成功，已取消 star"
        return f"续接上次 star（{pending.get('path')}）：领分未成功（{msg}），已取消 star"

    if _task_done(task_list, TASK_DAILY_STAR):
        return "今日 star 任务已完成，跳过"

    path = random.choice(STAR_POOL)
    pid = _project_id_by_path(client, path)
    if pid is None:
        return f"失败: 无法解析项目 id（{path}）"

    resp = client.post_json(f"/api/v2/projects/{pid}/star")
    log.info("已 star %s（id=%s）", path, pid)

    # 等待服务端结算 current_count 翻转
    deadline = time.time() + config.SETTLE_TIMEOUT_S
    settled = False
    while time.time() < deadline:
        time.sleep(config.SETTLE_POLL_INTERVAL_S)
        fresh = tasks.list_tasks(client, 1)
        if _task_done(fresh, TASK_DAILY_STAR):
            settled = True
            break

    if not settled:
        # 结算未到（最长 1h）：保留 star，落盘状态，明日续接领取+取消
        state["pending_unstar"] = {"path": path, "project_id": pid, "date": time.strftime("%F")}
        save_state(state)
        return f"star {path} 已打，服务端结算超时（>{int(config.SETTLE_TIMEOUT_S)}s），明日续接领分并取消"

    ok, msg = tasks.claim(client, TASK_DAILY_STAR)
    _unstar(client, path, pid)
    return f"star {path} → 结算完成 → 领分{'成功' if ok else f'失败（{msg}）'} → 已取消 star"


def _unstar(client: GitCodeClient, path: str | None, pid) -> None:
    try:
        client.post_json(f"/api/v2/projects/{pid}/unstar")
        log.info("已 unstar %s（id=%s）", path, pid)
    except ApiError as e:
        # 取消失败要留痕：star 留在账号上比重复操作更糟
        log.error("unstar 失败（%s, id=%s）: %s", path, pid, e)


def view_recommended(client: GitCodeClient) -> str:
    """D4：浏览推荐/热门项目（访问推荐接口 + 打开一个项目页）。"""
    path = random.choice(STAR_POOL)
    try:
        client.get_json(f"/api/v2/projects/{path.replace('/', '%2F')}")
    except ApiError as e:
        return f"失败: {e.message}"
    resp = client.request("GET", f"/{path}", api_base=config.SITE_BASE)
    if resp.status_code != 200:
        return f"失败: 项目页 HTTP {resp.status_code}"
    return f"已浏览 {path}（结算方式待验证）"


def claim_all(client: GitCodeClient) -> str:
    """D7：扫全部任务类型，领取「已达条件且待领取」的奖励（含用户人工完成后的代领）。

    注意：领取窗口有限（2026-10-06 实测：三月完成的任务已报「已超过可领取次数」），
    所以本步骤必须每天跑，当天完成的当天领。
    """
    # 先看汇总（接口直接返回数字），为 0 时跳过扫描，省一轮全类型翻页
    unclaimed = tasks.unclaimed_rewards(client)
    total = unclaimed.get("total", unclaimed) if isinstance(unclaimed, dict) else unclaimed
    try:
        if int(total or 0) == 0:
            return "无待领取奖励"
    except (TypeError, ValueError):
        pass

    task_list = tasks.all_tasks(client)
    claimable = tasks.claimable_tasks(task_list)
    if not claimable:
        return "无待领取奖励"
    lines = []
    for t in claimable:
        pause()
        ok, msg = tasks.claim(client, t["task_id"])
        if ok:
            lines.append(f"#{t['task_id']} {t.get('cn_name')}(+{t.get('score')}): 成功")
        elif _is_noop_claim_error(msg):
            log.debug("任务 %s 无需领取: %s", t["task_id"], msg)
        else:
            lines.append(f"#{t['task_id']} {t.get('cn_name')}: 未领（{msg}）")
    return "; ".join(lines) if lines else "无待领取奖励"


# 无害的领取失败：任务条件未达成，或奖励已被领取/窗口已过——静默跳过
_NOOP_CLAIM_PATTERNS = ("任务未完成", "已超过可领取次数", "已领取")


def _is_noop_claim_error(message: str) -> bool:
    return any(p in message for p in _NOOP_CLAIM_PATTERNS)


DAILY_STEPS = [
    ("D1 访问CANN社区", visit_cann_community),
    ("D2 签到", do_signin),
    ("D3 每日star", star_daily),
    ("D4 浏览推荐", view_recommended),
    ("D7 扫表领取", claim_all),
]


def run_daily(client: GitCodeClient) -> None:
    for name, fn in DAILY_STEPS:
        try:
            result = fn(client)
        except ApiError as e:
            result = f"失败: {e}"
        except httpx.HTTPError as e:
            result = f"网络错误: {e}"
        log.info("[%s] %s", name, result)
        pause()


def run_full(client: GitCodeClient) -> None:
    """首次模式：daily 全量 + 已批准的一次性项（oneoff 模块）+ 取关 CANN 组织。"""
    run_daily(client)
    from . import oneoff
    oneoff.run_oneoff(client)
    log.info("[F9 取关CANN] %s", unfollow_cann(client))


def unfollow_cann(client: GitCodeClient) -> str:
    """取关 CANN 组织（用户已批准：奖励已入账，取关无影响）。幂等。"""
    username = client.username
    if not username:
        return "凭证文件缺少 username 字段，跳过"
    followed = client.get_json(
        "/uc/api/v1/follow/hasFollowed",
        params={"username": username, "otherUsername": "cann", "followType": 1},
    )
    # 接口直接返回布尔值（实测 false），兼容包一层 data 的情况
    if isinstance(followed, dict):
        followed = followed.get("data", followed)
    if not followed:
        return "未关注，跳过"
    client.delete_json("/uc/api/v1/follow",
                       params={"unfollowUsername": "cann", "followType": 1})
    return "已取关 CANN 组织"
