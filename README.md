# AutoCANNLab

CANNLab 自动获取积分。通过 GitCode 成长中心任务系统与 CANN 积分接口，自动完成
每日签到、访问 CANN 社区、star/浏览类任务并领取奖励，攒 CANN 积分兑换 NPU 卡时。

## UI 交互原型

`web/` 是独立的 React + TypeScript + Vite 管理台，采用纸白与松绿色调，适配桌面和手机。
当前仅展示虚构数据和本地交互，不调用 Python CLI、GitCode 或代理服务，也不读取项目凭证。
页面刷新会恢复初始演示数据；定时计划不会创建后台任务。

| 页面 | 可体验的交互 |
| --- | --- |
| 工作台 | 积分概览、日常任务执行、全部任务确认、进度反馈、趋势切换和最近动态 |
| 任务中心 | 账号切换、分类和搜索、单项执行、停止和继续、跳过已完成任务 |
| 定时计划 | 时间、每周重复日期、日常/全部模式、执行账号、计划开关 |
| 账号管理（规划预览） | 添加、切换、备注、默认标记、暂停、移除、代理分配和刷新登录 |
| 代理节点（规划预览） | HTTP/SOCKS5 节点增删改、启停、模拟延迟检测 |
| 运行日志 | 分类、搜索、导出本次演示日志 |

登录弹窗展示小程序扫码、短信、账号密码、登录态导入，以及 CSDN / 华为账号授权预览。
演示二维码不可扫描，表单请使用虚构信息。支持方式以 GitCode 实际页面为准。
CANN 与 GitCode 积分分开计算；界面中的一次性任务展示不代表 Python 端已实现。

开发预览（Node.js 20.19+ 或 22.12+）：

```powershell
cd web
npm ci
npm run dev
```

构建静态内容：

```powershell
npm run build
```

产物位于 `web/dist/`，包含全部页面、样式、图标和脚本，运行时不依赖 CDN。
在**项目根目录**使用 Python 托管：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web/dist
```

打开 <http://127.0.0.1:8765>。部署时仅需复制 `web/dist/` 的内容，Node.js 只在构建时需要。
相对资源路径与 hash 路由支持子目录部署，例如 `/#/accounts` 可直接打开和刷新，
无需配置服务器路由回退。页面右上角支持 `Ctrl+K` / `⌘K` 快速查找页面与任务。

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
```

## 动作范围（2026-10-06 用户审定）

只做审定范围内的动作，每个动作先查任务状态，已完成即跳过（幂等）。
明确不做：push/建仓库、资料修改、赛事报名、课程学习、每日分享、事件型任务。
star 类任务领分后一律取消 star。见 `.agents/memory/risk-policy-and-scope.md`。

## 日志

`logs/YYYY-MM-DD.log`（UTF-8），同时输出到控制台。
