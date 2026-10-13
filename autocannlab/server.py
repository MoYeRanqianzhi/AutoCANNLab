"""管理 API 服务：多账号/代理/计划/执行/日志，静态托管 web/dist。

启动：python -m autocannlab.server [--host 127.0.0.1] [--port 8766]
认证：除登录态导入外均需 Authorization: Bearer <token>；token 存于
数据目录 auth.json，首次启动自动生成（服务器部署后从日志读取一次）。
"""

import argparse
import json
import logging
import time
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .client import ApiError, GitCodeClient
from .config import LOG_DIR
from .manager import Manager
from .store import Store
from . import tasks as task_api

log = logging.getLogger(__name__)

app = FastAPI(title="AutoCANNLab", docs_url=None, redoc_url=None)
store = Store()
manager = Manager(store)


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    if header != f"Bearer {store.api_token()}":
        raise HTTPException(401, "未授权")


def public_account(a: dict) -> dict:
    """脱敏：token 不出网，只给元数据。"""
    return {
        "id": a["id"], "username": a.get("username"), "note": a.get("note", ""),
        "proxy_id": a.get("proxy_id"), "enabled": a.get("enabled", True),
        "is_default": a.get("is_default", False),
        "created_at": a.get("created_at"),
        "has_tokens": bool(a.get("tokens")),
    }


def public_proxy(p: dict) -> dict:
    out = {k: p.get(k) for k in ("id", "name", "protocol", "host", "port", "enabled")}
    out["has_auth"] = bool(p.get("username"))
    return out


