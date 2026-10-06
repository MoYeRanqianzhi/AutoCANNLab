"""一次性任务（full 模式）。端点均于 2026-10-06 抓包确认（.agents/memory/gitcode-task-inventory.md）。

每个动作先查任务状态，已完成即跳过（幂等）。动作清单经用户审定，
不包含：push/建仓、资料修改、赛事报名、课程学习、每日分享、事件型任务。
"""

import logging

from . import tasks
from .client import ApiError, GitCodeClient

log = logging.getLogger(__name__)

AIHUB_BASE = "https://api-ai.gitcode.com"  # aihub API 独立域名（ai.gitcode.com 会 302）

# 任务 ID（2026-10-06 抓包固化）
TASK_SEARCH = 2
TASK_VIEW_CODE = 3
TASK_DOWNLOAD = 4
TASK_WEBIDE = 49
TASK_WEBIDE_WEEKLY = 50
TASK_CREATE_TOKEN = 16
TASK_MODEL_EXPERIENCE = 84
TASK_MODEL_FILE_DOWNLOAD = 85
TASK_SPACE_ACTIVATE = 86
TASK_NOTEBOOK = 87

# 浏览/下载目标轮换池（CANN 官方仓，路径与默认分支）
REPO_POOL = [
    ("cann/cann-samples", "master"),
    ("cann/cann-recipes-train", "master"),
    ("cann/cann-recipes-infer", "master"),
]

# 模型文件下载目标：Qwen 官方镜像仓的小配置文件（68B ~ 12KB）
MODEL_FILE = "hf_mirrors/Qwen/Qwen2.5-Omni-7B", "configuration.json"


def _task_done(client: GitCodeClient, task_id: int) -> bool:
    """任务是否已达完成条件（在 type=0 与 type=1 两个清单里查）。"""
    for task_type in (0, 1):
        for t in tasks.list_tasks(client, task_type):
            if t.get("task_id") == task_id:
                return t.get("current_count", 0) >= t.get("need_count", 1)
    return False


def create_token(client: GitCodeClient) -> str:
    """创建访问令牌（全部权限禁止，最小权限）。已存在同名 token 则跳过创建。"""
    if _task_done(client, TASK_CREATE_TOKEN):
        return "任务已完成，跳过"
    body = client.post_json(
        f"/uc/api/v1/user/{client.username}/impersonation_tokens",
        body={
            "username": client.username,
            "name": "autocannlab-bot",
            "expires_at": "2099-12-31",
            "scopes": [],
            "description": "AutoCANNLab 自动创建（权限：全部禁止）",
        },
    )
    log.debug("创建令牌响应: %s", str(body)[:200])
    return "已创建访问令牌 autocannlab-bot（全权限禁止）"


def search_project(client: GitCodeClient) -> str:
    """搜索开源项目：搜索页（SSR 即执行搜索）+ 点击一个结果（访问项目页）。"""
    if _task_done(client, TASK_SEARCH):
        return "任务已完成，跳过"
    resp = client.request("GET", "/search?type=repo&q=cann",
                          api_base="https://gitcode.com")
    if resp.status_code != 200:
        return f"失败: 搜索页 HTTP {resp.status_code}"
    resp = client.request("GET", "/cann", api_base="https://gitcode.com")
    if resp.status_code != 200:
        return f"失败: 结果页 HTTP {resp.status_code}"
    return "已搜索「cann」并访问结果页（判定方式待验证）"


def view_code(client: GitCodeClient) -> str:
    """查看项目代码：访问一条带 /blob/ 的源代码页面。"""
    if _task_done(client, TASK_VIEW_CODE):
        return "任务已完成，跳过"
    path, branch = REPO_POOL[0]
    resp = client.request(
        "GET", f"/{path}/blob/{branch}/README.md", api_base="https://gitcode.com")
    if resp.status_code != 200:
        return f"失败: HTTP {resp.status_code}"
    return f"已查看 {path}/blob/{branch}/README.md"


def download_project(client: GitCodeClient) -> str:
    """下载一个项目：拉取 archive zip（流式丢弃，仅要求服务端记录下载行为）。"""
    if _task_done(client, TASK_DOWNLOAD):
        return "任务已完成，跳过"
    path, branch = REPO_POOL[0]
    with client.http.stream(
        "GET", f"https://gitcode.com/{path}/archive/{branch}.zip",
        headers={"Authorization": f"Bearer {client.access_token}"},
    ) as resp:
        if resp.status_code != 200:
            return f"失败: HTTP {resp.status_code}（URL 模式待验证）"
        size = 0
        for chunk in resp.iter_bytes():
            size += len(chunk)
            if size > 64 * 1024 * 1024:  # 足够触发统计即可，避免大文件拖慢
                break
    return f"已下载 {path} archive（{size // 1024} KiB 后截断）"


