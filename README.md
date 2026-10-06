# AutoCANNLab

CANNLab 自动获取积分。通过 GitCode 成长中心任务系统与 CANN 积分接口，自动完成
每日签到、访问 CANN 社区、star/浏览类任务并领取奖励，攒 CANN 积分兑换 NPU 卡时。

> **免责声明**：本项目仅用于学习交流与个人账号的日常任务自动化。请遵守 GitCode
> 服务条款，仅对自己拥有的账号使用；因使用本项目产生的任何后果由使用者自行承担。

## Web 控制台（开发构建）

`web/` 是 React + TypeScript + Vite 管理台，接入 `autocannlab server` 的真实数据与执行，
CANN 与 GitCode 积分分开计算。

| 页面 | 能力 |
| --- | --- |
| 工作台 | CANN 积分/配额、今日任务进度、提交日常或全量执行、最近执行记录 |
| 任务中心 | 真实任务清单（含积分值与完成状态）、提交执行（引擎幂等跳过已完成） |
| 定时计划 | 每日时间、重复星期、日常/全部模式、执行账号，保存后由服务端调度器自动触发 |
| 账号管理 | 登录态导入（Refresh Token 现场校验与轮换）、备注、默认账号、暂停/恢复、移除 |
| 代理节点 | HTTP/SOCKS5 增删、启停、服务端实测连通性与延迟 |
| 运行日志 | 服务端真实日志，按级别与关键词过滤、导出 |

添加账号支持四种真实登录方式（服务端代理 GitCode 登录流程）：

- **扫码登录**：展示 GitCode 小程序真实二维码，微信扫码确认后自动入库
- **短信登录**：网易易盾验证后发送短信验证码，输入即登录
- **密码登录**：密码经服务端按 GitCode 同款算法（AES）加密后提交，需易盾验证
- **登录态导入**：从浏览器 Local Storage 粘贴 access_token / refresh_token

Refresh Token 有效期 60 天，每次运行自动轮换；过期后在账号卡片点「刷新登录」。

开发（Node.js 20.19+ 或 22.12+）：

```powershell
cd web
npm ci
npm run dev
```

构建静态内容：

```powershell
npm run build
```

产物位于 `web/dist/`。生产环境由 `python -m autocannlab server` 直接托管
（同端口、同源，无需额外配置）；开发时也可单独静态托管，但需另配 API 代理。
页面右上角支持 `Ctrl+K` / `⌘K` 快速查找页面与任务。

## 安装

```powershell
pip install -e .
```

## 凭证

登录态使用 GitCode 的 Bearer JWT（access 24h / refresh 60d），存于
`.agents/secrets/gitcode-tokens.json`（已 gitignore）。获取方式：浏览器登录
gitcode.com 后，从 localStorage 导出 `access_token`、`refresh_token`、`username`。
refresh_token 每次运行后自动轮换回写；约 60 天后需重新人工登录。

## 使用

```powershell
python -m autocannlab status   # 只查询：签到状态、CANN积分、算力配额、token 有效期
python -m autocannlab daily    # 日常：访问CANN社区、签到、star→领分→取消star、浏览推荐、扫表代领
python -m autocannlab full     # 首次：daily + 已批准的一次性任务（取关 CANN 组织等）
python -m autocannlab server   # 管理 API + Web 控制台（多账号/代理/定时计划）
```

## 服务器部署（推荐）

主力运行方式：Linux 服务器 + systemd 常驻，内置调度器按计划自动执行。

```bash
# 服务器上（Ubuntu 22.04+，需 python3.12-venv）
cd /opt/autocannlab
python3 -m venv .venv && .venv/bin/pip install -e .
sudo tee /etc/systemd/system/autocannlab.service <<'EOF'
[Unit]
Description=AutoCANNLab management API
After=network-online.target
[Service]
WorkingDirectory=/opt/autocannlab
Environment=AUTOCANNLAB_DATA_DIR=/opt/autocannlab/data
ExecStart=/opt/autocannlab/.venv/bin/python -m autocannlab.server --host 0.0.0.0 --port 8766
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now autocannlab
# API Token 在数据目录 data/auth.json（也在服务启动日志输出），访问 Web 控制台时填入
```

安全提示：服务无 HTTPS，Bearer Token 是唯一防线。公网部署建议改 `--host 127.0.0.1`
并经 SSH 隧道（`ssh -L 8766:127.0.0.1:8766 <server>`）访问。

## Web 控制台

`python -m autocannlab server` 后打开 `http://<host>:8766`：

- 工作台/任务中心：真实任务清单与积分、提交日常/全量执行（引擎幂等，串行执行）
- 账号管理：登录态导入（Refresh Token 现场校验、60 天轮换）、备注、代理绑定、暂停/默认
- 代理节点：HTTP/SOCKS5，连通性实测（WAF 放行 + 延迟）
- 定时计划：每日 HH:MM + 星期几 + 模式（日常/全部），内置调度器自动触发
- 运行日志：服务端真实日志

扫码/短信/密码登录页签仅为展示（GitCode 登录有易盾验证码，无法自动化），
添加账号请用「登录态导入」。

## 动作范围（2026-10-06 用户审定）

只做审定范围内的动作，每个动作先查任务状态，已完成即跳过（幂等）。
明确不做：push/建仓库、资料修改、赛事报名、课程学习、每日分享、事件型任务。
star 类任务领分后一律取消 star。见 `.agents/memory/risk-policy-and-scope.md`。

## 日志

`logs/YYYY-MM-DD.log`（UTF-8），同时输出到控制台。

## License

[MIT](LICENSE) © 2026 MoYeRanqianzhi
