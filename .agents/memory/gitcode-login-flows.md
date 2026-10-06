---
name: gitcode-login-flows
description: GitCode 三种登录方式的端点与报文（2026-10-07 bundle 反解 + 实测）
metadata:
  type: project
  scope: GitCode 账号登录自动化
  status: active
  last_verified: 2026-10-07
---

实现见 `autocannlab/auth.py`（LoginClient）。全部端点挂 `web-api.gitcode.com`，需 WAF 过检（见 [[gitcode-cannlab-api-map]]），登录请求带 `x-source` 打点头（非认证字段）。

| 方式 | 流程 |
|---|---|
| 扫码 | `POST /uc/api/v1/qrcode/wechat_mini_program`（返回 base64 图片+scene_id）→ `GET` 同路径轮询（status: WAITING→…→EXPIRED）→ `POST /api/v1/user/oauth/login/qrcode/{platform}?scene_id=` 换令牌 |
| 短信 | `POST /api/v1/user/sms/send/codeByBiz` json `{mobile, biz_enum:"LOGIN", captcha_id, token, authenticate, validate}` → `POST /api/v1/user/oauth/login/mobile` form `{mobile, verification_code, mask}`（mask 取自发码响应） |
| 密码 | `POST /api/v1/user/oauth/login` form `{username, password, captcha_id, token, authenticate, validate}`；password 为 AES-CBC-Pkcs7(base64)，key `SA!nUNPZ5o!OSV&B` / iv `SA!nwwwZ5o!OSV&B`（前端内置常量，CryptoJS Utf8 语义） |

验证码：网易易盾，前端 SDK（`initNECaptchaWithFallback`，cdn-static.gitcode.com/js/yidun/yidun-captcha.js）在**用户浏览器**完成挑战产出 validate，随请求透传；captcha_id 取 `GET /uc/api/v1/captcha/config`（国内 NORMAL: 5df84d9b61b743e48dbb7b14abab7f13）。

登录成功响应为 `{data:{...tokens/user_status_enum}}` 双层包裹；`user_status_enum` 为 EMPTY_MOBILE/MFA_CHECK 时需额外流程（未实现，返回给 UI 提示）。

**Evidence:** 2026-10-07 bundle 反解（toLogin/loginByMobile/getQuickLoginMsg/createMiniProgramQRCode）；QR 创建+轮询实测通过（base64 图片）；AES 回环验证；服务器部署后 /api/auth/qr 实测返回真实二维码。

**Recheck when:** 登录返回结构化错误码（验证码校验失败/参数缺失）或 GitCode 更换验证码服务商。

**Why:** 登录端点无文档、密码有非标准加密，全部只能反解获得；用户纠正过「登录方式必须保留，否则产品不可用」。

**How to apply:** 三种方式已在 UI 可用；SMS/密码链路的端到端确认依赖首次真实登录（QR 已实测）。
