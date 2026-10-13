"""多账号与代理的本地持久化存储。

数据目录由环境变量 AUTOCANNLAB_DATA_DIR 指定（服务器部署用），默认
PROJECT_ROOT/.agents/data（本地开发）。含 token 的文件已在 .gitignore 排除。
写入均为「临时文件 + 原子替换」，进程内以锁串行化。
"""

import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("AUTOCANNLAB_DATA_DIR", PROJECT_ROOT / ".agents" / "data"))

_lock = threading.Lock()


def _atomic_write(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


class Store:
    """账号/代理/计划/API令牌的统一存取。所有方法线程安全。"""

    def __init__(self, data_dir: Path | None = None):
        self.dir = Path(data_dir) if data_dir else DATA_DIR
        self.dir.mkdir(parents=True, exist_ok=True)

    # ---------- 账号 ----------

    def _accounts_path(self) -> Path:
        return self.dir / "accounts.json"

    def list_accounts(self) -> list[dict]:
        with _lock:
            data = _load(self._accounts_path(), {"accounts": []})
        return data.get("accounts", [])

    def get_account(self, account_id: str) -> dict | None:
        return next((a for a in self.list_accounts() if a["id"] == account_id), None)

    def find_account_by_username(self, username: str) -> dict | None:
        return next((a for a in self.list_accounts() if a.get("username") == username), None)

    def add_account(self, username: str, tokens: dict, *, note: str = "",
                    proxy_id: str | None = None, enabled: bool = True,
                    is_default: bool = False) -> dict:
        with _lock:
            data = _load(self._accounts_path(), {"accounts": []})
            accounts = data["accounts"]
            if not any(a.get("is_default") for a in accounts):
                is_default = True
            account = {
                "id": uuid.uuid4().hex[:12],
                "username": username,
                "note": note,
                "proxy_id": proxy_id,
                "enabled": enabled,
                "is_default": is_default,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "tokens": tokens,
            }
            if is_default:
                for a in accounts:
                    a["is_default"] = False
            accounts.append(account)
            _atomic_write(self._accounts_path(), data)
            return account

    def update_account(self, account_id: str, **fields) -> dict | None:
        with _lock:
            data = _load(self._accounts_path(), {"accounts": []})
            for a in data["accounts"]:
                if a["id"] == account_id:
                    if fields.get("is_default"):
                        for other in data["accounts"]:
                            other["is_default"] = False
                    for key in ("note", "proxy_id", "enabled", "is_default", "tokens"):
                        if key in fields and fields[key] is not None:
                            a[key] = fields[key]
                    _atomic_write(self._accounts_path(), data)
                    return a
        return None

    def delete_account(self, account_id: str) -> bool:
        with _lock:
            data = _load(self._accounts_path(), {"accounts": []})
            before = len(data["accounts"])
            data["accounts"] = [a for a in data["accounts"] if a["id"] != account_id]
            if len(data["accounts"]) == before:
                return False
            _atomic_write(self._accounts_path(), data)
            return True

    def default_account(self) -> dict | None:
        accounts = self.list_accounts()
        return next((a for a in accounts if a.get("is_default")), None) or \
            (accounts[0] if accounts else None)

    # ---------- 代理 ----------

    def _proxies_path(self) -> Path:
        return self.dir / "proxies.json"

    def list_proxies(self) -> list[dict]:
        with _lock:
            data = _load(self._proxies_path(), {"proxies": []})
        return data.get("proxies", [])

    def get_proxy(self, proxy_id: str) -> dict | None:
        return next((p for p in self.list_proxies() if p["id"] == proxy_id), None)

    def add_proxy(self, *, name: str, protocol: str, host: str, port: int,
                  username: str = "", password: str = "",
                  enabled: bool = True) -> dict:
        with _lock:
            data = _load(self._proxies_path(), {"proxies": []})
            proxy = {
                "id": uuid.uuid4().hex[:12],
                "name": name,
                "protocol": protocol.upper(),
                "host": host,
                "port": int(port),
                "username": username,
                "password": password,
                "enabled": enabled,
            }
            data["proxies"].append(proxy)
            _atomic_write(self._proxies_path(), data)
            return proxy

    def update_proxy(self, proxy_id: str, **fields) -> dict | None:
        with _lock:
            data = _load(self._proxies_path(), {"proxies": []})
            for p in data["proxies"]:
                if p["id"] == proxy_id:
                    for key in ("name", "protocol", "host", "port",
                                "username", "password", "enabled", "latency_ms"):
                        if key in fields and fields[key] is not None:
                            p[key] = fields[key]
                    _atomic_write(self._proxies_path(), data)
                    return p
        return None

    def delete_proxy(self, proxy_id: str) -> bool:
        with _lock:
            data = _load(self._proxies_path(), {"proxies": []})
            before = len(data["proxies"])
            data["proxies"] = [p for p in data["proxies"] if p["id"] != proxy_id]
            if len(data["proxies"]) == before:
                return False
            _atomic_write(self._proxies_path(), data)
            return True

    def proxy_url(self, proxy_id: str | None) -> str | None:
        """账号绑定的代理 → httpx 代理 URL。直连/未启用/不存在返回 None。"""
        if not proxy_id:
            return None
        p = self.get_proxy(proxy_id)
        if not p or not p.get("enabled"):
            return None
        auth = f"{p['username']}:{p['password']}@" if p.get("username") else ""
        return f"{p['protocol'].lower()}://{auth}{p['host']}:{p['port']}"

    # ---------- 定时计划 ----------

    def _schedule_path(self) -> Path:
        return self.dir / "schedule.json"

    def get_schedule(self) -> dict:
        default = {"enabled": False, "time": "08:30", "weekdays": [0, 1, 2, 3, 4, 5, 6],
                   "mode": "daily", "account_id": "all"}
        with _lock:
            data = _load(self._schedule_path(), default)
        return {**default, **data}

    def set_schedule(self, **fields) -> dict:
        with _lock:
            data = {**self.get_schedule(), **{k: v for k, v in fields.items() if v is not None}}
            _atomic_write(self._schedule_path(), data)
        return data

    # ---------- Star 批量任务记录 ----------

    def _stars_path(self) -> Path:
        return self.dir / "stars.json"

    def _projects_cache_path(self) -> Path:
        return self.dir / "cann-projects.json"

    def cached_projects(self) -> list[dict]:
        with _lock:
            return _load(self._projects_cache_path(), [])

    def save_projects(self, projects: list[dict]) -> None:
        with _lock:
            _atomic_write(self._projects_cache_path(), projects)

    def list_stars(self, account_id: str | None = None) -> list[dict]:
        with _lock:
            data = _load(self._stars_path(), {"stars": []})
        stars = data.get("stars", [])
        if account_id:
            stars = [s for s in stars if s.get("account_id") == account_id]
        return stars

    def add_star(self, account_id: str, project_id, path: str, source: str) -> dict:
        """记录一次 star（source=batch 由批量功能打出，source=user 用户手动打的）。
        同账号同项目只记一条，重复调用返回已有记录。"""
        with _lock:
            data = _load(self._stars_path(), {"stars": []})
            stars = data.setdefault("stars", [])
            for s in stars:
                if s["account_id"] == account_id and s["project_id"] == project_id:
                    return s
            rec = {
                "account_id": account_id,
                "project_id": project_id,
                "path": path,
                "source": source,
                "status": "queued",
                "starred_at": None,
                "unstarred": False,
                "unstarred_at": None,
            }
            stars.append(rec)
            _atomic_write(self._stars_path(), data)
            return rec

    def queue_star(self, account_id: str, project_id, path: str) -> dict:
        """把项目加入待 star 队列（status=queued）；已存在则原样返回。"""
        return self.add_star(account_id, project_id, path, source="batch")

    def mark_starred(self, account_id: str, project_id) -> dict | None:
        """队列项实际打上 star 后调用：置 starred 并排入延迟取消。"""
        with _lock:
            data = _load(self._stars_path(), {"stars": []})
            for s in data.get("stars", []):
                if (s["account_id"] == account_id and s["project_id"] == project_id
                        and s.get("source") == "batch"):
                    s["status"] = "starred"
                    s["starred_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    _atomic_write(self._stars_path(), data)
                    return s
        return None

    def queued_projects(self, account_id: str) -> list[dict]:
        return [s for s in self.list_stars(account_id)
                if s.get("source") == "batch" and s.get("status") == "queued"]

    def abandon_queue_item(self, account_id: str, project_id) -> None:
        """队列项终结但 star 未打上（页面打不开/接口失败）：置 unstarred 终态，
        不进取消流程（没有 star 就不该取消），也从待执行队列消失。"""
        self.mark_unstarred(account_id, project_id)

    def enqueue_unstar(self, account_id: str, project_id, path: str, due_ts: float) -> None:
        """为已 star 的记录设置取消到期时间。仅 starred/batch 来源会入队（安全护栏）。"""
        with _lock:
            data = _load(self._stars_path(), {"stars": []})
            for s in data.get("stars", []):
                if (s["account_id"] == account_id and s["project_id"] == project_id
                        and s.get("source") == "batch" and s.get("status") in ("queued", "starred")):
                    s["unstar_due"] = due_ts
                    _atomic_write(self._stars_path(), data)
                    return

    def mark_unstarred(self, account_id: str, project_id) -> dict | None:
        with _lock:
            data = _load(self._stars_path(), {"stars": []})
            for s in data.get("stars", []):
                if s["account_id"] == account_id and s["project_id"] == project_id:
                    s["unstarred"] = True
                    s["unstarred_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    _atomic_write(self._stars_path(), data)
                    return s
        return None

    # ---------- API 访问令牌 ----------

    def api_token(self) -> str:
        """管理 API 的 Bearer 令牌；首次访问自动生成。"""
        path = self.dir / "auth.json"
        with _lock:
            data = _load(path, {})
            if not data.get("token"):
                data["token"] = secrets.token_urlsafe(24)
                _atomic_write(path, data)
            return data["token"]
