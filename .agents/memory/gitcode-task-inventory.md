---
name: gitcode-task-inventory
description: GitCode 成长中心与 CANN 任务的全量清单、积分值、结算机制（2026-10-06 抓包）
metadata:
  type: project
  scope: gitcode.com 任务系统自动化
  status: active
  last_verified: 2026-10-06
---

来源：`GET web-api.gitcode.com/uc/api/v1/task?type=0|1|4`（登录态抓包）。字段含义见 [[gitcode-cannlab-api-map]]。

**CANN 积分任务（type=4，共 8 个）——自动化主目标**

| task_id | name | 名称 | 积分 | 周期 | 结算 | 备注 |
|---|---|---|---|---|---|---|
| 96 | CANN_COMMUNITY_VISIT | 访问 CANN 社区 | +10 | 每日 | 自动 | 访问 /cann 下任意页面，1h 内结算 |
| 105 | cann-study-part | CANN 社区课程学习 | +200 | 每日×8 | 自动 | 跑完 1 个 notebook 小节（.ipynb 全部代码运行）+200，日上限 8 次=1600；仅打开不运行不奖励 |
| 104 | cann-star-project-v2 | Star 一个 CANN 项目 | +50 | 每项目1次 | 自动 | 不同项目可重复得；star 后领分再 unstar |
| 97 | cann-issue-accepted | 提交 issue 并被接收 | +100 | 事件型 | 自动 | 当月封顶 5000 |
| 99 | cann-event-signup | 赛事报名 | +200 | 每赛事1次 | 自动 | **一天可多次**（多报赛事） |
| 100 | cann-event-submit-code | 有效参赛 | +1000 | 事件型 | 自动 | 竞赛仓 PR 被合入 |
| 102 | cann-merge-pr | 提交 PR 被合并 | +5000 | 事件型 | 自动 | 向 CANN 项目（非竞赛仓）PR 合并，当月封顶 5000 |
| 94 | cann-follow-group | 关注 CANN 社区 | +200 | 1次 | 自动 | 本账号已完成（2026-10-05 结算） |

**GitCode 每日任务（type=1，period=4，estimated=1 需主动领取）**

| task_id | name | 名称 | 积分 |
|---|---|---|---|
| 1 | signin | 每日签到 | +5（连续签到序列 [5,5,10,5,5,5,15]） |
| 62 | daily-star-project | 每日 Star 一个项目 | +10 |
| 59 | daily-view-recommended | 每日查看热门/推荐项目 | +10 |
| 60 | daily-update-project | 每日更新项目 1 次 | +10 |
| 77 | daily-invite-share | 每日分享 | +10 |
| 107 | month-use-atomcode | 月度挑战：AtomCode | +20（period=1，每月重置，自动发放） |

**GitCode 一次性任务（type=0/1，部分高价值）**：更新个性化设置 +100(成长+15)、首次积分兑换 +50、绑定 GitHub/Gitee/CSDN 各 +5、完善资料 +20、创建开源项目 +20 等，全量见 task?type=0 响应。

**每日自动化收益估算**：GitCode 积分 45/日（5+10+10+10+10）；CANN 积分保底 10/日（访问社区），加上课程学习最高 1600/日；CANN 一次性储备：CANN org 多仓库 star 循环 + 赛事报名。

**领取机制补充（2026-10-06 实测）**：

- `status=1` 不区分「待领取」与「已领取」——已领过的任务同样显示 status=1，不能作为可领取判据。
- 真实待领取信号：`GET /uc/api/v1/task/total-unclaimed-rewards` 返回的数字；为 0 时无需扫描。
- **领取窗口有限**：3 月完成的任务（task 56）现已报「已超过可领取次数」——代领必须当天完成当天领。
- 每日签到（task 1）的 +5 由签到动作本身发放，`POST /task/1/points` 返回 1002「任务未完成」；网页端签到端点尚未探明（明日未签到状态实测）。

**用户规则**：star/关注类任务领分后一律取消（unstar/取关）。结算为服务端自动（1h 内，实测 star 结算约在行为后数分钟的 compile_time 记录），领取与取消之间需轮询 `task?type=4` 确认 current_count 已计。

**Evidence:** task 列表 API 响应全文（2026-10-06）；成长中心 UI 截图核对（cann-tasks.png）。

**Recheck when:** 任务增删或积分值调整（start_time/end_time/重置周期变化）；结算规则变化。

**Why:** task_id、积分值、结算方式是编程领取的全部依据，页面抓取一次的成本高。

**How to apply:** 脚本按 status(current_count) 判断动作；estimated=1 的完成后调 POST /task/{id}/points；事件型任务无需领取调用。
