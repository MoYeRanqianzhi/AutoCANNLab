"""任务系统接口：任务列表、奖励领取、签到状态、余额查询。"""

import logging

from .client import ApiError, GitCodeClient

log = logging.getLogger(__name__)

# 任务类型（GET /uc/api/v1/task 的 type 参数）：
# 0=成长任务 1=积分任务 2=仓颉任务 4=CANN 任务；3 与 5 未见实例，探测时容错跳过
TASK_TYPES = (0, 1, 2, 3, 4, 5)

# status 字段：1=已达完成条件（estimated=1 时可领取），2=未完成
STATUS_REACHED = 1
# period 字段：4=每日重置 3=每周 1=每月 0=一次性
PERIOD_DAILY = 4


def list_tasks(client: GitCodeClient, task_type: int, per_page: int = 50) -> list[dict]:
    """拉取某一类型的全部任务（自动翻页）。类型不存在或非法时返回空列表。"""
    out: list[dict] = []
    page = 1
    while True:
        try:
            body = client.get_json(
                "/uc/api/v1/task",
                params={"type": task_type, "page": page, "per_page": per_page},
            )
        except ApiError as e:
            # 不存在的类型返回 400/空，属正常探测路径
            log.debug("任务类型 %s 拉取失败: %s", task_type, e)
            return out
        content = body.get("content") or []
        out.extend(content)
        if page >= (body.get("page_count") or 1):
            return out
        page += 1


def all_tasks(client: GitCodeClient) -> list[dict]:
    out: list[dict] = []
    for t in TASK_TYPES:
        out.extend(list_tasks(client, t))
    return out


def claim(client: GitCodeClient, task_id: int) -> tuple[bool, str]:
    """领取任务奖励。返回 (是否成功, 说明)。

    已知业务错误：1002 ILLEGAL_OPERATION「任务未完成」（条件未达成）。
    其他「已领取」类错误同样归为不成功但不视为异常。
    """
    try:
        body = client.post_json(f"/uc/api/v1/task/{task_id}/points", body={})
    except ApiError as e:
        return False, e.message
    err = body.get("error_code")
    if err not in (None, 0, "0"):
        return False, body.get("error_message") or str(body)[:120]
    return True, str(body)[:120]


def sign_status(client: GitCodeClient) -> dict:
    return client.get_json("/uc/api/v1/task/v2/sign_status")


def cann_overview(client: GitCodeClient) -> dict:
    """CANN 积分余额与算力配额。"""
    body = client.get_json("/score-proxy/api/v1/shop/third-party/overview",
                           params={"type": "cann"})
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    return data


def unclaimed_rewards(client: GitCodeClient) -> dict:
    return client.get_json("/uc/api/v1/task/total-unclaimed-rewards")


def claimable_tasks(tasks: list[dict]) -> list[dict]:
    """已达完成条件且需要主动领取的任务（estimated=1）。"""
    return [t for t in tasks if t.get("estimated") == 1 and t.get("status") == STATUS_REACHED]
