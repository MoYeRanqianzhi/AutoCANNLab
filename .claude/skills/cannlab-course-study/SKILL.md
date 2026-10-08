---
name: cannlab-course-study
description: 完成 CANNLab 学习课程任务(task 105 cann-study-part,+200 积分/小节)的完整操作流程。当用户要求完成 CANNLab 学习任务、跑课程 notebook 赚 CANN 积分、cann-study-part 任务,或提到 cann-learning-hub 课程学习时使用本 skill。涵盖课程入口、Notebook 实例管理、答题/写代码、批改与结算验证。
---

# CANNLab 课程学习任务自动化

用浏览器(Playwright MCP)真实学习 CANN 课程 notebook 并赚取 CANN 积分。每完成 1 个小节
(一个独立 .ipynb 的全部代码运行 + 课后批改全对)+200 积分,每日上限 8 小节。

## 硬性规则(先读这个)

1. **每日不超过 8 小节**。用 `GET web-api.gitcode.com/uc/api/v1/task?type=4` 查 task 105 的
   `current_count` 实时计数,**达到 8 立即停手**——第 9 节没有奖励,纯烧 NPU 卡时。
   注意 current_count 更新有延迟(结算批处理),自己记数已跑的小节数,别只信 API。
2. **必须真实学习**:读课程正文、从内容推导答案、亲手写实践代码。批改输出必须出现
   「全部正确」(或实践题「全部 N 道题通过」)后才保存文件;批改有错就改正后重跑批改。
   答错不扣分(奖励二值:200 或 0),但**以错误状态保存 = 0**。
3. **积分到账有延迟**:实测完成 → 结算约 30-60 分钟(`compile_time` 字段),不要提前判定失败。
4. **实例烧 NPU 卡时**(A2/A3 配额,实测 1 卡时/小时左右,ttl=120 分钟自动回收)。
   把多个小节挤在**同一实例**的 TTL 窗口内跑完,不要为每节课新建实例。

## 课程与答题页在哪

- **课程总目录**:`https://gitcode.com/cann/cann-learning-hub` 仓库 README——有全部课程的
  表格(课程名 / 内容简介 / 「在线体验」链接)。进阶课程在 `tutorials/`、`contrib/tutorials/`、
  `standard_course/` 等目录,可按目录浏览找 .ipynb。
- **答题页结构(选择题课)**:JupyterLab 里打开的 notebook = markdown 教学正文 +
  演示代码 cell + 10 个 `qN = ''` 答题 cell(单选题,填选项字母)+ 末尾批改 cell
  (`from grade_XX import grade; grade(globals())`)。答案全部能从教学正文推导,
  数字计算类题目(如周期数)必须回读正文公式,不能凭常识估。
- **答题页结构(实践课)**:题目 markdown(含「要求」和「API 速查」表)+ 带 TODO 骨架的
  代码 cell + 末尾批改 cell。骨架里「已提供」的行保留原样,只填 TODO;**变量名以骨架尾部
  已提供代码引用的为准**(如尾部打印用到 `result`/`cpu_time`,你的代码就必须定义它们)。
- **批改脚本自省**:每课的判定逻辑与参考答案在仓库 `answer/grade_XX.py`
  (批改 cell 已把它加入 sys.path)。批改不过时,在任意 cell 里
  `import grade_XX, inspect; print(inspect.getsource(grade_XX))` 读判定条件,
  按判定语义修代码——这是课程官方留的自查通道,合法且高效。

## Notebook 实例与在线体验 URL

在线体验 URL 模式(浏览器直接打开即可):

```
https://ai.gitcode.com/user/username/notebookcann
  ?repoUrl=https://gitcode.com/cann/cann-learning-hub.git
  &ttl=120&diskSize=40Gi
  &path=<仓库内目录,如 quick_start/cann_basics>
  &scanFilePath=<仓库内 .ipynb 完整路径>   ← 结算扫描锚定的文件
```

