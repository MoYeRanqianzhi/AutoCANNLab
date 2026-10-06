"""CLI 入口：python -m autocannlab status|daily|full"""

import argparse
import logging
import sys
from datetime import datetime

import httpx

from . import actions, config, tasks
from .client import ApiError, GitCodeClient


def setup_logging() -> logging.Handler:
    config.LOG_DIR.mkdir(exist_ok=True)
    logfile = config.LOG_DIR / f"{datetime.now():%Y-%m-%d}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_h = logging.FileHandler(logfile, encoding="utf-8")
    file_h.setFormatter(fmt)
    console_h = logging.StreamHandler(sys.stderr)
    console_h.setFormatter(fmt)
    logging.getLogger().addHandler(file_h)
    logging.getLogger().addHandler(console_h)
    logging.getLogger().setLevel(logging.INFO)
    return console_h


def cmd_status(client: GitCodeClient) -> int:
    client.prepare()
    sign = tasks.sign_status(client)
    print(f"签到: {'今日已签' if sign.get('is_sign_in') else '今日未签'}"
          f"（连续奖励序列 {sign.get('scores')}）")
    ov = tasks.cann_overview(client)
    print(f"CANN积分: {ov.get('score_balance')}")
    for p in ov.get("providers", []):
        for q in (p.get("quota") or {}).get("free_quota", []):
            print(f"{q.get('label')}: {q.get('remaining')}/{q.get('total')} {q.get('unit')} 可用")
    unclaimed = tasks.unclaimed_rewards(client)
    print(f"未领取奖励汇总: {unclaimed}")
    days = client.days_until_relogin_needed()
    if days is not None:
        tag = "!! 需重新人工登录" if days <= 0 else ("! 即将过期" if days < 7 else "")
        print(f"refresh_token 剩余有效期: {days:.1f} 天 {tag}")
    return 0


def cmd_daily(client: GitCodeClient) -> int:
    client.prepare()
    actions.run_daily(client)
    ov = tasks.cann_overview(client)
    print(f"完成。CANN积分余额: {ov.get('score_balance')}")
    return 0


def cmd_full(client: GitCodeClient) -> int:
    client.prepare()
    actions.run_full(client)
    ov = tasks.cann_overview(client)
    print(f"完成。CANN积分余额: {ov.get('score_balance')}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="autocannlab", description="CANNLab 自动获取积分")
    parser.add_argument("mode", choices=["status", "daily", "full"], nargs="?",
                        default="daily", help="status=只查询 daily=日常任务 full=首次全量")
    args = parser.parse_args()
    setup_logging()
    try:
        client = GitCodeClient()
    except FileNotFoundError:
        print(f"凭证文件不存在: {config.SECRETS_PATH}", file=sys.stderr)
        print("请先在有头浏览器登录 GitCode 后导出 access_token/refresh_token。", file=sys.stderr)
        return 2
    handlers = {"status": cmd_status, "daily": cmd_daily, "full": cmd_full}
    try:
        return handlers[args.mode](client)
    except ApiError as e:
        logging.getLogger(__name__).error("API 错误: %s", e)
        if e.status in (401, 403) or "token" in e.message.lower():
            print("登录态可能已整体失效（refresh_token 过期），请在浏览器重新登录后更新凭证文件。",
                  file=sys.stderr)
        return 1
    except httpx.HTTPError as e:
        logging.getLogger(__name__).error("网络错误: %s", e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