@app.get("/api/state")
def get_state(_: None = Depends(require_auth)):
    accounts = [public_account(a) for a in store.list_accounts()]
    running = [r for r in manager.runs.values() if r["status"] == "running"]
    return {
        "accounts": accounts,
        "proxies": [public_proxy(p) for p in store.list_proxies()],
        "schedule": store.get_schedule(),
        "running": running,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


# ---------- 账号 ----------

class AccountIn(BaseModel):
    access_token: str = ""
    refresh_token: str = ""
    username: str = ""
    note: str = ""
    proxy_id: str | None = None


@app.post("/api/accounts")
def add_account(body: AccountIn, _: None = Depends(require_auth)):
    """导入登录态（access+refresh），现场校验可用性后入库。"""
    if not body.refresh_token and not body.access_token:
        raise HTTPException(400, "至少提供 refresh_token（推荐）或 access_token")
    tokens = {"access_token": body.access_token, "refresh_token": body.refresh_token,
              "username": body.username}
    try:
        client = GitCodeClient(tokens=tokens,
                               proxy_url=store.proxy_url(body.proxy_id),
                               on_tokens_refreshed=lambda tk: tokens.update(tk))
        client.prepare()
        return _register_account(client, tokens, body.note, body.proxy_id)
    except ApiError as e:
        raise HTTPException(400, f"登录态校验失败: {e.message}") from e
    except httpx.HTTPError as e:
        raise HTTPException(502, f"网络错误: {e}") from e


def _register_account(client: GitCodeClient, tokens: dict, note: str,
                      proxy_id: str | None) -> dict:
    """校验通过后的公共入库路径（登录态导入与三种登录方式共用）。"""
    info = client.get_json("/uc/api/v1/user/oauth/userInfo")
    data = info.get("data") if isinstance(info.get("data"), dict) else info
    username = data.get("username") or tokens.get("username")
    if not username:
        raise HTTPException(400, "无法从 userInfo 获取用户名")
    existing = store.find_account_by_username(username)
    if existing:
        # 已存在则更新其登录态（刷新登录场景）
        updated = store.update_account(existing["id"], tokens={
            "access_token": client.access_token,
            "refresh_token": tokens["refresh_token"],
            "username": username,
        })
        account = public_account(updated)
        account["updated"] = True
        return account
    account = store.add_account(
        username=username,
        tokens={"access_token": client.access_token,
                "refresh_token": tokens["refresh_token"],
                "username": username},
        note=note, proxy_id=proxy_id,
    )
    return public_account(account)


# ---------- 登录（扫码/短信/密码） ----------

from .auth import LoginClient  # noqa: E402

_login_client: LoginClient | None = None


def login_session() -> LoginClient:
    global _login_client
    if _login_client is None:
        _login_client = LoginClient()
    return _login_client


class CaptchaIn(BaseModel):
    captcha_id: str = ""
    token: str = ""
    authenticate: str = ""
    validate: str = ""


class SmsSendIn(BaseModel):
    mobile: str
    captcha: CaptchaIn


class SmsLoginIn(BaseModel):
    mobile: str
    code: str
    mask: str = ""
    note: str = ""
    proxy_id: str | None = None


class PasswordLoginIn(BaseModel):
    username: str
    password: str
    captcha: CaptchaIn
    note: str = ""
    proxy_id: str | None = None


def _login_to_account(tokens: dict, note: str, proxy_id: str | None) -> dict:
    """登录成功响应 → 校验 → 入库/更新。"""
    client = GitCodeClient(
        tokens={"access_token": tokens.get("access_token", ""),
                "refresh_token": tokens.get("refresh_token", "")},
        proxy_url=store.proxy_url(proxy_id),
        on_tokens_refreshed=lambda tk: tokens.update(tk),
    )
    client.prepare()
    merged = {"access_token": client.access_token,
              "refresh_token": tokens.get("refresh_token", "")}
    return _register_account(client, merged, note, proxy_id)


@app.post("/api/auth/qr")
def auth_qr_create(_: None = Depends(require_auth)):
    try:
        return login_session().create_qr()
    except ApiError as e:
        raise HTTPException(400, f"创建二维码失败: {e.message}") from e


@app.get("/api/auth/qr/{scene_id}")
def auth_qr_status(scene_id: str, _: None = Depends(require_auth)):
    try:
        return login_session().qr_status(scene_id)
    except ApiError as e:
        raise HTTPException(400, f"查询失败: {e.message}") from e


@app.post("/api/auth/qr/{scene_id}/confirm")
def auth_qr_confirm(scene_id: str, body: dict, _: None = Depends(require_auth)):
    """用户确认后换取令牌并入库。body: {note?, proxy_id?}"""
    try:
        tokens = login_session().exchange_qr(scene_id)
        if not tokens.get("access_token") and not tokens.get("refresh_token"):
            raise HTTPException(400, f"扫码确认未返回令牌: {str(tokens)[:150]}")
        return _login_to_account(tokens, body.get("note") or "",
                                 body.get("proxy_id"))
    except ApiError as e:
        raise HTTPException(400, f"登录失败: {e.message}") from e


@app.post("/api/auth/sms/send")
def auth_sms_send(body: SmsSendIn, _: None = Depends(require_auth)):
    try:
        return login_session().send_sms_code(body.mobile, body.captcha.model_dump())
    except ApiError as e:
        raise HTTPException(400, f"发送验证码失败: {e.message}") from e


@app.post("/api/auth/sms/verify")
def auth_sms_verify(body: SmsLoginIn, _: None = Depends(require_auth)):
    try:
        tokens = login_session().login_mobile(body.mobile, body.code, body.mask)
        if not tokens.get("access_token") and not tokens.get("refresh_token"):
            raise HTTPException(400, f"验证码登录未返回令牌: {str(tokens)[:150]}")
        return _login_to_account(tokens, body.note, body.proxy_id)
    except ApiError as e:
        raise HTTPException(400, f"登录失败: {e.message}") from e


@app.post("/api/auth/password")
def auth_password(body: PasswordLoginIn, _: None = Depends(require_auth)):
    try:
        tokens = login_session().login_password(
            body.username, body.password, body.captcha.model_dump())
        if not tokens.get("access_token") and not tokens.get("refresh_token"):
            raise HTTPException(400, f"登录未返回令牌: {str(tokens)[:150]}")
        return _login_to_account(tokens, body.note, body.proxy_id)
    except ApiError as e:
        raise HTTPException(400, f"登录失败: {e.message}") from e


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: str, _: None = Depends(require_auth)):
    if not store.delete_account(account_id):
        raise HTTPException(404, "账号不存在")
    return {"ok": True}


@app.post("/api/accounts/{account_id}/default")
def set_default(account_id: str, _: None = Depends(require_auth)):
    a = store.update_account(account_id, is_default=True)
    if a is None:
        raise HTTPException(404, "账号不存在")
    return {"ok": True}


@app.post("/api/accounts/{account_id}/pause")
def pause_account(account_id: str, _: None = Depends(require_auth)):
    a = store.update_account(account_id, enabled=False)
    if a is None:
        raise HTTPException(404, "账号不存在")
    return {"ok": True}


@app.post("/api/accounts/{account_id}/resume")
def resume_account(account_id: str, _: None = Depends(require_auth)):
    a = store.update_account(account_id, enabled=True)
    if a is None:
        raise HTTPException(404, "账号不存在")
    return {"ok": True}


