---
name: gitcode-cannlab-api-map
description: GitCode/CANNLab 积分与签到相关 API 端点、认证机制、登录态刷新的实地调查结果
metadata:
  type: project
  scope: gitcode.com 的 CANNLab 平台自动化
  status: active
  last_verified: 2026-10-06
---

CANNLab（https://gitcode.com/org/cann/cannlab）托管在 gitcode.com（Nuxt SSR + 客户端渲染 SPA），后端 API 独立于页面域名。

**认证机制**（已登录态抓包验证）：

- 认证方式：`Authorization: Bearer <JWT>`，不是 Cookie。
- 凭证存于 localStorage：`access_token`（有效期 24h）+ `refresh_token`（有效期 60 天，JWT 内 exp-iat=5184000）。
- 刷新：`POST https://web-api.gitcode.com/uc/api/v1/user/token/refresh`，body `{"refresh_token": "..."}`，content-type `application/x-www-form-urlencoded`（实测 JSON body 也被接受的可能性未验证），响应 `data.access_token` + `data.refresh_token`（**refresh_token 轮换**，必须持久化新值）。
- 通用请求头：`x-app-channel: gitcode-fe`、`x-platform: web`、`x-device-id: unknown`、`x-device-type: Win32`、`x-app-version: 0`。
- 登录：小程序扫码/短信/密码/OAuth（CSDN、华为等），验证码为网易易盾（YIDUN）→ **登录自动化不可行，人工登录一次取 token**。

**API 结构**（均在 `https://web-api.gitcode.com` 下）：

- `uc/api/v1/task?type=&task_level=&page=&per_page=` — 任务列表。`type`：0=成长任务(27个)、1=积分任务(16个)、4=CANN任务(8个)；`period`：4=每日重置、3=每周、1=每月、0=一次性；`estimated`：1=完成后需主动领取、0=服务端1小时内自动结算；`status`：1=已达条件、2=未完成。
- `POST uc/api/v1/task/{task_id}/points` — 领取任务奖励（body `{}` 即可）。未完成时返回 400 `{"error_code":1002,"error_code_name":"ILLEGAL_OPERATION","error_message":"任务未完成"}`。
- `GET uc/api/v1/task/v2/sign_status` — 签到状态：`{"award_index":0,"is_sign_in":true,"scores":[5,5,10,5,5,5,15]}`（7天连续签到奖励序列）。
- `GET uc/api/v1/task/total-unclaimed-rewards`、`uc/api/v1/task/unclaimed` — 未领取奖励汇总/列表。
- `score-proxy/api/v1/shop/third-party/overview?type=cann` — CANN积分余额 + 配额（`score_balance`、`free_quota`）。
- `score-proxy/api/v1/shop/third-party/goods?scene=cannlab_exchange&type=cann` — 积分兑换商品；`POST .../orders` — 下单兑换。
- `score-proxy/api/v1/shop/third-party/biz-score/will-expire?score_type=CANN` — 即将过期积分。
- Star：`POST /api/v2/projects/{id}/star`、`POST /api/v2/projects/{id}/unstar`。
- 关注：`POST /uc/api/v1/follow`（body）、`DELETE /uc/api/v1/follow`（params）——body/params 具体形态待实施时抓一次真实调用。
- `aihub/api/v1/activity/cann/status?competition_id=&resource_type=` — CANN 活动状态。

**CANNLab 资源模型**（官方改版公告 cann/infrastructure#6）：CPU 环境默认 720 核时，NPU 环境默认 252 卡时（该账号实际值）；积分兑换算力入口 `/org/cann/cannlab/environment` 页「积分兑换」。

**两套积分体系**（重要，勿混淆）：

1. GitCode 积分（成长中心 `/setting/points`，100≈¥1）——`uc/api/v1/task` 体系签到+任务的奖励。
2. CANN 积分（score-proxy，仅 CANNLab 用途，兑换 NPU 卡时/周边）——任务 type=4 及 CANN 相关行为结算。

**Evidence:** Playwright 实地访问 + Network 抓包（2026-10-06，请求 #156/#157/#398/#399/#426/#513 等）；前端 bundle 反解（.agents/tmp/js/ 下 146 个 chunk + uc-assets 子应用）；`POST task/1/points` 实测返回结构化错误；localStorage JWT 解码。

**Recheck when:** GitCode 改版导致端点 404/结构变化；token 刷新返回 401；任务列表字段语义变化。

**Why:** 这些端点与机制只能通过登录态抓包获得，无公开文档；丢了就要重新调查一轮。

**How to apply:** 实现自动化脚本时直接复用；任务领取用数字 task_id；每日任务先查 status 再决定动作，见 [[gitcode-task-inventory]] 与 [[cannlab-auth-strategy]]。
