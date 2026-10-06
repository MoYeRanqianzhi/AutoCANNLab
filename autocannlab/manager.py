"""多账号编排：为账号构建客户端、执行任务并捕获日志、运行记录与定时调度。

风控约束：全局串行锁——同一时刻只允许一个账号执行任务，账号之间也串行。
"""

import logging
import threading
import time
import uuid
from datetime import datetime

from . import actions, oneoff, tasks
from .client import ApiError, GitCodeClient
from .store import Store

log = logging.getLogger(__name__)


class _RunCapture(logging.Handler):
    """把一次运行产生的日志行捕获到列表（供 API 返回与 UI 展示）。"""

    def __init__(self, bucket: list):
        super().__init__(logging.INFO)
        self.bucket = bucket

    def emit(self, record):
        if record.name.startswith("httpx"):
            return
        self.bucket.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "level": record.levelname.lower(),
            "message": record.getMessage(),
        })


class Manager:
    def __init__(self, store: Store | None = None):
        self.store = store or Store()
        # 同一时刻只允许一个任务在跑（含定时触发与手动触发）
        self.run_lock = threading.Lock()
        self.runs: dict[str, dict] = {}
        self.runs_order: list[str] = []
        self._scheduler_stop = threading.Event()

    # ---------- 客户端构建 ----------

    def build_client(self, account: dict) -> GitCodeClient:
        proxy_url = self.store.proxy_url(account.get("proxy_id"))
        return GitCodeClient(
            tokens=account["tokens"],
            proxy_url=proxy_url,
            on_tokens_refreshed=lambda tk: self._save_tokens(account["id"], tk),
        )

    def _save_tokens(self, account_id: str, tokens: dict) -> None:
        self.store.update_account(account_id, tokens=tokens)

    # ---------- 执行 ----------

    def run_account(self, account_id: str, mode: str = "daily") -> str:
        """为指定账号执行 daily/full。返回 run_id。全局串行；已在跑则拒绝。"""
        account = self.store.get_account(account_id)
        if account is None:
            raise KeyError(f"账号不存在: {account_id}")
        if not account.get("enabled", True):
            raise RuntimeError("账号已暂停")
        if not self.run_lock.acquire(blocking=False):
            raise RuntimeError("已有任务在执行中（全局串行）")
        run_id = uuid.uuid4().hex[:12]
        run = {
            "id": run_id, "account_id": account_id,
            "username": account.get("username"), "mode": mode,
            "status": "running", "started_at": datetime.now().isoformat(timespec="minutes"),
            "finished_at": None, "log": [], "summary": None,
        }
        self.runs[run_id] = run
        self.runs_order.append(run_id)
        del self.runs_order[:-30]  # 只保留最近 30 条
        thread = threading.Thread(target=self._run_thread,
                                  args=(run, account, mode), daemon=True)
        thread.start()
        return run_id

    def _run_thread(self, run: dict, account: dict, mode: str) -> None:
        capture = _RunCapture(run["log"])
        root = logging.getLogger()
        root.addHandler(capture)
        try:
            client = self.build_client(account)
            client.prepare()
            if mode == "full":
                actions.run_daily(client)
                oneoff.run_oneoff(client)
                actions.unfollow_cann(client)
            else:
                actions.run_daily(client)
            ov = tasks.cann_overview(client)
            run["summary"] = f"CANN积分 {ov.get('score_balance')}"
            run["status"] = "ok"
        except ApiError as e:
            run["status"] = "error"
            run["summary"] = f"API 错误: {e.message}"[:200]
            log.error("[%s/%s] API 错误: %s", account["username"], mode, e)
        except Exception as e:  # noqa: BLE001 —— 运行失败要完整记录而不是崩溃线程
            run["status"] = "error"
            run["summary"] = f"异常: {e}"[:200]
            log.exception("[%s/%s] 执行异常", account["username"], mode)
        finally:
            root.removeHandler(capture)
            run["finished_at"] = datetime.now().isoformat(timespec="minutes")

    # ---------- 状态 ----------

    def account_status(self, account: dict) -> dict:
        """现场查询账号状态（签到/两币积分/配额/token 有效期）。"""
        client = self.build_client(account)
        client.prepare()
        sign = tasks.sign_status(client)
        ov = tasks.cann_overview(client)
        return {
            "signed_in": bool(sign.get("is_sign_in")),
            "cann_points": ov.get("score_balance"),
            "quota": [
                {"label": q.get("label"), "remaining": q.get("remaining"),
                 "total": q.get("total"), "unit": q.get("unit")}
                for p in ov.get("providers", [])
                for q in (p.get("quota") or {}).get("free_quota", [])
            ],
            "refresh_days_left": client.days_until_relogin_needed(),
        }

    # ---------- 定时调度 ----------

    def start_scheduler(self) -> None:
        threading.Thread(target=self._scheduler_loop, daemon=True,
                         name="scheduler").start()

    def stop_scheduler(self) -> None:
        self._scheduler_stop.set()

    def _scheduler_loop(self) -> None:
        """每 30 秒检查计划；到点（HH:MM 匹配且星期符合）触发一次，触发后当天去重。"""
        fired_on: str | None = None
        while not self._scheduler_stop.wait(30):
            try:
                schedule = self.store.get_schedule()
                if not schedule.get("enabled"):
                    continue
                now = datetime.now()
                today = now.strftime("%Y-%m-%d")
                if fired_on == today:
                    continue
                if now.strftime("%H:%M") != schedule.get("time"):
                    continue
                if now.weekday() not in (schedule.get("weekdays") or []):
                    continue
                fired_on = today
                self._fire_scheduled(schedule)
            except Exception:  # noqa: BLE001 —— 调度循环永不退出
                log.exception("调度循环异常")

    def _fire_scheduled(self, schedule: dict) -> None:
        target = schedule.get("account_id") or "all"
        accounts = self.store.list_accounts()
        if target != "all":
            accounts = [a for a in accounts if a["id"] == target]
        accounts = [a for a in accounts if a.get("enabled", True)]
        log.info("定时计划触发：%s 模式，%d 个账号", schedule.get("mode"), len(accounts))
        for a in accounts:
            try:
                self.run_account(a["id"], schedule.get("mode") or "daily")
                # 串行锁保证实际执行顺序；这里只负责入队
                while any(r["status"] == "running" for r in self.runs.values()):
                    time.sleep(5)
            except RuntimeError as e:
                log.warning("账号 %s 未能启动: %s", a["username"], e)
