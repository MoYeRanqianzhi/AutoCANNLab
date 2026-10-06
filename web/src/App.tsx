import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Avatar,
  Badge,
  Empty,
  Icon,
  Logo,
  Modal,
  OrbitArt,
  Select,
  TaskTable,
  Toggle,
  TrendChart,
} from "./components";
import {
  demoId,
  initialAccounts,
  initialLogs,
  initialProxies,
  initialSchedule,
  initialTasks,
  navigation,
  nextSchedule,
  weekdays,
  type Account,
  type LogEntry,
  type Page,
  type ProxyNode,
  type Schedule,
  type Task,
} from "./data";

type DialogState =
  | { type: "login"; accountId?: string }
  | { type: "schedule" }
  | { type: "proxy"; id?: string }
  | { type: "account"; id: string }
  | { type: "remove-account"; id: string }
  | { type: "remove-proxy"; id: string }
  | { type: "full" }
  | { type: "search" }
  | { type: "help" }
  | null;
type Run = { accountId: string; ids: string[]; index: number };
const statusLabels = {
  online: "登录有效",
  expired: "登录已过期",
  paused: "已暂停",
};
const pageDescriptions: Record<Page, string> = {
  overview: "每一份积累，都在为下一次探索蓄力。",
  tasks: "把重复的日常交给自动化，把专注留给创造。",
  schedule: "安排一个合适的时间，让积累成为习惯。",
  accounts: "一个工作台，照顾每一个 GitCode 账号。",
  proxies: "为不同账号安排合适的网络连接。",
  logs: "每一步都有迹可循，每一份收获清晰可见。",
};

// hash 路由不需要服务器 rewrite，刷新或直接打开子页面都能由静态文件恢复。
function pageFromHash(): Page {
  const value = window.location.hash.replace("#/", "");
  return navigation.some((item) => item.id === value)
    ? (value as Page)
    : "overview";
}