@app.post("/api/accounts/{account_id}/proxy")
def set_account_proxy(account_id: str, body: dict, _: None = Depends(require_auth)):
    a = store.update_account(account_id, proxy_id=body.get("proxy_id"))
    if a is None:
        raise HTTPException(404, "账号不存在")
    return {"ok": True}


@app.patch("/api/accounts/{account_id}")
def patch_account(account_id: str, body: dict, _: None = Depends(require_auth)):
    a = store.update_account(account_id, note=body.get("note"))
    if a is None:
        raise HTTPException(404, "账号不存在")
    return public_account(a)


@app.get("/api/accounts/{account_id}/status")
def account_status(account_id: str, _: None = Depends(require_auth)):
    account = store.get_account(account_id)
    if account is None:
        raise HTTPException(404, "账号不存在")
    try:
        return manager.account_status(account)
    except ApiError as e:
        raise HTTPException(400, f"查询失败: {e.message}") from e


@app.get("/api/accounts/{account_id}/tasks")
def account_tasks(account_id: str, _: None = Depends(require_auth)):
    """真实任务清单（成长中心 + CANN 任务），映射为 UI 的任务形状。
    末尾追加「CANN 项目 Star 队列」虚拟任务行（task_id 用字符串前缀区分）。"""
    account = store.get_account(account_id)
    if account is None:
        raise HTTPException(404, "账号不存在")
    try:
        client = manager.build_client(account)
        client.prepare()
    except ApiError as e:
        raise HTTPException(400, f"登录态不可用: {e.message}") from e
    out = []
    for t in task_api.all_tasks(client):
        out.append({
            "task_id": t["task_id"],
            "cn_name": t.get("cn_name") or t.get("name"),
            "description": t.get("description") or "",
            "score": t.get("score") or 0,
            "currency": "CANN" if t.get("task_type") == 4 else "GitCode",
            # period=4 每日重置 → 日常任务；其余（一次性/每周/每月）归入一次性
            "category": "daily" if t.get("period") == 4 else "once",
            "done": (t.get("current_count") or 0) >= (t.get("need_count") or 1),
        })
    # Star 队列虚拟任务：独立分类（category="star"），UI 用金色变体渲染并内联展开队列管理
    batch = [s for s in store.list_stars(account_id) if s.get("source") == "batch"]
    queued = sum(1 for s in batch if s.get("status") == "queued")
    starred_n = sum(1 for s in batch if s.get("status") == "starred" and not s.get("unstarred"))
    done_n = sum(1 for s in batch if s.get("unstarred"))
    cached = len(store.cached_projects())
    out.append({
        "task_id": "star-queue",
        "cn_name": "CANN 项目 Star 积分",
        "description": (
            f"批量 star CANN org 项目（每个 +50）后自动取消；"
            f"队列 {queued} 项，已 star {starred_n} 项，已完成 {done_n} 项，清单 {cached} 个项目"
        ),
        "score": 50,
        "currency": "CANN",
        "category": "star",
        "done": False,
    })
    return out


@app.get("/api/batch-star/summary/{account_id}")
def batch_star_summary(account_id: str, _: None = Depends(require_auth)):
    """Star 队列概要（任务中心顶部专属面板用）。"""
    if store.get_account(account_id) is None:
        raise HTTPException(404, "账号不存在")
    records = store.list_stars(account_id)
    batch = [s for s in records if s.get("source") == "batch"]
    paused = account_id in manager.queue_paused
    running = any(r.get("kind") == "batch_star" and r.get("status") == "running"
                  for r in manager.runs.values())
    return {
        "queued": sum(1 for s in batch if s.get("status") == "queued"),
        "starred": sum(1 for s in batch if s.get("status") == "starred" and not s.get("unstarred")),
        "done": sum(1 for s in batch if s.get("unstarred")),
        "projects_cached": len(store.cached_projects()),
        "paused": paused,
        "running": running,
    }


# ---------- 代理 ----------

class ProxyIn(BaseModel):
    name: str
    protocol: str = "HTTP"
    host: str
    port: int
    username: str = ""
    password: str = ""
    enabled: bool = True


@app.post("/api/proxies")
def add_proxy(body: ProxyIn, _: None = Depends(require_auth)):
    if body.protocol.upper() not in ("HTTP", "SOCKS5"):
        raise HTTPException(400, "协议仅支持 HTTP / SOCKS5")
    return public_proxy(store.add_proxy(**body.model_dump()))


