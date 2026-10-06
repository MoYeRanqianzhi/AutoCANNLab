"""路径与常量配置。所有路径以仓库根为基准，脚本在任意工作目录下运行均一致。"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 凭证文件：access_token / refresh_token（refresh 会轮换，脚本每次刷新后回写）
SECRETS_PATH = PROJECT_ROOT / ".agents" / "secrets" / "gitcode-tokens.json"

# 运行时状态：记录待恢复动作（如"已 star 但尚未领分取消"的项目），使每日运行可跨天续接
STATE_PATH = PROJECT_ROOT / ".agents" / "runtime.local.json"

LOG_DIR = PROJECT_ROOT / "logs"

API_BASE = "https://web-api.gitcode.com"
SITE_BASE = "https://gitcode.com"

# 拟人间隔（秒）：动作之间的随机 sleep 范围，全程串行不并发
ACTION_DELAY_RANGE = (2.0, 8.0)

# 结算轮询：服务端任务结算（如 star 后 current_count 翻转）的等待上限
SETTLE_TIMEOUT_S = 90.0
SETTLE_POLL_INTERVAL_S = 6.0