def open_webide(client: GitCodeClient) -> str:
    """使用 WebIDE：获取 SAML SSO 登录 URL 并访问（跳转到华为云 CodeArts IDE）。"""
    if _task_done(client, TASK_WEBIDE) and _task_done(client, TASK_WEBIDE_WEEKLY):
        return "两个 WebIDE 任务均已完成，跳过"
    body = client.get_json("/uc/api/v1/sso/saml/loginUrl")
    url = (body.get("data") if isinstance(body.get("data"), dict) else body)
    url = url.get("url") if isinstance(url, dict) else url
    if not isinstance(url, str) or not url.startswith("http"):
        return f"失败: loginUrl 响应异常 {str(body)[:150]}"
    resp = client.http.get(url, headers={
        "Authorization": f"Bearer {client.access_token}",
        "referer": "https://gitcode.com/",
    })
    return f"SSO 跳转完成（最终 HTTP {resp.status_code}，最终 URL {str(resp.url)[:80]}…）"


def download_model_file(client: GitCodeClient) -> str:
    """下载模型文件：拉取镜像仓一个小文件。"""
    if _task_done(client, TASK_MODEL_FILE_DOWNLOAD):
        return "任务已完成，跳过"
    model, filename = MODEL_FILE
    resp = client.http.get(
        f"https://ai.gitcode.com/{model}/resolve/main/{filename}",
        headers={"Authorization": f"Bearer {client.access_token}",
                 "referer": "https://ai.gitcode.com/"},
    )
    if resp.status_code != 200:
        return f"失败: HTTP {resp.status_code}"
    return f"已下载模型文件 {filename}（{len(resp.content)} B）"


def _aihub_get(client: GitCodeClient, path: str, **kwargs):
    return client.http.get(AIHUB_BASE + path,
                           headers={"Authorization": f"Bearer {client.access_token}",
                                    "x-app-channel": "gitcode-fe"},
                           **kwargs)


def _aihub_post(client: GitCodeClient, path: str, body=None):
    return client.http.post(AIHUB_BASE + path,
                            json=body if body is not None else {},
                            headers={"Authorization": f"Bearer {client.access_token}",
                                     "x-app-channel": "gitcode-fe"})


def activate_space(client: GitCodeClient) -> str:
    """激活 Space：找一个未启动的 Space 并启动。

    注意：会在平台侧启动第三方/自己的 Space 实例（消耗平台算力），仅 full 模式
    执行一次。api-ai.gitcode.com 域名与 start body 为待实测项，失败时如实记录。
    """
    if _task_done(client, TASK_SPACE_ACTIVATE):
        return "任务已完成，跳过"
    resp = _aihub_get(client, "/aihub/api/v1/space/get_page",
                      params={"page": 1, "page_size": 10})
    if resp.status_code != 200:
        return f"失败: space 列表 HTTP {resp.status_code}（aihub 域名待实测）"
    data = resp.json().get("data") or {}
    items = data.get("list") or data.get("content") or []
    target = None
    for item in items:
        status = str(item.get("status", "")).lower()
        if status in ("0", "stopped", "sleep", "sleeping", "not_started", "pending"):
            target = item
            break
    if target is None:
        return "列表前 10 个 Space 均在运行中，未执行激活"
    space_id = target.get("id") or target.get("project_id")
    resp = _aihub_post(client, f"/aihub/api/v1/space/{space_id}/start")
    return f"已请求激活 Space {space_id}（HTTP {resp.status_code}，body 待实测校验）"


def start_notebook(client: GitCodeClient) -> str:
    """启动一次 Notebook 实例并暂停（任务要求：新建实例、启动并等待就绪）。

    注意：Notebook 消耗本人 CPU 核时配额；启动后会尽快 pause。创建 body 字段
    未经实测，失败时如实记录不重试（避免反复建实例烧配额）。
    """
    if _task_done(client, TASK_NOTEBOOK):
        return "任务已完成，跳过"
    resp = _aihub_post(client, "/aihub/api/v1/notebook")
    if resp.status_code >= 400:
        return (f"失败: 创建 notebook HTTP {resp.status_code} "
                f"{resp.text[:120]}（body 字段待实测）")
    resp2 = _aihub_post(client, "/aihub/api/v1/notebook/pause")
    return f"notebook 已创建（HTTP {resp.status_code}），pause 请求已发（HTTP {resp2.status_code}）"


# full 模式的一次性动作清单（顺序执行；标注是否已实现端点）
ONEOFF_STEPS = [
    ("F1 创建访问令牌", create_token),
    ("F2 搜索开源项目", search_project),
    ("F3 查看项目代码", view_code),
    ("F4 下载项目", download_project),
    ("F5 WebIDE", open_webide),
    ("F6 下载模型文件", download_model_file),
    ("F7 激活Space", activate_space),
    ("F8 Notebook实战", start_notebook),
]


def run_oneoff(client: GitCodeClient) -> None:
    from .actions import pause

    for name, fn in ONEOFF_STEPS:
        try:
            result = fn(client)
        except ApiError as e:
            result = f"失败: {e}"
        except Exception as e:  # noqa: BLE001 —— 单个动作失败不阻断后续动作
            result = f"异常: {e}"
        log.info("[%s] %s", name, result)
        pause()


def model_experience_placeholder(client: GitCodeClient) -> str:
    """模型初体验（任务 84，+15）：在线推理入口尚未定位——镜像模型页无推理
    widget，「使用模型」菜单仅为代码示例；可能仅部分模型支持在线推理。
    在入口探明前不实现，避免瞎猜接口。"""
    return "未实现：在线推理入口待探明（见 plan 开放点）"