export default function App() {
  // 页面共享同一份会话状态，切换导航不会清空演示；刷新页面则从 data.ts 重新开始。
  // 账号凭证不进入这些状态，任务列表按账号隔离，默认标记与当前浏览账号分别管理。
  const [page, setPage] = useState<Page>(pageFromHash);
  const [mobileNav, setMobileNav] = useState(false);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [activeId, setActiveId] = useState("a1");
  const [defaultId, setDefaultId] = useState("a1");
  const [proxies, setProxies] = useState(initialProxies);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [taskSets, setTaskSets] = useState<Record<string, Task[]>>(() =>
    Object.fromEntries(
      initialAccounts.map((account) => [
        account.id,
        initialTasks.map((task) => ({
          ...task,
          status: account.id === "a1" ? task.status : "pending",
        })),
      ]),
    ),
  );
  const [logs, setLogs] = useState(initialLogs);
  const [run, setRun] = useState<Run | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("all");
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [testingProxy, setTestingProxy] = useState<string | null>(null);
  const proxyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAccount = accounts.find((account) => account.id === activeId)!;
  const tasks = taskSets[activeId] || [];
  const daily = tasks.filter((task) => task.category === "daily");
  const done = daily.filter((task) => task.status === "done").length;
  const isRunning = run !== null;
  const notify = useCallback((message: string) => setToast(message), []);
  const addLog = useCallback(
    (message: string, level: LogEntry["level"] = "info") => {
      setLogs((current) => [
        {
          id: demoId(),
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          message,
          level,
        },
        ...current,
      ]);
    },
    [],
  );

  useEffect(() => {
    document.title = `AutoCANNLab · ${navigation.find((item) => item.id === page)?.label}`;
  }, [page]);

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setMobileNav(false);
      window.scrollTo(0, 0);
    };
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog({ type: "search" });
      }
      if (event.key === "Escape") setMobileNav(false);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onShortcut);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onShortcut);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3800);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () => () => {
      if (proxyTimer.current) clearTimeout(proxyTimer.current);
    },
    [],
  );

  // 任务仅通过本地计时器模拟。保存运行所属账号，确保页面切换不改变奖励归属。
  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(() => {
      const task = initialTasks.find((item) => item.id === run.ids[run.index])!;
      const nextId = run.ids[run.index + 1];
      setTaskSets((current) => ({
        ...current,
        [run.accountId]: current[run.accountId].map((item) =>
          item.id === task.id
            ? { ...item, status: "done" }
            : item.id === nextId
              ? { ...item, status: "running" }
              : item,
        ),
      }));
      if (task.currency === "CANN")
        setAccounts((current) =>
          current.map((account) =>
            account.id === run.accountId
              ? { ...account, points: account.points + task.points }
              : account,
          ),
        );
      addLog(
        `${task.name} · 演示完成${task.points ? `，+${task.points} ${task.currency} 积分` : "，待领奖励检查完毕"}${task.id === "star" ? "，已模拟取消 Star" : ""}`,
        "success",
      );
      if (nextId) setRun({ ...run, index: run.index + 1 });
      else {
        setRun(null);
        notify("本次任务演示已完成，积分与日志已更新");
      }
    }, 1100);
    return () => clearTimeout(timer);
  }, [run, addLog, notify]);

  function navigate(target: Page) {
    window.location.hash = `/${target}`;
    setMobileNav(false);
  }
  function startRun(ids: string[]) {
    if (isRunning) return;
    if (activeAccount.status !== "online") {
      setDialog({ type: "login", accountId: activeId });
      return;
    }
    const pending = ids.filter(
      (id) => tasks.find((task) => task.id === id)?.status === "pending",
    );
    if (!pending.length) {
      notify("所选任务均已完成，明天再来继续积累");
      return;
    }
    setTaskSets((current) => ({
      ...current,
      [activeId]: current[activeId].map((task) =>
        task.id === pending[0] ? { ...task, status: "running" } : task,
      ),
    }));
    setRun({ accountId: activeId, ids: pending, index: 0 });
    addLog(`${activeAccount.name} · 开始模拟执行 ${pending.length} 项任务`);
  }
  function stopRun() {
    if (!run) return;
    setTaskSets((current) => ({
      ...current,
      [run.accountId]: current[run.accountId].map((task) =>
        task.status === "running" ? { ...task, status: "pending" } : task,
      ),
    }));
    setRun(null);
    addLog("任务演示已停止，未完成任务可继续执行", "warning");
    notify("已停止，已完成的任务进度已保留");
  }
  function saveSchedule(value: Schedule) {
    setSchedule(value);
    setDialog(null);
    notify("定时计划已保存到本次演示");
    addLog(
      `演示计划已更新：${value.time} · ${value.mode === "daily" ? "日常任务" : "全部任务"}`,
    );
  }
  function loginComplete(name: string) {
    // 只变更虚构账号的展示状态。新增账号从零进度开始，刷新登录保留原任务与积分。
    if (dialog?.type !== "login") return;
    if (dialog.accountId) {
      setAccounts((current) =>
        current.map((account) =>
          account.id === dialog.accountId
            ? { ...account, status: "online" }
            : account,
        ),
      );
      addLog("账号登录状态已刷新（模拟）", "success");
    } else {
      const id = demoId();
      setAccounts((current) => [
        ...current,
        {
          id,
          name: name || "新的工作空间",
          handle: `demo_${current.length + 1}`,
          color: "purple",
          status: "online",
          proxy: "direct",
          points: 0,
        },
      ]);
      setTaskSets((current) => ({
        ...current,
        [id]: initialTasks.map((task) => ({ ...task, status: "pending" })),
      }));
      addLog(`已添加演示账号：${name || "新的工作空间"}`, "success");
    }
    setDialog(null);
    notify("登录演示成功，账号状态已更新");
  }
  function testProxy(id: string) {
    // 延迟是固定的演示值，计时器仅呈现检测中的视觉状态，不建立网络连接。
    if (testingProxy) return;
    setTestingProxy(id);
    proxyTimer.current = setTimeout(() => {
      setProxies((current) =>
        current.map((proxy) =>
          proxy.enabled && (id === "all" || proxy.id === id)
            ? {
                ...proxy,
                latency: proxy.id === "p1" ? 42 : proxy.id === "p2" ? 86 : 18,
              }
            : proxy,
        ),
      );
      setTestingProxy(null);
      notify("模拟连通性检测完成，未发起网络请求");
    }, 900);
  }
  function exportLogs() {
    // 将当前筛选结果生成浏览器内存文件，下载后释放对象 URL，不写入服务器日志。
    const blob = new Blob(
      [
        "AutoCANNLab 演示日志\n",
        ...filteredLogs.map(
          (log) => `[${log.time}] ${log.level.toUpperCase()} ${log.message}\n`,
        ),
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "autocannlab-demo.log";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("演示日志已导出");
  }
  const filteredTasks = tasks.filter(
    (task) =>
      (taskFilter === "all" ||
        task.category === taskFilter ||
        task.status === taskFilter) &&
      `${task.name}${task.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredLogs = logs.filter(
    (log) =>
      (logLevel === "all" || log.level === logLevel) &&
      log.message.toLowerCase().includes(logQuery.toLowerCase()),
  );
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const todayCann = daily
    .filter((task) => task.status === "done" && task.currency === "CANN")
    .reduce((total, task) => total + task.points, 0);
  const todayGit = daily
    .filter((task) => task.status === "done" && task.currency === "GitCode")
    .reduce((total, task) => total + task.points, 0);

  const scheduleSummary = (
    <>
      <div className="schedule-time">
        {schedule.time}
        <span>Asia/Shanghai</span>
      </div>
      <p className="muted schedule-repeat">
        {schedule.days.length === 7
          ? "每天"
          : schedule.days.length
            ? `每周${weekdays
                .filter((day) => schedule.days.includes(day.id))
                .map((day) => day.label)
                .join("、")}`
            : "未选择日期"}{" "}
        · {schedule.mode === "daily" ? "日常任务" : "全部任务"}
      </p>
      <div className="week-row">
        {weekdays.map((day) => (
          <span
            key={day.id}
            className={
              schedule.days.includes(day.id) && schedule.enabled
                ? "selected"
                : ""
            }
          >
            {day.label}
          </span>
        ))}
      </div>
      <div className="schedule-next">
        <span>
          <i className={schedule.enabled ? "status-dot" : "status-dot gray"} />
          下次运行
        </span>
        <strong>{nextSchedule(schedule)}</strong>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a className="brand-link" href="#/overview">
          <Logo />
        </a>
        <div className="workspace-label">
          <span>个人工作空间</span>
          <Badge>FREE</Badge>
        </div>
        <nav aria-label="主导航">
          {navigation.map((item, index) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              className={`nav-item ${page === item.id ? "active" : ""} ${index === 3 ? "nav-divider" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.preview && <span className="nav-preview">预览</span>}
              {item.id === "overview" && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <Icon name="sparkles" size={18} />
            </span>
            <strong>积小步，至千里。</strong>
            <p>
              让自动化打理日常，
              <br />
              让每一份专注更有价值。
            </p>
            <button onClick={() => setDialog({ type: "help" })}>
              了解工作台 <Icon name="arrowUp" size={15} />
            </button>
          </div>
          <button
            className="sidebar-help"
            onClick={() => setDialog({ type: "help" })}
          >
            <Icon name="help" size={18} />
            使用指南
            <Icon name="external" size={14} />
          </button>
          <div className="sidebar-version">
            <span>
              <i className="status-dot" /> UI 原型
            </span>
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Icon name="menu" />
            </button>
            <Icon name="overview" size={16} />
            <span>工作空间</span>
            <span className="crumb-divider">/</span>
            <strong>
              {navigation.find((item) => item.id === page)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              onClick={() => setDialog({ type: "search" })}
            >
              <Icon name="search" size={16} />
              <span>快速查找</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="prototype-badge">
              <i /> 交互原型
            </span>
            <a
              className="icon-button github-link"
              href="https://github.com/MoYeRanQianZhi/AutoCANNLab"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 开源仓库"
              title="在 GitHub 查看 AutoCANNLab"
            >
              <Icon name="github" size={19} />
            </a>
            <button
              className="icon-button notification"
              aria-label="查看运行提醒"
              onClick={() => {
                navigate("logs");
                setLogLevel("warning");
              }}
            >
              <Icon name="bell" size={19} />
              <i />
            </button>
            <span className="topbar-line" />
            <button
              className="profile-trigger"
              onClick={() => navigate("accounts")}
              aria-label="管理当前账号"
            >
              <Avatar account={activeAccount} small />
              <Icon name="down" size={14} />
            </button>
          </div>
        </header>

        <main id="main-content">
          <div className="page-heading">
            <div>
              {page === "overview" && (
                <div className="eyebrow">YOUR DAILY MOMENTUM</div>
              )}
              <h1>
                {page === "overview" ? (
                  <>
                    早上好，
                    {activeAccount.handle
                      .split("_")[0]
                      .replace(/^./, (character) => character.toUpperCase())}
                    <span className="greeting-dot">.</span>
                  </>
                ) : (
                  navigation.find((item) => item.id === page)?.label
                )}
                {(page === "accounts" || page === "proxies") && (
                  <Badge tone="purple">功能预览</Badge>
                )}
              </h1>
              <p>{pageDescriptions[page]}</p>
            </div>
            <div className="heading-actions">
              {page === "overview" ? (
                <span className="date-label">
                  <Icon name="calendar" size={16} />
                  2026 年 10 月 6 日<span>星期二</span>
                </span>
              ) : page === "accounts" ? (
                <button
                  className="button primary"
                  disabled={isRunning}
                  onClick={() => setDialog({ type: "login" })}
                >
                  <Icon name="plus" size={16} />
                  添加账号
                </button>
              ) : page === "proxies" ? (
                <>
                  <button
                    className="button"
                    disabled={!!testingProxy}
                    onClick={() => testProxy("all")}
                  >
                    <Icon
                      name={testingProxy ? "loader" : "activity"}
                      className={testingProxy ? "spin" : ""}
                      size={16}
                    />
                    检测全部
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setDialog({ type: "proxy" })}
                  >
                    <Icon name="plus" size={16} />
                    添加节点
                  </button>
                </>
              ) : page === "logs" ? (
                <button className="button" onClick={exportLogs}>
                  <Icon name="download" size={16} />
                  导出日志
                </button>
              ) : page === "schedule" ? (
                <button
                  className="button primary"
                  onClick={() => setDialog({ type: "schedule" })}
                >
                  <Icon name="edit" size={16} />
                  编辑计划
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={isRunning}
                  onClick={() => startRun(daily.map((task) => task.id))}
                >
                  <Icon name="play" size={16} />
                  执行日常任务
                </button>
              )}
            </div>
          </div>

          {page === "overview" && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <span className="hero-tag">
                    <i />
                    {isRunning
                      ? "日常正在有序进行"
                      : done === daily.length
                        ? "今日任务已完成"
                        : "一切就绪，开始今天的积累"}
                  </span>
                  <h2>
                    让日常自动发生<span>，</span>
                    <br />
                    让创造持续向前<span>。</span>
                  </h2>
                  <p>签到、探索、领取奖励。你的每一份积累，都值得被照顾。</p>
                  <div className="hero-actions">
                    {isRunning ? (
                      <button className="button primary" onClick={stopRun}>
                        <Icon name="pause" size={15} />
                        停止执行 · {run.index + 1}/{run.ids.length}
                      </button>
                    ) : (
                      <button
                        className="button primary"
                        onClick={() => startRun(daily.map((task) => task.id))}
                      >
                        <Icon
                          name={done === daily.length ? "checks" : "play"}
                          size={15}
                        />
                        {done === daily.length
                          ? "今日任务已完成"
                          : "执行日常任务"}
                      </button>
                    )}
                    <button
                      className="hero-secondary"
                      disabled={isRunning}
                      onClick={() => setDialog({ type: "full" })}
                    >
                      执行全部任务
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                </div>
                <OrbitArt />
                <div className="hero-bottom">
                  <span>
                    <Icon name="shield" size={13} />
                    有序执行 · 自动跳过已完成任务
                  </span>
                  <span>DAILY, EFFORTLESSLY.</span>
                </div>
              </section>

              <section className="stats-grid" aria-label="数据概览">
                <Stat
                  icon="wallet"
                  label="CANN 积分"
                  value={activeAccount.points.toLocaleString()}
                  unit="积分"
                  detail={
                    <>
                      <span className="stat-increase">
                        <Icon name="trend" size={13} />+{todayCann}
                      </span>
                      今日获得
                    </>
                  }
                  bars
                />
                <Stat
                  icon="zap"
                  label="今日 GitCode 收益"
                  value={`+${todayGit}`}
                  unit="积分"
                  detail={
                    <>
                      独立结算<span className="stat-detail-divider">·</span>
                      持续积累中
                    </>
                  }
                />
                <Stat
                  icon="checks"
                  label="日常任务进度"
                  value={`${done}`}
                  unit={`/ ${daily.length}`}
                  detail={
                    <>
                      <span className="stat-increase">
                        {Math.round((done / daily.length) * 100)}%
                      </span>
                      今日完成率
                    </>
                  }
                  progress={done / daily.length}
                />
                <Stat
                  icon="users"
                  label="在线账号"
                  value={`${accounts.filter((account) => account.status === "online").length}`}
                  unit={`/ ${accounts.length}`}
                  detail={
                    <>
                      <span className="small-dot amber" />
                      {
                        accounts.filter(
                          (account) => account.status === "expired",
                        ).length
                      }{" "}
                      个账号待刷新
                      <span
                        className="stat-link"
                        onClick={() => navigate("accounts")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            navigate("accounts");
                        }}
                      >
                        管理
                        <Icon name="arrowUp" size={13} />
                      </span>
                    </>
                  }
                />
              </section>

              <div className="dashboard-columns">
                <section className="panel daily-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        今日任务{" "}
                        <span className="heading-count">
                          {done}/{daily.length}
                        </span>
                      </h2>
                      <p>每天一点点，积累看得见</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("tasks")}
                    >
                      全部任务
                      <Icon name="right" size={15} />
                    </button>
                  </div>
                  <TaskTable
                    tasks={daily}
                    onRun={startRun}
                    running={isRunning}
                    compact
                  />
                  <div className="panel-foot">
                    <Icon name="refresh" size={13} />
                    任务每日重置，已完成项目会自动跳过<span>示例数据</span>
                  </div>
                </section>
                <section className="panel schedule-panel">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="clock" size={18} />
                      每日计划
                    </h2>
                    <Toggle
                      checked={schedule.enabled}
                      label="启用每日计划"
                      onChange={() =>
                        setSchedule((current) => ({
                          ...current,
                          enabled: !current.enabled,
                        }))
                      }
                    />
                  </div>
                  {scheduleSummary}
                  <button
                    className="button schedule-edit"
                    onClick={() => setDialog({ type: "schedule" })}
                  >
                    <Icon name="settings" size={15} />
                    调整定时计划
                  </button>
                  <div className="schedule-hint">
                    <Icon name="sparkles" size={14} />
                    好习惯，也可以自动养成。
                  </div>
                </section>
              </div>

              <div className="dashboard-bottom">
                <section className="panel trend-panel">
                  <div className="panel-heading">
                    <h2>
                      积分小记 <span className="muted small">CANN</span>
                    </h2>
                    <div className="segmented tiny">
                      <button
                        className={period === "week" ? "selected" : ""}
                        onClick={() => setPeriod("week")}
                      >
                        近 7 天
                      </button>
                      <button
                        className={period === "month" ? "selected" : ""}
                        onClick={() => setPeriod("month")}
                      >
                        近 30 天
                      </button>
                    </div>
                  </div>
                  <div className="trend-total">
                    +{period === "week" ? "70" : "300"}
                    <span>稳稳积累，慢慢发光</span>
                  </div>
                  <TrendChart period={period} />
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <h2>最近动态</h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        setLogLevel("all");
                        navigate("logs");
                      }}
                    >
                      查看日志
                      <Icon name="right" size={15} />
                    </button>
                  </div>
                  <div className="activity-list">
                    {logs.slice(0, 3).map((log) => (
                      <div className="activity-item" key={log.id}>
                        <span className={`activity-dot ${log.level}`}>
                          <Icon
                            name={
                              log.level === "success"
                                ? "check"
                                : log.level === "warning"
                                  ? "clock"
                                  : "refresh"
                            }
                            size={13}
                          />
                        </span>
                        <div>
                          <p>{log.message}</p>
                          <span>今天 {log.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}

          {page === "tasks" && (
            <>
              <div className="context-bar">
                <div>
                  <Avatar account={activeAccount} small />
                  <span>当前执行账号</span>
                  <Select
                    label="当前执行账号"
                    value={activeId}
                    disabled={isRunning}
                    onChange={setActiveId}
                    options={accounts.map((account) => ({
                      value: account.id,
                      label: account.name,
                    }))}
                  />
                </div>
                <button
                  className="text-button"
                  disabled={isRunning}
                  onClick={() => setDialog({ type: "full" })}
                >
                  执行全部任务
                  <Icon name="arrow" size={16} />
                </button>
              </div>
              <div className="task-summary">
                <div>
                  <span>日常任务</span>
                  <strong>
                    {done}
                    <small> / 5 完成</small>
                  </strong>
                </div>
                <div>
                  <span>一次性任务</span>
                  <strong>
                    {
                      tasks.filter(
                        (task) =>
                          task.category === "once" && task.status === "done",
                      ).length
                    }
                    <small> / 4 完成</small>
                  </strong>
                </div>
                <div>
                  <span>今日 CANN</span>
                  <strong>
                    +{todayCann}
                    <small> 积分</small>
                  </strong>
                </div>
                <div>
                  <span>今日 GitCode</span>
                  <strong>
                    +{todayGit}
                    <small> 积分</small>
                  </strong>
                </div>
              </div>
              {isRunning && (
                <div className="running-banner">
                  <Icon name="loader" className="spin" />
                  <span>
                    正在演示：
                    {tasks.find((task) => task.status === "running")?.name}
                    <small>
                      {" "}
                      {run.index + 1}/{run.ids.length}
                    </small>
                  </span>
                  <button onClick={stopRun}>停止执行</button>
                </div>
              )}
              <section className="panel">
                <div className="table-toolbar">
                  <div className="tabs" aria-label="任务筛选">
                    {[
                      { id: "all", label: "全部任务" },
                      { id: "daily", label: "日常任务" },
                      { id: "once", label: "一次性任务" },
                      { id: "pending", label: "待执行" },
                      { id: "done", label: "已完成" },
                    ].map((tab) => (
                      <button
                        className={taskFilter === tab.id ? "selected" : ""}
                        key={tab.id}
                        onClick={() => setTaskFilter(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      placeholder="搜索任务…"
                      aria-label="搜索任务"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                {filteredTasks.length ? (
                  <TaskTable
                    tasks={filteredTasks}
                    onRun={startRun}
                    running={isRunning}
                  />
                ) : (
                  <Empty
                    title="没有找到相关任务"
                    description="换一个关键词，或试试其他筛选条件。"
                  />
                )}
                <div className="panel-foot">
                  <Icon name="shield" size={14} />
                  全部任务包含日常与一次性任务的交互演示
                  <span>共 {filteredTasks.length} 项</span>
                </div>
              </section>
              <div className="inline-note">
                <Icon name="sparkles" size={17} />
                <p>
                  一步一步，有序完成。执行时会跳过已完成任务；停止后可以从剩余任务继续。
                </p>
              </div>
            </>
          )}

          {page === "schedule" && (
            <div className="schedule-layout">
              <section className="panel schedule-detail">
                <div className="panel-heading">
                  <div>
                    <Badge tone="green">每日自动化</Badge>
                    <h2 className="schedule-title">给日常，一个固定的时间</h2>
                  </div>
                  <Toggle
                    checked={schedule.enabled}
                    onChange={() =>
                      setSchedule((current) => ({
                        ...current,
                        enabled: !current.enabled,
                      }))
                    }
                    label="启用定时计划"
                  />
                </div>
                {scheduleSummary}
                <div className="schedule-details-grid">
                  <div>
                    <span>执行模式</span>
                    <strong>
                      {schedule.mode === "daily" ? "日常任务" : "全部任务"}
                    </strong>
                  </div>
                  <div>
                    <span>执行账号</span>
                    <strong>
                      {schedule.account === "all"
                        ? "全部在线账号"
                        : accounts.find(
                            (account) => account.id === schedule.account,
                          )?.name}
                    </strong>
                  </div>
                  <div>
                    <span>重复周期</span>
                    <strong>每周重复</strong>
                  </div>
                  <div>
                    <span>时区</span>
                    <strong>UTC+08:00 北京时间</strong>
                  </div>
                </div>
                <button
                  className="button primary"
                  onClick={() => setDialog({ type: "schedule" })}
                >
                  <Icon name="settings" size={16} />
                  编辑计划
                </button>
              </section>
              <div className="schedule-aside">
                <section className="panel next-run-card">
                  <span className="icon-tile">
                    <Icon name="calendar" size={24} />
                  </span>
                  <h2>下一次，准时见</h2>
                  <p>{nextSchedule(schedule)}</p>
                  <span>以演示日期 10 月 6 日 09:00 推算</span>
                  <div className="mini-timeline">
                    <div>
                      <i />
                      <span>检查账号登录状态</span>
                    </div>
                    <div>
                      <i />
                      <span>按顺序执行待办任务</span>
                    </div>
                    <div>
                      <i />
                      <span>汇总积分与运行记录</span>
                    </div>
                  </div>
                </section>
                <div className="inline-note">
                  <Icon name="help" size={19} />
                  <p>
                    计划设置为界面预览，保存仅在本次页面会话内生效，不会创建后台定时任务。
                  </p>
                </div>
              </div>
            </div>
          )}

          {page === "accounts" && (
            <>
              <div className="preview-note">
                <Icon name="users" size={19} />
                <div>
                  <strong>多账号，让管理更从容</strong>
                  <p>
                    预先体验账号切换、独立登录状态与代理分配。所有账号均为虚构示例。
                  </p>
                </div>
                <Badge tone="purple">规划中</Badge>
              </div>
              <div className="section-toolbar">
                <span>
                  全部账号 <b>{accounts.length}</b>
                  <span className="toolbar-separator">/</span>
                  <i className="status-dot" />
                  {
                    accounts.filter((account) => account.status === "online")
                      .length
                  }{" "}
                  个在线
                </span>
                <label className="search-field">
                  <Icon name="search" size={16} />
                  <input
                    aria-label="搜索账号"
                    placeholder="搜索名称或用户名…"
                    value={accountQuery}
                    onChange={(event) => setAccountQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="account-grid">
                {accounts
                  .filter((account) =>
                    `${account.name}${account.handle}`
                      .toLowerCase()
                      .includes(accountQuery.toLowerCase()),
                  )
                  .map((account) => (
                    <section
                      className={`panel account-card ${activeId === account.id ? "current-account" : ""}`}
                      key={account.id}
                    >
                      <div className="account-card-top">
                        <Avatar account={account} />
                        <div className="account-badges">
                          {defaultId === account.id && <Badge>默认</Badge>}
                          <Badge
                            tone={
                              account.status === "online"
                                ? "green"
                                : account.status === "expired"
                                  ? "orange"
                                  : "neutral"
                            }
                          >
                            <i
                              className={`small-dot ${account.status === "online" ? "" : "amber"}`}
                            />
                            {statusLabels[account.status]}
                          </Badge>
                        </div>
                        <button
                          className="icon-button"
                          disabled={isRunning}
                          aria-label={`编辑${account.name}`}
                          onClick={() =>
                            setDialog({ type: "account", id: account.id })
                          }
                        >
                          <Icon name="edit" size={17} />
                        </button>
                      </div>
                      <h2>{account.name}</h2>
                      <p className="account-handle">@{account.handle}</p>
                      <div className="account-metrics">
                        <div>
                          <span>CANN 积分</span>
                          <strong>{account.points.toLocaleString()}</strong>
                        </div>
                        <div>
                          <span>网络连接</span>
                          <strong className="network-name">
                            <Icon name="network" size={14} />
                            {account.proxy === "direct"
                              ? "直接连接"
                              : proxies.find(
                                  (proxy) => proxy.id === account.proxy,
                                )?.name}
                          </strong>
                        </div>
                      </div>
                      <div
                        className={`account-status-note ${account.status === "expired" ? "warning" : ""}`}
                      >
                        <Icon
                          name={
                            account.status === "expired" ? "clock" : "shield"
                          }
                          size={14}
                        />
                        {account.status === "online"
                          ? "登录状态正常 · 示例有效期 23 小时"
                          : account.status === "expired"
                            ? "登录已过期，请刷新后继续任务"
                            : "已暂停参与任务，可随时恢复"}
                      </div>
                      <div className="account-card-actions">
                        <button
                          className="button"
                          disabled={isRunning}
                          onClick={() =>
                            setDialog({ type: "login", accountId: account.id })
                          }
                        >
                          <Icon name="refresh" size={14} />
                          刷新登录
                        </button>
                        <button
                          className={`button ${activeId === account.id ? "selected-button" : ""}`}
                          disabled={isRunning || activeId === account.id}
                          onClick={() => {
                            setActiveId(account.id);
                            notify(`已切换至${account.name}`);
                          }}
                        >
                          {activeId === account.id ? (
                            <>
                              <Icon name="check" size={14} />
                              当前账号
                            </>
                          ) : (
                            "切换账号"
                          )}
                        </button>
                      </div>
                    </section>
                  ))}
                <button
                  className="add-account-card"
                  aria-label="连接新的 GitCode 账号"
                  disabled={isRunning}
                  onClick={() => setDialog({ type: "login" })}
                >
                  <span>
                    <Icon name="plus" size={25} />
                  </span>
                  <strong>连接新的 GitCode 账号</strong>
                  <p>每个账号，独立积累</p>
                </button>
              </div>
            </>
          )}

          {page === "proxies" && (
            <>
              <div className="preview-note">
                <Icon name="network" size={19} />
                <div>
                  <strong>连接，由你安排</strong>
                  <p>
                    管理 HTTP / SOCKS5
                    节点，为每个账号指定连接。延迟与连通性均为模拟结果。
                  </p>
                </div>
                <Badge tone="purple">规划中</Badge>
              </div>
              <div className="proxy-stats">
                <div>
                  <span className="icon-tile">
                    <Icon name="network" />
                  </span>
                  <div>
                    <strong>{proxies.length}</strong>
                    <span>代理节点</span>
                  </div>
                </div>
                <div>
                  <span className="icon-tile">
                    <Icon name="activity" />
                  </span>
                  <div>
                    <strong>
                      {proxies.filter((proxy) => proxy.enabled).length}
                    </strong>
                    <span>已启用</span>
                  </div>
                </div>
                <div>
                  <span className="icon-tile">
                    <Icon name="users" />
                  </span>
                  <div>
                    <strong>
                      {
                        accounts.filter((account) => account.proxy !== "direct")
                          .length
                      }
                    </strong>
                    <span>已分配账号</span>
                  </div>
                </div>
              </div>
              <section className="panel proxy-list">
                <div className="panel-heading">
                  <h2>我的节点</h2>
                  <span className="muted small">示例网络环境</span>
                </div>
                {proxies.length ? (
                  proxies.map((proxy) => (
                    <div className="proxy-row" key={proxy.id}>
                      <span
                        className={`proxy-globe ${!proxy.enabled ? "disabled" : ""}`}
                      >
                        <Icon name="globe" size={23} />
                      </span>
                      <div className="proxy-info">
                        <strong>
                          {proxy.name}
                          <Badge>{proxy.protocol}</Badge>
                        </strong>
                        <p>
                          {proxy.host}:{proxy.port}
                          <span>·</span>
                          {proxy.region}
                        </p>
                      </div>
                      <div className="proxy-latency">
                        <span
                          className={`signal ${proxy.enabled ? "connected" : ""}`}
                        >
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                        <strong>
                          {proxy.enabled
                            ? proxy.latency === null
                              ? "未检测"
                              : `${proxy.latency} ms`
                            : "已停用"}
                        </strong>
                        <small>{proxy.enabled ? "示例延迟" : "等待启用"}</small>
                      </div>
                      <div className="proxy-assigned">
                        <Icon name="users" size={15} />
                        {
                          accounts.filter(
                            (account) => account.proxy === proxy.id,
                          ).length
                        }{" "}
                        个账号
                      </div>
                      <Toggle
                        checked={proxy.enabled}
                        label={`启用${proxy.name}`}
                        onChange={() =>
                          setProxies((current) =>
                            current.map((item) =>
                              item.id === proxy.id
                                ? { ...item, enabled: !item.enabled }
                                : item,
                            ),
                          )
                        }
                      />
                      <div className="proxy-actions">
                        <button
                          className="icon-button"
                          disabled={!!testingProxy || !proxy.enabled}
                          aria-label={`检测${proxy.name}`}
                          onClick={() => testProxy(proxy.id)}
                        >
                          <Icon
                            name={
                              testingProxy === proxy.id ||
                              testingProxy === "all"
                                ? "loader"
                                : "activity"
                            }
                            className={
                              testingProxy === proxy.id ||
                              testingProxy === "all"
                                ? "spin"
                                : ""
                            }
                            size={17}
                          />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`编辑${proxy.name}`}
                          onClick={() =>
                            setDialog({ type: "proxy", id: proxy.id })
                          }
                        >
                          <Icon name="edit" size={17} />
                        </button>
                        <button
                          className="icon-button danger-hover"
                          aria-label={`移除${proxy.name}`}
                          onClick={() =>
                            setDialog({ type: "remove-proxy", id: proxy.id })
                          }
                        >
                          <Icon name="trash" size={17} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="还没有代理节点"
                    description="添加一个节点，即可预览账号与网络分配。"
                  />
                )}
              </section>
              <div className="direct-connection">
                <span className="icon-tile">
                  <Icon name="globe" size={21} />
                </span>
                <div>
                  <h3>直接连接</h3>
                  <p>未分配代理的账号使用默认网络。</p>
                </div>
                <Badge tone="green">默认连接</Badge>
                <span>
                  {
                    accounts.filter((account) => account.proxy === "direct")
                      .length
                  }{" "}
                  个账号
                </span>
              </div>
            </>
          )}

          {page === "logs" && (
            <>
              <div className="log-summary">
                <span className="status-dot" />
                演示运行记录<span>共 {logs.length} 条事件</span>
                <Badge>本次会话</Badge>
              </div>
              <section className="panel">
                <div className="table-toolbar">
                  <div className="tabs">
                    {[
                      { id: "all", label: "全部记录" },
                      { id: "success", label: "执行成功" },
                      { id: "info", label: "运行信息" },
                      { id: "warning", label: "需要关注" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        className={logLevel === tab.id ? "selected" : ""}
                        onClick={() => setLogLevel(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      aria-label="搜索日志"
                      value={logQuery}
                      onChange={(event) => setLogQuery(event.target.value)}
                      placeholder="搜索运行记录…"
                    />
                  </label>
                </div>
                <div className="log-table">
                  <div className="log-table-head">
                    <span>时间</span>
                    <span>级别</span>
                    <span>事件内容</span>
                  </div>
                  {filteredLogs.length ? (
                    filteredLogs.map((log) => (
                      <div className="log-row" key={log.id}>
                        <time>{log.time}</time>
                        <Badge
                          tone={
                            log.level === "success"
                              ? "green"
                              : log.level === "warning"
                                ? "orange"
                                : "neutral"
                          }
                        >
                          {log.level === "success"
                            ? "成功"
                            : log.level === "warning"
                              ? "提醒"
                              : "信息"}
                        </Badge>
                        <span>{log.message}</span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="暂时没有相关记录"
                      description="调整筛选条件，或执行任务来查看运行过程。"
                    />
                  )}
                </div>
                <div className="panel-foot">
                  <Icon name="logs" size={14} />
                  刷新页面将恢复初始演示记录
                  <span>{filteredLogs.length} 条记录</span>
                </div>
              </section>
            </>
          )}

          <footer className="page-footer">
            <span>
              <span className="footer-mark">A</span>AutoCANNLab
              <span className="footer-separator">/</span>为每一份创造积蓄能量
            </span>
            <span>
              <i className="small-dot" />
              示例数据 · 所有操作仅作交互演示
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Icon name="check" size={16} />
          </span>
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {dialog?.type === "login" && (
        <Modal
          title={dialog.accountId ? "刷新 GitCode 登录" : "连接 GitCode 账号"}
          subtitle="选择你习惯的方式，继续每一天的积累。"
          onClose={() => setDialog(null)}
        >
          <LoginForm onComplete={loginComplete} refresh={!!dialog.accountId} />
        </Modal>
      )}
      {dialog?.type === "schedule" && (
        <Modal
          title="安排每日计划"
          subtitle="一个固定的时间，让日常井然有序。"
          onClose={() => setDialog(null)}
        >
          <ScheduleForm
            schedule={schedule}
            accounts={accounts}
            onSave={saveSchedule}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
      {dialog?.type === "proxy" && (
        <Modal
          title={dialog.id ? "编辑代理节点" : "添加代理节点"}
          subtitle="配置连接信息，预览节点管理体验。"
          onClose={() => setDialog(null)}
        >
          <ProxyForm
            proxy={proxies.find((proxy) => proxy.id === dialog.id)}
            onSave={(proxy) => {
              setProxies((current) =>
                dialog.id
                  ? current.map((item) =>
                      item.id === dialog.id ? proxy : item,
                    )
                  : [...current, proxy],
              );
              setDialog(null);
              notify("节点信息已保存到本次演示");
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
      {dialog?.type === "account" && (
        <Modal
          title="账号设置"
          subtitle="管理显示名称、默认账号与网络连接。"
          onClose={() => setDialog(null)}
        >
          <AccountForm
            account={accounts.find((account) => account.id === dialog.id)!}
            proxies={proxies}
            isDefault={defaultId === dialog.id}
            onSave={(account, isDefault) => {
              setAccounts((current) =>
                current.map((item) =>
                  item.id === account.id ? account : item,
                ),
              );
              if (isDefault) setDefaultId(account.id);
              setDialog(null);
              notify("账号设置已更新");
            }}
            onRemove={() =>
              setDialog({ type: "remove-account", id: dialog.id })
            }
            canRemove={accounts.length > 1}
          />
        </Modal>
      )}
      {dialog?.type === "remove-account" && (
        <Modal
          title="移除这个演示账号？"
          subtitle="该账号在本次演示中的任务进度也会移除。"
          onClose={() => setDialog(null)}
        >
          <div className="confirm-content">
            <Icon name="users" size={30} />
            <strong>
              {accounts.find((account) => account.id === dialog.id)?.name}
            </strong>
          </div>
          <div className="form-actions">
            <button className="button" onClick={() => setDialog(null)}>
              保留账号
            </button>
            <button
              className="button danger"
              onClick={() => {
                const remaining = accounts.filter(
                  (account) => account.id !== dialog.id,
                );
                setAccounts(remaining);
                if (activeId === dialog.id) setActiveId(remaining[0].id);
                if (defaultId === dialog.id) setDefaultId(remaining[0].id);
                if (schedule.account === dialog.id)
                  setSchedule((current) => ({
                    ...current,
                    account: remaining[0].id,
                  }));
                setTaskSets((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([id]) => id !== dialog.id),
                  ),
                );
                setDialog(null);
                notify("演示账号已移除");
              }}
            >
              确认移除
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === "remove-proxy" && (
        <Modal
          title="移除这个代理节点？"
          subtitle="使用该节点的演示账号将改为直接连接。"
          onClose={() => setDialog(null)}
        >
          <div className="confirm-content">
            <Icon name="network" size={30} />
            <strong>
              {proxies.find((proxy) => proxy.id === dialog.id)?.name}
            </strong>
          </div>
          <div className="form-actions">
            <button className="button" onClick={() => setDialog(null)}>
              保留节点
            </button>
            <button
              className="button danger"
              onClick={() => {
                setProxies((current) =>
                  current.filter((proxy) => proxy.id !== dialog.id),
                );
                setAccounts((current) =>
                  current.map((account) =>
                    account.proxy === dialog.id
                      ? { ...account, proxy: "direct" }
                      : account,
                  ),
                );
                setDialog(null);
                notify("节点已移除，相关账号已改为直接连接");
              }}
            >
              确认移除
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === "full" && (
        <Modal
          title="把今天的任务，一并安排"
          subtitle="全部任务包括日常任务与一次性任务，已完成项目会跳过。"
          onClose={() => setDialog(null)}
        >
          <div className="full-preview">
            <span className="icon-tile">
              <Icon name="layers" size={27} />
            </span>
            <div>
              <strong>{pendingCount} 项待执行</strong>
              <p>{activeAccount.name} · 按顺序模拟执行</p>
            </div>
          </div>
          <div className="full-details">
            <div>
              <span>日常任务</span>
              <strong>
                {daily.filter((task) => task.status === "pending").length}{" "}
                项待执行
              </strong>
            </div>
            <div>
              <span>一次性任务</span>
              <strong>
                {
                  tasks.filter(
                    (task) =>
                      task.category === "once" && task.status === "pending",
                  ).length
                }{" "}
                项待执行
              </strong>
            </div>
            <div>
              <span>已完成任务</span>
              <strong>自动跳过</strong>
            </div>
          </div>
          <p className="form-note">
            <Icon name="help" size={15} />
            这是本地交互演示，不会执行 GitCode 操作。
          </p>
          <div className="form-actions">
            <button className="button" onClick={() => setDialog(null)}>
              稍后再说
            </button>
            <button
              className="button primary"
              disabled={!pendingCount || isRunning}
              onClick={() => {
                setDialog(null);
                startRun(tasks.map((task) => task.id));
              }}
            >
              <Icon name="play" size={15} />
              开始执行
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === "search" && (
        <Modal
          title="快速查找"
          subtitle="跳转页面，或找到你要执行的任务。"
          onClose={() => setDialog(null)}
        >
          <SearchContent
            onNavigate={(target) => {
              navigate(target);
              setDialog(null);
            }}
            onTask={(name) => {
              setQuery(name);
              setTaskFilter("all");
              navigate("tasks");
              setDialog(null);
            }}
          />
        </Modal>
      )}
      {dialog?.type === "help" && (
        <Modal
          title="欢迎来到 AutoCANNLab"
          subtitle="让日常自动发生，让创造持续向前。"
          onClose={() => setDialog(null)}
        >
          <div className="help-list">
            {[
              {
                icon: "play",
                title: "从工作台开始",
                text: "执行日常或全部任务，观察进度、积分和运行记录的变化。",
              },
              {
                icon: "calendar",
                title: "安排你的节奏",
                text: "选择每日时间、重复日期与执行账号，预览定时计划。",
              },
              {
                icon: "users",
                title: "提前探索更多可能",
                text: "添加多个演示账号、体验不同登录方式，并为账号分配代理节点。",
              },
            ].map((item) => (
              <div key={item.icon}>
                <span className="icon-tile">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="inline-note">
            <Icon name="help" size={19} />
            <p>
              当前为独立 UI
              原型。数据为虚构示例，操作仅在本地模拟，刷新页面即可恢复初始状态。
            </p>
          </div>
          <button
            className="button primary full-width"
            onClick={() => setDialog(null)}
          >
            开始探索
            <Icon name="arrow" size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  detail,
  bars,
  progress,
}: {
  icon: string;
  label: string;
  value: string;
  unit: string;
  detail: React.ReactNode;
  bars?: boolean;
  progress?: number;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        {label}
        <Icon name={icon} size={18} />
      </div>
      <div className="stat-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className="stat-detail">{detail}</div>
      {bars && (
        <div className="spark-bars" aria-hidden="true">
          {[12, 19, 15, 23, 21, 29, 26, 36, 33, 41].map((height, index) => (
            <i key={index} style={{ height }} />
          ))}
        </div>
      )}
      {progress !== undefined && (
        <div className="stat-progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </article>
  );
}

function LoginForm({
  onComplete,
  refresh,
}: {
  onComplete: (name: string) => void;
  refresh: boolean;
}) {
  const [method, setMethod] = useState("qr");
  const [provider, setProvider] = useState("");
  const [qrGeneration, setQrGeneration] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [name, setName] = useState("");
  // 表单内容只参与浏览器原生校验；不读取、持久化或发送密码、验证码及 token。
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onComplete(name);
  }
  return (
    <>
      <div className="login-demo-note">
        <Icon name="shield" size={15} />
        登录交互演示，请使用虚构信息
      </div>
      {!refresh && (
        <label className="field account-name-field">
          账号备注
          <input
            value={name}
            maxLength={30}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：我的工作空间"
          />
        </label>
      )}
      <div className="login-tabs">
        {[
          { id: "qr", label: "扫码登录", icon: "qr" },
          { id: "phone", label: "短信登录", icon: "phone" },
          { id: "password", label: "密码登录", icon: "lock" },
          { id: "token", label: "登录态导入", icon: "code" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={method === tab.id && !provider ? "selected" : ""}
            onClick={() => {
              setMethod(tab.id);
              setProvider("");
            }}
          >
            <Icon name={tab.icon} size={17} />
            {tab.label}
          </button>
        ))}
      </div>
      {provider ? (
        <div className="oauth-panel">
          <span
            className={`provider-logo ${provider === "CSDN" ? "csdn" : "huawei"}`}
          >
            {provider === "CSDN" ? "C" : "H"}
          </span>
          <h3>使用 {provider} 账号登录</h3>
          <p>授权页面交互预览，不会跳转到真实平台。</p>
          <button
            className="button primary full-width"
            onClick={() => onComplete(name)}
          >
            模拟授权成功
            <Icon name="arrow" size={16} />
          </button>
          <button className="text-button" onClick={() => setProvider("")}>
            返回其他登录方式
          </button>
        </div>
      ) : (
        <form onSubmit={submit} key={method}>
          {method === "qr" && (
            <div className="qr-panel">
              <div className="demo-qr" aria-label="演示二维码图案，不可扫描">
                <div className="qr-pattern">
                  {Array.from({ length: 121 }, (_, index) => (
                    <i
                      key={index}
                      className={
                        (index * 7 +
                          Math.floor(index / 11) * 3 +
                          qrGeneration) %
                          5 <
                        3
                          ? "filled"
                          : ""
                      }
                    />
                  ))}
                </div>
                <span className="qr-finder top-left" />
                <span className="qr-finder top-right" />
                <span className="qr-finder bottom-left" />
                <div className="qr-center">
                  <Logo compact />
                </div>
              </div>
              <strong>使用 GitCode 小程序扫码</strong>
              <p>演示区域 · 不可扫描</p>
              <button
                type="button"
                className="text-button"
                onClick={() => setQrGeneration((value) => value + 1)}
              >
                <Icon name="refresh" size={14} />
                {qrGeneration ? "演示码已刷新，再次刷新" : "刷新演示码"}
              </button>
            </div>
          )}
          {method === "phone" && (
            <div className="form-fields">
              <label className="field">
                手机号码
                <div className="phone-input">
                  <span>+86</span>
                  <input
                    type="tel"
                    pattern="1[0-9]{10}"
                    maxLength={11}
                    required
                    placeholder="请输入 11 位演示手机号"
                  />
                </div>
              </label>
              <label className="field">
                短信验证码
                <div className="code-input">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    placeholder="请输入演示码"
                  />
                  <button type="button" onClick={() => setCodeSent(true)}>
                    {codeSent ? "演示码：123456" : "获取演示验证码"}
                  </button>
                </div>
              </label>
              {codeSent && (
                <span className="form-hint">
                  未发送短信，输入 123456 体验登录。
                </span>
              )}
            </div>
          )}
          {method === "password" && (
            <div className="form-fields">
              <label className="field">
                手机号 / 邮箱 / 用户名
                <input
                  required
                  autoComplete="off"
                  placeholder="请输入演示用户名"
                />
              </label>
              <label className="field">
                密码
                <input
                  required
                  type="password"
                  autoComplete="off"
                  minLength={6}
                  placeholder="任意 6 位以上演示密码"
                />
              </label>
              <span className="form-hint">
                密码仅用于表单展示，不会保存或发送。
              </span>
            </div>
          )}
          {method === "token" && (
            <div className="form-fields">
              <label className="field">
                Access Token
                <input
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="填入任意演示文本"
                />
              </label>
              <label className="field">
                Refresh Token
                <input
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="填入任意演示文本"
                />
              </label>
              <span className="form-hint">
                此处不验证或保存 Token，请勿填写真实凭证。
              </span>
            </div>
          )}
          <button
            className="button primary full-width login-submit"
            type="submit"
          >
            <Icon name={method === "qr" ? "check" : "login"} size={16} />
            {method === "qr"
              ? "模拟扫码成功"
              : method === "token"
                ? "模拟导入登录态"
                : "模拟登录"}
          </button>
        </form>
      )}
      <div className="oauth-divider">
        <span>其他登录方式</span>
      </div>
      <div className="oauth-buttons">
        <button onClick={() => setProvider("CSDN")}>
          <span className="provider-logo csdn">C</span>CSDN
        </button>
        <button onClick={() => setProvider("华为")}>
          <span className="provider-logo huawei">H</span>华为账号
        </button>
      </div>
      <p className="login-footer">
        登录方式为原型展示，实际支持范围以 GitCode 为准
      </p>
    </>
  );
}

function ScheduleForm({
  schedule,
  accounts,
  onSave,
  onCancel,
}: {
  schedule: Schedule;
  accounts: Account[];
  onSave: (value: Schedule) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(schedule);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.days.length) onSave(draft);
      }}
    >
      <div className="schedule-toggle-row">
        <div>
          <strong>启用定时计划</strong>
          <p>按指定时间执行所选任务</p>
        </div>
        <Toggle
          checked={draft.enabled}
          label="启用计划"
          onChange={() =>
            setDraft((current) => ({ ...current, enabled: !current.enabled }))
          }
        />
      </div>
      <div className="form-fields">
        <label className="field">
          执行时间
          <div className="time-input">
            <Icon name="clock" size={23} />
            <input
              type="time"
              aria-label="执行时间"
              required
              value={draft.time}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  time: event.target.value,
                }))
              }
            />
            <span>北京时间 UTC+8</span>
          </div>
        </label>
        <div className="field">
          重复日期
          <div className="weekday-buttons">
            {weekdays.map((day) => (
              <button
                key={day.id}
                type="button"
                aria-pressed={draft.days.includes(day.id)}
                className={draft.days.includes(day.id) ? "selected" : ""}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    days: current.days.includes(day.id)
                      ? current.days.filter((id) => id !== day.id)
                      : [...current.days, day.id],
                  }))
                }
              >
                {day.label}
              </button>
            ))}
          </div>
          {!draft.days.length && (
            <span className="field-error">请至少选择一天</span>
          )}
        </div>
        <div className="field">
          执行模式
          <div className="mode-options">
            <button
              type="button"
              className={draft.mode === "daily" ? "selected" : ""}
              aria-pressed={draft.mode === "daily"}
              onClick={() =>
                setDraft((current) => ({ ...current, mode: "daily" }))
              }
            >
              <Icon name="calendar" />
              <strong>日常任务</strong>
              <span>轻量积累，每天一次</span>
            </button>
            <button
              type="button"
              className={draft.mode === "full" ? "selected" : ""}
              aria-pressed={draft.mode === "full"}
              onClick={() =>
                setDraft((current) => ({ ...current, mode: "full" }))
              }
            >
              <Icon name="layers" />
              <strong>全部任务</strong>
              <span>包含一次性任务</span>
            </button>
          </div>
        </div>
        <div className="field">
          执行账号
          <Select
            label="执行账号"
            value={draft.account}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                account: value,
              }))
            }
            options={[
              ...accounts.map((account) => ({
                value: account.id,
                label: account.name,
              })),
              { value: "all", label: "全部在线账号" },
            ]}
          />
        </div>
      </div>
      <p className="form-note">
        <Icon name="help" size={15} />
        仅保存演示设置，不会创建真实定时任务。
      </p>
      <div className="form-actions">
        <button className="button" type="button" onClick={onCancel}>
          取消
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={!draft.days.length}
        >
          保存计划
          <Icon name="check" size={16} />
        </button>
      </div>
    </form>
  );
}

function ProxyForm({
  proxy,
  onSave,
  onCancel,
}: {
  proxy?: ProxyNode;
  onSave: (value: ProxyNode) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProxyNode>(
    proxy || {
      id: demoId(),
      name: "",
      protocol: "HTTP",
      host: "",
      port: 7890,
      region: "自定义",
      latency: null,
      enabled: true,
    },
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          name: draft.name.trim(),
          host: draft.host.trim(),
          latency: null,
        });
      }}
    >
      <div className="form-fields">
        <label className="field">
          节点名称
          <input
            required
            maxLength={40}
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="例如：香港 · 主节点"
            pattern=".*\S.*"
          />
        </label>
        <div className="field">
          代理协议
          <div className="segmented protocol-options">
            {(["HTTP", "SOCKS5"] as const).map((protocol) => (
              <button
                type="button"
                key={protocol}
                className={draft.protocol === protocol ? "selected" : ""}
                onClick={() =>
                  setDraft((current) => ({ ...current, protocol }))
                }
              >
                {protocol}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label className="field">
            服务器地址
            <input
              required
              value={draft.host}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  host: event.target.value,
                }))
              }
              placeholder="proxy.example.com"
              pattern="[^\s\/:]+"
              title="填写主机名或 IPv4 地址，不包含协议、端口或路径"
            />
          </label>
          <label className="field port-field">
            端口
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  port: Number(event.target.value),
                }))
              }
            />
          </label>
        </div>
        <label className="field">
          节点地区
          <input
            required
            maxLength={20}
            value={draft.region}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                region: event.target.value,
              }))
            }
          />
        </label>
        <div className="schedule-toggle-row">
          <div>
            <strong>启用节点</strong>
            <p>在账号设置中分配此节点</p>
          </div>
          <Toggle
            checked={draft.enabled}
            label="启用新节点"
            onChange={() =>
              setDraft((current) => ({ ...current, enabled: !current.enabled }))
            }
          />
        </div>
      </div>
      <p className="form-note">
        <Icon name="help" size={15} />
        连接信息仅作本地展示，不会建立代理连接。
      </p>
      <div className="form-actions">
        <button className="button" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="button primary" type="submit">
          保存节点
          <Icon name="check" size={16} />
        </button>
      </div>
    </form>
  );
}

function AccountForm({
  account,
  proxies,
  isDefault,
  onSave,
  onRemove,
  canRemove,
}: {
  account: Account;
  proxies: ProxyNode[];
  isDefault: boolean;
  onSave: (account: Account, isDefault: boolean) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [draft, setDraft] = useState(account);
  const [defaultChecked, setDefaultChecked] = useState(isDefault);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...draft, name: draft.name.trim() }, defaultChecked);
      }}
    >
      <div className="account-edit-identity">
        <Avatar account={account} />
        <div>
          <strong>@{account.handle}</strong>
          <p>GitCode 演示账号</p>
        </div>
      </div>
      <div className="form-fields">
        <label className="field">
          账号备注
          <input
            required
            maxLength={30}
            pattern=".*\S.*"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <div className="field">
          网络连接
          <Select
            label="网络连接"
            value={draft.proxy}
            onChange={(value) =>
              setDraft((current) => ({ ...current, proxy: value }))
            }
            options={[
              { value: "direct", label: "直接连接（默认网络）" },
              ...proxies.map((proxy) => ({
                value: proxy.id,
                label: `${proxy.name}${proxy.enabled ? "" : "（已停用）"}`,
                disabled: !proxy.enabled,
              })),
            ]}
          />
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={defaultChecked}
            disabled={isDefault}
            onChange={(event) => setDefaultChecked(event.target.checked)}
          />
          <span>
            设为默认账号<small>标记为账号列表中的默认工作空间</small>
          </span>
        </label>
        {draft.status !== "expired" && (
          <div className="schedule-toggle-row">
            <div>
              <strong>参与任务执行</strong>
              <p>暂停后，可在此处重新启用</p>
            </div>
            <Toggle
              checked={draft.status === "online"}
              label="参与任务执行"
              onChange={() =>
                setDraft((current) => ({
                  ...current,
                  status: current.status === "online" ? "paused" : "online",
                }))
              }
            />
          </div>
        )}
      </div>
      <div className="form-actions split">
        <button
          className="text-button danger-text"
          type="button"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Icon name="trash" size={15} />
          移除账号
        </button>
        <button className="button primary" type="submit">
          保存设置
          <Icon name="check" size={16} />
        </button>
      </div>
      {!canRemove && <p className="form-hint">保留至少一个演示账号。</p>}
    </form>
  );
}

function SearchContent({
  onNavigate,
  onTask,
}: {
  onNavigate: (page: Page) => void;
  onTask: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const pages = navigation.filter((item) => item.label.includes(search));
  const tasks = search
    ? initialTasks.filter((task) =>
        task.name.toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  return (
    <>
      <label className="search-field command-search">
        <Icon name="search" />
        <input
          autoFocus
          aria-label="快速查找页面或任务"
          placeholder="输入页面或任务名称…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="command-results">
        {pages.length > 0 && <span className="command-group">页面</span>}
        {pages.map((item) => (
          <button key={item.id} onClick={() => onNavigate(item.id)}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
        {tasks.length > 0 && <span className="command-group">任务</span>}
        {tasks.map((task) => (
          <button key={task.id} onClick={() => onTask(task.name)}>
            <Icon name={task.icon} />
            <span>{task.name}</span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
        {!pages.length && !tasks.length && (
          <Empty
            title="没有找到结果"
            description="试试「账号」「计划」或「签到」。"
          />
        )}
      </div>
      <p className="form-hint">Esc 关闭 · Tab 选择 · Enter 打开</p>
    </>
  );
}
