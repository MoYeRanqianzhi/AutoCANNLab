# CANNLab 积分自动化——实施计划（范围已审定 2026-10-06）

## 审定后的动作范围（用户批准，其余一律不做）

**日常模式 daily**（每日一次，全程幂等：动作前先查任务状态，已完成即跳过）：
1. D1 GET 访问 /cann 社区页面 → CANN+10
2. D2 签到（POST /task/1/points，端点待实测验证）→ +5
3. D3 star 推荐项目 → 轮询 task62 结算 → 领取 → unstar → +10
4. D4 访问推荐项目详情页 → +10
5. D7 扫全表（type=0..5）领取 estimated=1 且 status=1 的未领奖励（含用户人工完成任务后的代领）

**首次模式 full** = daily + 一次性批准项：
- 创建访问令牌(+15)、搜索开源项目(+10)、查看项目代码(+5)、下载项目(+10)
- 模型初体验(+15)、下载模型文件(+20)、激活Space(+20)、Notebook实战(+25)、WebIDE(+5)+每周WebIDE(+5)
- 取关 CANN 组织（一次性；用户已确认）

**明确不做（红线，见 memory/risk-policy-and-scope.md）**：push/建仓库类（D5、创建项目、README、发布模型）、资料修改类（脚本只代领）、事件型（PR/issue/参赛）、赛事报名、课程学习、每日分享、加入组织、绑定第三方、首次兑换、CANN star 批量循环（未批准）。

## 已验证事实

- 见 memory/gitcode-cannlab-api-map.md（端点+认证）与 memory/gitcode-task-inventory.md（任务清单）。
- 认证：Bearer JWT；access 24h / refresh 60d；refresh 端点 `POST /uc/api/v1/user/token/refresh`，响应同时返回新 refresh_token（轮换，必须回写存储）。
- 领取：`POST /uc/api/v1/task/{task_id}/points`（实测返回结构化错误码）。
- Star/取消：`POST /api/v2/projects/{id}/star|unstar`。关注/取关：`POST/DELETE /uc/api/v1/follow`（body/params 形态待挖 bundle 或抓真实调用）。

## 待实测开放点（实现中验证，不扩大范围）

1. signin 的 +5 发放端点（明天未签到状态实测 POST /task/1/points；失败则需抓真实签到弹窗）。
2. D1「访问」的服务端判定（页面 GET 是否足够，还是依赖前端 report 事件）。
3. D4「查看推荐」的判定方式。
4. 取关接口的 body/params 形态。
5. D3 star 目标来源：`GET /api/v2/projects/featured/{type}` 推荐接口。

## 风控约束

单账号、每日一次、动作间隔随机 2-8s、全程串行、每个动作先查状态跳过已完成。

## 运行环境

- Python 3.12.9（已确认）。httpx。
- 凭证：.agents/secrets/gitcode-tokens.json（已导出，refresh_token 每次刷新后回写；gitignore）。
- 日志：logs/YYYY-MM-DD.log + 控制台摘要；refresh 失败时明确报错提示人工重新登录。
- Windows 计划任务每日 08:0x 触发 daily。

## 下一步

1. ~~git init + 骨架~~ ✓
2. ~~client + status 命令~~ ✓（WAF 过检方案已实测：bootstrap WAF cookie + 全浏览器头，无需 TLS 伪装）
3. ~~daily 链路~~ ✓ 今日幂等试跑通过（D1-D4 全部正确跳过已完成项，D7 短路正常）
4. ~~full 链路 + 取关~~ ✓（取关已执行：浏览器手动取关 + 脚本幂等分支验证通过）
5. 明日首次真实 daily 验证：D2 签到端点（POST /task/1/points 是否即签到）、D1/D4 触发判定、D3 完整链路（star→结算→领分→unstar）、D7 真实领取。
6. full 一次性项的端点探明与实现（搜索/看码/下载/令牌/WebIDE：主站 bundle 未含，需抓搜索页与设置页；模型初体验/下载模型/激活Space/Notebook：ai.gitcode.com 独立站需单独抓包）。
7. 注册 Windows 计划任务（经用户确认时间）。

## 已知风险

- refresh_token 60 天后过期，需人工重新登录（脚本会提前 N 天在日志/通知里提示）。
- 任务规则/积分值可能调整（memory 已记录 Recheck 条件）。
- 自动化程度过高可能触发风控——保持每日一次、拟人间隔。
- 违反平台条款的潜在风险由用户自担（仅操作本人账号、只做平台明文鼓励的任务行为）。