@app.delete("/api/proxies/{proxy_id}")
def delete_proxy(proxy_id: str, _: None = Depends(require_auth)):
    if not store.delete_proxy(proxy_id):
        raise HTTPException(404, "代理不存在")
    return {"ok": True}


@app.post("/api/proxies/{proxy_id}/test")
def test_proxy(proxy_id: str, _: None = Depends(require_auth)):
    """经该代理访问主站，测 WAF 放行 + 延迟。"""
    proxy_url = store.proxy_url(proxy_id)
    if not proxy_url:
        raise HTTPException(400, "代理不存在或未启用")
    start = time.monotonic()
    try:
        with httpx.Client(proxy=proxy_url, timeout=15,
                          headers={"user-agent": GitCodeClient.__mro__ and
                                   "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}) as client:
            resp = client.get("https://gitcode.com/cann")
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)[:200]}
    latency = int((time.monotonic() - start) * 1000)
    store.update_proxy(proxy_id, latency_ms=latency)
    return {"ok": resp.status_code == 200, "status": resp.status_code,
            "latency_ms": latency}


# ---------- 定时计划 ----------

@app.get("/api/schedule")
def get_schedule(_: None = Depends(require_auth)):
    return store.get_schedule()


@app.put("/api/schedule")
def put_schedule(body: dict, _: None = Depends(require_auth)):
    return store.set_schedule(**{
        k: body.get(k) for k in ("enabled", "time", "weekdays", "mode", "account_id")
        if k in body
    })


# ---------- 执行 ----------

class RunIn(BaseModel):
    account_id: str
    mode: str = "daily"


@app.post("/api/runs")
def start_run(body: RunIn, _: None = Depends(require_auth)):
    if body.mode not in ("daily", "full"):
        raise HTTPException(400, "mode 仅支持 daily / full")
    try:
        run_id = manager.run_account(body.account_id, body.mode)
    except KeyError:
        raise HTTPException(404, "账号不存在") from None
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from None
    return {"run_id": run_id}


@app.get("/api/runs")
def list_runs(_: None = Depends(require_auth)):
    return [manager.runs[i] for i in reversed(manager.runs_order)
            if i in manager.runs]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, _: None = Depends(require_auth)):
    run = manager.runs.get(run_id)
    if run is None:
        raise HTTPException(404, "运行记录不存在")
    return run


# ---------- 批量 star ----------

@app.get("/api/batch-star/projects/{account_id}")
def batch_star_projects(account_id: str, _: None = Depends(require_auth)):
    """项目清单（本地缓存，不发外部请求）。前端进入页面即时呈现。"""
    if store.get_account(account_id) is None:
        raise HTTPException(404, "账号不存在")
    cached = store.cached_projects()
    starred = {s["project_id"]: s for s in store.list_stars(account_id)}
    return [{
        "id": p["id"], "path": p["path"], "archived": p.get("archived", False),
        "fetched_at": p.get("fetched_at"),
        "star_state": "batch_pending" if (s := starred.get(p["id"])) and s.get("status") == "starred"
        else "queued" if (s := starred.get(p["id"])) and s.get("status") == "queued"
        else "batch_unstarred" if p["id"] in starred
        else "new",
    } for p in cached]


@app.post("/api/batch-star/projects/{account_id}/refresh")
def batch_star_refresh(account_id: str, _: None = Depends(require_auth)):
    """手动刷新：实时拉取 CANN org 项目清单并写缓存。仅用户点击时发起外部请求。"""
    account = store.get_account(account_id)
    if account is None:
        raise HTTPException(404, "账号不存在")
    from . import batch_star
    try:
        client = manager.build_client(account)
        client.prepare()
        projects = batch_star.list_cann_projects(client)
    except ApiError as e:
        raise HTTPException(502, f"拉取项目清单失败: {e.message}") from None
    fetched_at = datetime.now().isoformat(timespec="seconds")
    store.save_projects([{**p, "fetched_at": fetched_at} for p in projects])
    return {"count": len(projects), "fetched_at": fetched_at}


class QueueAddIn(BaseModel):
    account_id: str
    project_id: int


@app.post("/api/batch-star/queue")
def batch_star_enqueue(body: QueueAddIn, _: None = Depends(require_auth)):
    """把单个项目加入待 star 队列（行内 star 按钮即入队；队列由后台自动执行）。"""
    rec = _enqueue_one(body.account_id, body.project_id)
    return rec


class QueueAddAllIn(BaseModel):
    account_id: str
    project_ids: list[int]


