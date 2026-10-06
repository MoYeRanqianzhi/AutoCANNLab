---
name: risk-policy-and-scope
description: 用户对自动化动作的风险红线与审核流程要求（2026-10-06 明确）
metadata:
  type: feedback
  scope: AutoCANNLab 全部自动化动作
  status: active
  last_verified: 2026-10-06
---

用户明确要求（2026-10-06）：

1. **赛事报名（cann-event-signup，+200）不做**。
2. **有严重风险的东西一律不做**——宁可放弃积分来源，不做可能触发风控封号/内容审查回收的行为。
3. **首次与日常两种模式的全部动作必须先列举给用户审核，批准后才实现/执行**。
4. star/关注类任务领分后一律取消（unstar/取关）。

**Why:** 账号安全优先于积分收益；用户对 GitCode 风控的容忍度低。

**How to apply:** 任何新增动作类型先进入审核清单，经用户批准后才写入代码；对每个动作标注风险等级与依据；事件型/贡献类任务（PR 合并、issue 被接收、有效参赛）只做被动接收结算，不主动伪造。见 [[gitcode-task-inventory]]。
