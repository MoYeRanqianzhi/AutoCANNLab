"""一次性任务（full 模式）。端点均于 2026-10-06 抓包确认（.agents/memory/gitcode-task-inventory.md）。

每个动作先查任务状态，已完成即跳过（幂等）。动作清单经用户审定，
不包含：push/建仓、资料修改、赛事报名、课程学习、每日分享、事件型任务。
"""

import logging

from . import tasks
from .client import ApiError, GitCodeClient

log = logging.getLogger(__name__)

AIHUB_API = "/aihub/api"  # aihub 接口挂在 web-api.gitcode.com 下（2026-10-06 实测确认）

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
    return client.request("GET", AIHUB_API + path, **kwargs)


def _aihub_send(client: GitCodeClient, method: str, path: str, body=None):
    return client.request(method, AIHUB_API + path, json=body if body is not None else {})


def activate_space(client: GitCodeClient) -> str:
    """任务 86 激活Space（+20）：**放弃自动化**。

    实测（2026-10-06）：未启动的第三方 Space 详情页对访客没有激活入口
    （激活按钮仅作者可见），页面访问也不计入任务（cnt 不变）；自行创建
    Space 会创建仓库，触碰用户红线（push/建仓库类不做）。损失一次性 +20。
    """
    return "放弃（激活仅作者可用，自建 Space 触碰建仓库红线）"


def _pick_cpu_flavor_and_image(client: GitCodeClient) -> tuple[str, str] | None:
    """从 server_list / image_list 选最小 CPU 规格与基础 jupyter 镜像。"""
    r = _aihub_get(client, "/v1/space/server_list",
                   params={"ai_device_type": "CPU", "sdk": "notebook", "__s": "aihub"})
    if r.status_code != 200:
        raise ApiError(r.status_code, f"server_list: {r.text[:150]}")
    flavors = (r.json().get("data") or {})
    flavors = flavors.get("list") or flavors.get("content") or flavors if isinstance(flavors, dict) else flavors
    if not flavors:
        raise ApiError(200, "server_list 无 CPU 规格")
    # 规格按 CPU 数升序取最小（字段名实测为 flavor_id + 描述性文本）
    def _cpu_of(f):
        return f.get("cpu") or f.get("flavor") or ""
    flavor = sorted(flavors, key=_cpu_of)[0]

    r = _aihub_get(client, "/v1/space/image_list",
                   params={"ai_device": "CPU", "sdk": "notebook", "__s": "aihub"})
    if r.status_code != 200:
        raise ApiError(r.status_code, f"image_list: {r.text[:150]}")
    data = r.json().get("data") or {}
    images = data.get("list") or data.get("content") or []
    image = next((i for i in images
                  if "jupyter" in str(i.get("image_id") or i.get("image") or "")
                  and "vllm" not in str(i) and "sglang" not in str(i)), None)
    if image is None and images:
        image = images[0]
    if image is None:
        raise ApiError(200, "image_list 为空")
    image_id = image.get("image_id") or image.get("image")
    return flavor.get("flavor_id"), image_id


def start_notebook(client: GitCodeClient) -> str:
    """任务 87 Notebook实战（+25）：创建 CPU notebook → 等就绪 → 立即关闭。

    端点与 body 均为 2026-10-06 浏览器实测捕获；会话有 2 小时硬上限
    （detail.expire_time），最坏情况消耗 0.5v×2h=1 核时。
    """
    if _task_done(client, TASK_NOTEBOOK):
        return "任务已完成，跳过"

    flavor_id, image_id = _pick_cpu_flavor_and_image(client)
    r = _aihub_send(client, "POST", "/v1/notebook", body={
        "flavor_id": flavor_id,
        "image_id": image_id,
        "disk_size": "50Gi",
        "calculation_type": 3,  # 3 = CPU（实测）
        "is_default": 0,
    })
    if r.status_code >= 400:
        return f"失败: 创建 HTTP {r.status_code} {r.text[:150]}"
    detail = r.json().get("data") or r.json()
    notebook_id = detail.get("notebook_id")
    if not notebook_id:
        return f"失败: 创建响应缺 notebook_id（{str(detail)[:120]}）"

    # 等待启动（实测创建即启动，数秒内可用）
    import time as _t
    deadline = _t.time() + 120
    while _t.time() < deadline:
        _t.sleep(5)
        d = _aihub_get(client, "/v1/notebook/detail", params={"__s": "aihub"})
        if d.status_code == 200:
            info = d.json().get("data") or {}
            if info.get("status") not in (0, None) and info.get("access_url"):
                break  # status 非 0 且有访问 URL = 已就绪
    # 立即关闭并轮询确认
    p = _aihub_send(client, "PUT", "/v1/notebook/pause",
                    body={"notebook_id": notebook_id})
    for _ in range(6):
        _t.sleep(5)
        d = _aihub_get(client, "/v1/notebook/detail", params={"__s": "aihub"})
        if d.status_code == 200:
            info = d.json().get("data") or {}
            if info.get("status") == 2:
                return (f"notebook {notebook_id} 启动→就绪→已关闭（status=2），"
                        f"创建 HTTP {r.status_code} pause HTTP {p.status_code}")
    return (f"notebook {notebook_id} 已创建并已发关闭（HTTP {p.status_code}），"
            f"但未确认 status=2，请人工核查 gitcode.com/user/{client.username}/notebook")


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
