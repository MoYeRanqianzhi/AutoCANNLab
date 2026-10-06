---
name: ui-prototype
description: 修改 React 管理台或准备接入 Python 后端时，先确认 UI 原型与真实自动化的边界
metadata:
  type: project
  scope: web/ 管理台
  status: active
  last_verified: 2026-10-07
---

`web/` 是独立的交互原型，所有账号、登录方式、代理检测、积分与任务执行均为本地演示。
其构建、托管方式和页面能力以 [README](../../README.md#ui-交互原型) 为准。

**Why:** 用户明确要求只负责 UI，不接入真实功能；界面中可操作的按钮不能作为真实自动化已经实现或获得执行授权的证据。

**How to apply:** 修改页面时保持与真实账号及 Python CLI 隔离。后续接入真实功能需要新的任务范围，并重新核对 [[risk-policy-and-scope]] 和 [[gitcode-task-inventory]]，不能按演示状态推断接口行为。

**Evidence:** 2026-10-06 用户对 React 静态 UI 原型的明确要求；`web/src/data.ts` 的虚构数据、`web/src/App.tsx` 的本地状态与模拟计时器；生产构建在 Python 静态服务器下通过浏览器交互检查。

**Recheck when:** 用户要求接入后端、登录、代理或真实定时执行，或前端增加网络请求和持久化。
