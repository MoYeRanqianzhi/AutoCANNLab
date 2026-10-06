# AutoCANNLab

CANNLab 自动获取积分。通过 GitCode 成长中心任务系统与 CANN 积分接口，自动完成
每日签到、访问 CANN 社区、star/浏览类任务并领取奖励，攒 CANN 积分兑换 NPU 卡时。

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
