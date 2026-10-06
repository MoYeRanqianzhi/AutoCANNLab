---
name: ui-prototype
description: Web 控制台与后端的接入边界：哪些真实、哪些仍是演示
metadata:
  type: project
  scope: web/ 管理台
  status: active
  last_verified: 2026-10-07
---

`web/` 已于 2026-10-07 接入真实后端（`autocannlab/server.py`，Bearer Token 鉴权）。

**真实功能**：账号登录态导入（Refresh Token 现场校验+轮换）、账号备注/默认/暂停/删除、
代理节点 CRUD 与连通性实测、定时计划保存（内置调度器）、提交 daily/full 执行并跟踪、
真实任务清单与积分、服务端日志查看。

**仍为演示（明确标注）**：扫码/短信/密码/OAuth 登录页签（GitCode 登录有易盾验证码，
无法自动化，添加账号只能走登录态导入）、工作台趋势图（本地演示数据）、任务单选执行
（引擎按审批链路整链执行，幂等跳过已完成步骤，不做单任务投递）。

**Why:** 用户要求接入真实功能时重新核对了 [[risk-policy-and-scope]]；演示与真实的边界
必须在 UI 文案与代码注释里保持诚实，不能让界面按钮暗示未授权的动作。

**How to apply:** 改 UI 时维持这条边界；新增界面动作前先在服务端实现并送审；
「登录态导入」是唯一的新增账号途径。部署形态见 [[server-deployment]]。

**Evidence:** `web/src/api.ts`（唯一 API 客户端）；server.py 端点清单；浏览器实测截图与
服务器部署验证（2026-10-07）。

**Recheck when:** 服务端新增动作类型、登录方式变化、或 UI 出现无后端支撑的新按钮。