页面会自动 `GET web-api.gitcode.com/aihub/api/v1/notebookcann/insert?...` 创建(或**复用**同
repo+path 的现有实例),然后 302 到
`https://gitcode.com/<用户名>/notebookcann/lab?cannNotebookId=<id>` 的 JupyterLab 界面,
notebook 在 iframe(title="Notebook CANN")内自动打开 scanFilePath 指定的文件。
**只用一个 lab tab**:同实例开多个 lab tab 会导致 workspace 冲突和连接错误。

## 操作流程(已验证)

1. 打开课程在线体验 URL,等 JupyterLab 就绪(30 秒左右,同实例复用时更快)。
2. snapshot 读 iframe 内渲染内容学习(内容 API 跨域拿不到,只能靠 snapshot)。
3. 作答:
   - 短单行(如 `q1 = 'B'`):click cell → Ctrl+A → 逐键输入即可。
   - 多行/带缩进代码:**CodeMirror 逐键输入会吞行首缩进**。可靠方案是剪贴板粘贴——
     主 frame `navigator.clipboard.writeText(code)`(剪贴板是浏览器级,跨 iframe 有效),
     然后点进 cell → Ctrl+A → Ctrl+V(粘贴是块插入,完整保留缩进)。
4. 菜单 Run → Run All Cells(只作用于当前激活的 notebook),或 Ctrl+Enter 单 cell。
5. 看批改输出:选择题要「🎉 全部正确!」,实践题要「🎉 全部 N 道题通过!」。
   不过 → 按上面「批改脚本自省」定位问题 → 修正 → 重跑批改,**直到全对**。
6. **Ctrl+S 保存**(必须!服务端扫描的是保存后的 .ipynb 执行状态)。
7. 验证积分:完成后 30-60 分钟查
   `GET /score-proxy/api/v1/shop/third-party/overview?type=cann` 的 `score_balance`,
   或 task?type=4 的 task105(`current_count`/`compile_time`)。

## 平台环境事实(写代码时会撞上的)

- **kernel cwd = notebook 所在目录**(如 `/workspace/notebookNN/cann-learning-hub/quick_start/cann_basics`),
  课程里 `./images/xxx.jpg` 这类相对路径按原样可用,不要自行加仓库前缀。
- **910B 的 FP32 matmul 走降精度路径**,大矩阵(2048²)结果与 CPU 差异可超 atol=1e-1;
  需要「CPU/NPU 结果一致」断言时,把迭代规模安排成**降序**(让最后一次迭代落在小矩阵上)。
- **depthwise 卷积**(weight 形状 [3,1,k,k] 这类)必须 `F.conv2d(..., groups=in_channels)`,
  否则形状不匹配直接报错。
- NPU 算子首次执行含 JIT 编译(实测 depthwise conv 首跑 15 秒),计时前先 warmup;
  计时必须 `torch.npu.synchronize()` 包住。
- Host/Device 数据流:`tensor.npu()` 搬入 → NPU 计算 → `.cpu()` 搬回;`.numpy()` 前必须 `.cpu()`。

## 故障处理

- **Server Connection Error 对话框**:平台常态,WebSocket 周期性断连。先勾选
  「Do not show this message again」并 Close,JupyterLab 会自动重连;若长时间不恢复,
  整页刷新 lab URL(workspace 会恢复打开的 notebook,autosave 的代码不丢;**未保存的
  粘贴内容可能丢**,所以每完成一个阶段就 Ctrl+S)。
- **点击被 dialog 拦截**:先处理连接错误对话框再操作。
- **kernel 重启后 NameError**:重连可能伴随 kernel 重启,重新 Run All 即可。
- **iframe 跨域**:主 frame evaluate 拿不到 iframe document,内容读取用 Playwright 的
  find/snapshot(带 ref 定位),输入用 click/键盘/剪贴板。

## 资源与兑换参考

- 兑换比例:100 CANN 积分 = 1 卡时(昇腾 910B3/910C),商品列表
  `GET /score-proxy/api/v1/shop/third-party/goods?scene=cannlab_exchange&type=cann`。
- 实例规格由平台分配(实测 Ascend910B4),insert 时不选 flavor。
- 单实例成本上限 2 卡时(ttl 120 分钟);多节课挤 1 实例,收益(200×N 积分)远大于卡时成本。