@app.post("/api/batch-star/queue/all")
def batch_star_enqueue_all(body: QueueAddAllIn, _: None = Depends(require_auth)):
    """一键全部入队：把给定项目批量加入待 star 队列（已入队/已 star 的自动跳过）。"""
    if store.get_account(body.account_id) is None:
        raise HTTPException(404, "账号不存在")
    added = 0
    for pid in body.project_ids:
        try:
            _enqueue_one(body.account_id, pid, quiet=True)
            added += 1
        except HTTPException:
            continue
    total = len(store.queued_projects(body.account_id))
    return {"added": added, "total": total}


def _enqueue_one(account_id: str, project_id: int, *, quiet: bool = False) -> dict:
    account = store.get_account(account_id)
    if account is None:
        raise HTTPException(404, "账号不存在")
    project = next((p for p in store.cached_projects() if p["id"] == project_id), None)
    if project is None:
        if quiet:
            raise HTTPException(404, "项目不在缓存清单中")
        raise HTTPException(404, "项目不在缓存清单中（先更新清单）")
    if project.get("archived"):
        raise HTTPException(400, "项目已归档，无法 star")
    existing = next((s for s in store.list_stars(account_id)
                     if s["project_id"] == project_id and s.get("status") == "queued"), None)
    if existing:
        if quiet:
            raise HTTPException(409, "已在队列")
        return existing
    rec = store.queue_star(account_id, project_id, project["path"])
    return rec


@app.post("/api/batch-star/queue/{account_id}/pause")
def batch_star_pause(account_id: str, _: None = Depends(require_auth)):
    """暂停队列：当前项目完成后停下，剩余项目留在队列。"""
    if store.get_account(account_id) is None:
        raise HTTPException(404, "账号不存在")
    manager.queue_paused.add(account_id)
    return {"ok": True}


@app.post("/api/batch-star/queue/{account_id}/resume")
def batch_star_resume(account_id: str, _: None = Depends(require_auth)):
    """恢复队列执行。"""
    if store.get_account(account_id) is None:
        raise HTTPException(404, "账号不存在")
    manager.queue_paused.discard(account_id)
    return {"ok": True}


@app.get("/api/batch-star/records/{account_id}")
def batch_star_records(account_id: str, _: None = Depends(require_auth)):
    """star 记账（含队列/已 star/已取消），供任务中心与进度展示。"""
    return store.list_stars(account_id)


# ---------- 日志 ----------

@app.get("/api/logs")
def get_logs(level: str = "all", q: str = "", limit: int = 200,
             _: None = Depends(require_auth)):
    """解析 logs/*.log 尾部行（多文件按时间归并）。"""
    entries: list[dict] = []
    files = sorted(LOG_DIR.glob("*.log"))[-3:] if LOG_DIR.exists() else []
    for path in files:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines[-1500:]:
            if " httpx: HTTP" in line:
                continue
            entries.append({"file": path.stem, "line": line})
    entries = entries[-3000:]
    out = []
    for e in reversed(entries):
        line = e["line"]
        lvl = "warning" if " WARNING " in line else \
            "error" if " ERROR " in line else "info"
        if level != "all" and lvl != level:
            continue
        if q and q.lower() not in line.lower():
            continue
        out.append({"file": e["file"], "level": lvl, "message": line})
        if len(out) >= limit:
            break
    return out


# ---------- 静态 UI ----------

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


@app.get("/", include_in_schema=False)
def index():
    if (WEB_DIST / "index.html").exists():
        return FileResponse(WEB_DIST / "index.html")
    raise HTTPException(404, "web/dist 未构建：cd web && npm run build")


app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


def migrate_legacy_secrets() -> None:
    """首个账号：把单账号时代的 secrets 文件导入账号库（幂等）。"""
    if store.list_accounts():
        return
    from .config import SECRETS_PATH
    if not SECRETS_PATH.exists():
        return
    try:
        tokens = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        store.add_account(username=tokens.get("username", "unknown"),
                          tokens=tokens, note="本地凭证自动迁移")
        log.info("已迁移本地凭证为账号 %s", tokens.get("username"))
    except (OSError, json.JSONDecodeError) as e:
        log.warning("本地凭证迁移失败: %s", e)


def main() -> None:
    parser = argparse.ArgumentParser(prog="autocannlab.server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    migrate_legacy_secrets()
    manager.start_background()
    import uvicorn
    print(f"API Token: {store.api_token()}")
    print(f"数据目录: {store.dir}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
