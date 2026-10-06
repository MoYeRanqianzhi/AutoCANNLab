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
import { api, ApiError, getApiToken, setApiToken } from "./api";

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
  | { type: "api-token" }
  | null;
// run 对应服务端的一次执行（daily/full 链路）。
type Run = { runId: string; accountId: string; mode: "daily" | "full" };
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
  // 页面共享同一份会话状态；数据来自服务端，刷新后重新拉取。
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
  const [testingProxy, setTestingProxy] = useState<string | null>(null);
  const [apiOffline, setApiOffline] = useState(false);
  const [recentRuns, setRecentRuns] = useState<
    { id: string; username: string | null; mode: string; status: string; started_at: string | null; summary: string | null }[]
  >([]);
  const [tokenDraft, setTokenDraft] = useState("");
  const proxyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAccount =
    accounts.find((account) => account.id === activeId) ??
    ({
      id: "",
      name: apiOffline ? "未连接服务端" : "尚未导入账号",
      handle: "—",
      color: "green",
      status: "expired",
      proxy: "direct",
      points: 0,
    } as Account);
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

  // ---------- 服务端数据加载与映射 ----------
  // UI 的账号/代理/计划形状是展示层视图，字段映射集中在 loadServerState。
  const mapServerAccount = (a: {
    id: string;
    username: string | null;
    note: string;
    proxy_id: string | null;
    enabled: boolean;
    has_tokens: boolean;
  }): Account => ({
    id: a.id,
    name: a.note || a.username || "未命名账号",
    handle: a.username ?? "unknown",
    color: "green",
    status: !a.enabled ? "paused" : a.has_tokens ? "online" : "expired",
    proxy: a.proxy_id ?? "direct",
    points: 0,
  });

  const loadServerState = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const state = await api.state();
        setApiOffline(false);
        try {
          setRecentRuns(await api.listRuns());
        } catch {
          /* 运行记录拉取失败不阻塞状态加载 */
        }
        setAccounts(state.accounts.map(mapServerAccount));
        setProxies(
          state.proxies.map((p) => ({
            ...p,
            region: "",
            latency: null,
          })) as ProxyNode[],
        );
        setSchedule({
          enabled: state.schedule.enabled,
          time: state.schedule.time,
          days: state.schedule.weekdays,
          mode: state.schedule.mode,
          account: state.schedule.account_id,
        } as Schedule);
        const fallback =
          state.accounts.find((a) => a.is_default) ?? state.accounts[0];
        if (fallback) {
          setActiveId((current) =>
            state.accounts.some((a) => a.id === current)
              ? current
              : fallback.id,
          );
          setDefaultId(fallback.id);
        }
      } catch (error) {
        if (!opts?.silent) {
          setApiOffline(true);
          if (error instanceof ApiError && error.status === 401)
            setDialog({ type: "api-token" });
          else notify(`无法连接服务端：${(error as Error).message}`);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify],
  );

  // 把服务端真实任务清单映射为 UI 任务行。
  const taskIcon = (name: string): string => {
    if (name.includes("签到")) return "calendar";
    if (name.includes("Star") || name.includes("star")) return "star";
    if (name.includes("访问")) return "globe";
    if (name.includes("浏览") || name.includes("查看")) return "compass";
    if (name.includes("搜索")) return "search";
    if (name.includes("下载")) return "download";
    if (name.includes("代码")) return "code";
    if (name.includes("WebIDE") || name.includes("IDE")) return "terminal";
    if (name.includes("领取") || name.includes("兑换")) return "gift";
    return "compass";
  };
  const loadTasks = useCallback(
    async (accountId: string) => {
      try {
        const list = await api.accountTasks(accountId);
        setTaskSets((current) => ({
          ...current,
          [accountId]: list.map((t) => ({
            id: String(t.task_id),
            name: t.cn_name,
            description: t.description,
            category: t.category,
            currency: t.currency,
            points: t.score,
            status: t.done ? ("done" as const) : ("pending" as const),
            icon: taskIcon(t.cn_name),
          })),
        }));
      } catch {
        /* 任务清单拉取失败不阻塞页面，保留现有内容 */
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  const refreshAccountStatus = useCallback(async (accountId: string) => {
    try {
      const status = await api.accountStatus(accountId);
      setAccounts((current) =>
        current.map((a) =>
          a.id === accountId
            ? {
                ...a,
                points: status.cann_points ?? a.points,
                status:
                  status.refresh_days_left !== null &&
                  status.refresh_days_left <= 0
                    ? "expired"
                    : a.status,
              }
            : a,
        ),
      );
    } catch {
      /* 状态查询失败保留旧值 */
    }
  }, []);

  // 初始加载：已有 Token 才拉服务端，否则提示配置。
  useEffect(() => {
    if (getApiToken()) void loadServerState();
    else setApiOffline(true);
  }, [loadServerState]);

  // 切换账号时拉取真实任务与状态（服务端账号就绪后才拉）。
  useEffect(() => {
    const known = accounts.some((account) => account.id === activeId);
    if (!apiOffline && known && getApiToken()) {
      void loadTasks(activeId);
      void refreshAccountStatus(activeId);
    }
  }, [activeId, apiOffline, accounts, loadTasks, refreshAccountStatus]);

  function saveApiToken() {
    setApiToken(tokenDraft);
    setDialog(null);
    setTokenDraft("");
    void loadServerState();
    notify("已保存服务端 Token，正在同步真实数据");
  }

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

  // 执行轮询：真实运行在服务端进行，这里跟踪 run 状态并把日志落到 UI。
  useEffect(() => {
    if (!run) return;
    const timer = setInterval(async () => {
      try {
        const detail = await api.getRun(run.runId);
        if (detail.status === "running") return;
        setRun(null);
        setTaskSets((current) => ({
          ...current,
          [run.accountId]: (current[run.accountId] || []).map((task) =>
            task.status === "running" ? { ...task, status: "pending" } : task,
          ),
        }));
        for (const line of detail.log.slice(-40))
          addLog(line.message, line.level === "error" ? "warning" : line.level === "info" ? "info" : "success");
        addLog(
          detail.status === "ok"
            ? `${detail.username ?? "账号"} · ${detail.mode === "full" ? "全部任务" : "日常任务"}执行完成${detail.summary ? `，${detail.summary}` : ""}`
            : `执行失败：${detail.summary ?? "未知错误"}`,
          detail.status === "ok" ? "success" : "warning",
        );
        notify(detail.status === "ok" ? "任务执行完成" : "执行失败，详见运行日志");
        void loadTasks(run.accountId);
        void refreshAccountStatus(run.accountId);
        void loadServerState({ silent: true });
      } catch {
        /* 轮询失败下个周期重试 */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [run, addLog, notify, loadTasks, refreshAccountStatus, loadServerState]);

  function navigate(target: Page) {
    window.location.hash = `/${target}`;
    setMobileNav(false);
  }
  async function startRun(ids: string[]) {
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
    // 引擎按审批过的链路执行（幂等，已完成的步骤自动跳过）；
    // 所选任务里含一次性任务时用 full 模式，否则日常模式。
    const mode: "daily" | "full" = pending.some((id) =>
      tasks.find((task) => task.id === id && task.category === "once"),
    )
      ? "full"
      : "daily";
    try {
      const { run_id } = await api.startRun(activeId, mode);
      setTaskSets((current) => ({
        ...current,
        [activeId]: (current[activeId] || []).map((task) =>
          pending.includes(task.id) ? { ...task, status: "running" } : task,
        ),
      }));
      setRun({ runId: run_id, accountId: activeId, mode });
      addLog(
        `${activeAccount.name} · 已提交服务端${mode === "full" ? "全部任务" : "日常任务"}（${pending.length} 项待执行，引擎按链路幂等处理）`,
      );
    } catch (error) {
      notify(`提交失败：${(error as Error).message}`);
    }
  }
  function stopRun() {
    if (!run) return;
    // 服务端线程无法安全中断，仅解除 UI 跟踪；引擎会把当前链路跑完（幂等）。
    setTaskSets((current) => ({
      ...current,
      [run.accountId]: (current[run.accountId] || []).map((task) =>
        task.status === "running" ? { ...task, status: "pending" } : task,
      ),
    }));
    setRun(null);
    addLog("已停止跟踪本次执行；服务端任务将在后台完成（引擎幂等，不重复计分）", "warning");
    notify("已解除跟踪，服务端任务将在后台完成");
  }
  function saveSchedule(value: Schedule) {
    void api
      .saveSchedule({
        enabled: value.enabled,
        time: value.time,
        weekdays: value.days,
        mode: value.mode,
        account_id: value.account,
      })
      .then(() => {
        setSchedule(value);
        setDialog(null);
        notify("定时计划已保存到服务端");
        addLog(
          `定时计划已更新：${value.time} · ${value.mode === "daily" ? "日常任务" : "全部任务"}`,
        );
      })
      .catch((error) => notify(`保存失败：${(error as Error).message}`));
  }
  function testProxy(id: string) {
    if (testingProxy) return;
    setTestingProxy(id);
    const finish = () => setTestingProxy(null);
    if (id === "all") {
      // 逐个测已启用节点，避免并发触发风控
      void (async () => {
        for (const proxy of proxies.filter((item) => item.enabled)) {
          await testProxyInner(proxy.id);
        }
        finish();
        notify("连通性检测完成");
      })();
    } else {
      void testProxyInner(id).then(() => {
        finish();
      });
    }
  }
  async function testProxyInner(id: string) {
    try {
      const result = await api.testProxy(id);
      setProxies((current) =>
        current.map((proxy) =>
          proxy.id === id
            ? { ...proxy, latency: result.latency_ms ?? null }
            : proxy,
        ),
      );
      if (result.ok)
        addLog(`代理节点连通性正常（${result.latency_ms}ms，WAF 放行）`, "success");
      else addLog(`代理节点不通：${result.error ?? `HTTP ${result.status}`}`, "warning");
    } catch (error) {
      addLog(`代理检测失败：${(error as Error).message}`, "warning");
    }
  }
  function exportLogs() {
    // 将当前筛选结果生成浏览器内存文件，下载后释放对象 URL，不写入服务器日志。
    const blob = new Blob(
      [
        "AutoCANNLab 运行日志\n",
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
    notify("日志已导出");
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
              <i className="status-dot" /> 服务端已连接
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
              </h1>
              <p>{pageDescriptions[page]}</p>
            </div>
            <div className="heading-actions">
              {page === "overview" ? (
                <span className="date-label">
                  <Icon name="calendar" size={16} />
                  {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
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
                        服务端执行中 · {run.mode === "full" ? "全部" : "日常"}任务
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
                    任务每日重置，已完成项目会自动跳过
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
                      最近执行 <span className="muted small">服务端运行记录</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => void loadServerState({ silent: true })}
                    >
                      <Icon name="refresh" size={14} />
                      刷新
                    </button>
                  </div>
                  {recentRuns.length === 0 ? (
                    <p className="muted">还没有执行记录，提交一次日常任务试试。</p>
                  ) : (
                    <ul className="recent-runs">
                      {recentRuns.slice(0, 5).map((item) => (
                        <li key={item.id}>
                          <i
                            className={`status-dot ${item.status === "ok" ? "" : item.status === "running" ? "amber" : "red"}`}
                          />
                          <span className="run-name">
                            {item.username ?? "账号"} ·{" "}
                            {item.mode === "full" ? "全部任务" : "日常任务"}
                          </span>
                          <span className="muted small">
                            {item.status === "running"
                              ? "执行中"
                              : (item.summary ?? (item.status === "ok" ? "完成" : "失败"))}
                          </span>
                          <small>{item.started_at?.replace("T", " ") ?? ""}</small>
                        </li>
                      ))}
                    </ul>
                  )}
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
                    服务端执行中（{run.mode === "full" ? "全部任务" : "日常任务"}）
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
                  全部任务包含日常任务与一次性任务，引擎幂等执行
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
                    计划保存到服务端，由内置调度器在到点时自动触发（服务运行期间生效）。
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
                    每个账号独立登录态与代理，积分分开累计；添加账号请使用登录态导入。
                  </p>
                </div>
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
                          ? "登录状态正常 · Refresh Token 轮换续期"
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
                    节点，为每个账号指定连接。延迟与连通性为服务端实测结果。
                  </p>
                </div>
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
                  <span className="muted small">网络环境</span>
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
                        <small>{proxy.enabled ? "实测延迟" : "等待启用"}</small>
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
                    description="添加节点后可在账号设置中为账号分配连接。"
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
                运行记录<span>共 {logs.length} 条事件</span>
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
              数据来自服务端 · 全部操作真实生效
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
          subtitle="扫码 / 短信 / 密码 / 登录态导入均为真实登录，服务端代理完成。"
          onClose={() => setDialog(null)}
        >
          <LoginForm
            refresh={!!dialog.accountId}
            notify={notify}
            onSuccess={(account) => {
              setDialog(null);
              void loadServerState({ silent: true });
              notify(
                account.updated
                  ? `账号 ${account.username ?? ""} 登录态已更新`
                  : `账号 ${account.username ?? ""} 已连接`,
              );
              addLog(
                account.updated
                  ? `账号 ${account.username ?? ""} 登录态已刷新`
                  : `已添加账号 ${account.username ?? ""}`,
                "success",
              );
            }}
          />
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
          subtitle="配置连接信息，保存后可实测连通性。"
          onClose={() => setDialog(null)}
        >
          <ProxyForm
            proxy={proxies.find((proxy) => proxy.id === dialog.id)}
            onSave={(proxy) => {
              void api
                .addProxy({
                  name: proxy.region
                    ? `${proxy.name} · ${proxy.region}`
                    : proxy.name,
                  protocol: proxy.protocol,
                  host: proxy.host,
                  port: proxy.port,
                  enabled: proxy.enabled,
                })
                .then(() => loadServerState({ silent: true }))
                .then(() => {
                  setDialog(null);
                  notify("节点已保存到服务端");
                })
                .catch((error) =>
                  notify(`保存失败：${(error as Error).message}`),
                );
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
              // 展示名即备注；默认账号与代理绑定走服务端。
              void (async () => {
                try {
                  await api.patchAccount(account.id, { note: account.name });
                  if (isDefault) await api.setDefault(account.id);
                  const proxyId =
                    account.proxy === "direct" ? null : account.proxy;
                  await api.setAccountProxy(account.id, proxyId);
                  await loadServerState({ silent: true });
                  setDialog(null);
                  notify("账号设置已保存到服务端");
                } catch (error) {
                  notify(`保存失败：${(error as Error).message}`);
                }
              })();
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
          title="移除这个账号？"
          subtitle="该账号的登录态将从服务端删除，任务进度由 GitCode 侧保留。"
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
                void api
                  .removeAccount(dialog.id)
                  .then(() => loadServerState({ silent: true }))
                  .then(() => {
                    if (activeId === dialog.id) {
                      const remaining = accounts.filter(
                        (account) => account.id !== dialog.id,
                      );
                      if (remaining[0]) setActiveId(remaining[0].id);
                    }
                    setDialog(null);
                    notify("账号已移除");
                  })
                  .catch((error) =>
                    notify(`移除失败：${(error as Error).message}`),
                  );
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
          subtitle="使用该节点的账号将改为直接连接。"
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
                void api
                  .removeProxy(dialog.id)
                  .then(() => loadServerState({ silent: true }))
                  .then(() => {
                    setDialog(null);
                    notify("节点已移除，相关账号已改为直接连接");
                  })
                  .catch((error) =>
                    notify(`移除失败：${(error as Error).message}`),
                  );
              }}
            >
              确认移除
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === "api-token" && (
        <Modal
          title="填写服务端 API Token"
          subtitle="Token 在服务端启动日志中输出（数据目录 auth.json）。"
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveApiToken();
            }}
          >
            <div className="form-fields">
              <label className="field">
                API Token
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder="粘贴服务端输出的 Token"
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => setDialog(null)}
              >
                稍后再填
              </button>
              <button className="button primary" type="submit">
                保存并连接
                <Icon name="login" size={16} />
              </button>
            </div>
          </form>
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
              <p>{activeAccount.name} · 引擎按链路执行，幂等跳过已完成</p>
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
            执行在服务端进行，任务清单与积分实时来自 GitCode。
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
                text: "提交日常或全部任务到服务端执行，进度、积分与运行记录实时同步。",
              },
              {
                icon: "calendar",
                title: "安排你的节奏",
                text: "选择每日时间、重复日期与执行账号，保存后由服务端调度器自动触发。",
              },
              {
                icon: "users",
                title: "提前探索更多可能",
                text: "导入多个账号的登录态（Refresh Token），为每个账号分配代理与备注。",
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
              数据来自服务端（GitCode 实时接口）；执行引擎按审定链路幂等运行，
              已完成的任务自动跳过。
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
  refresh,
  onSuccess,
  notify,
}: {
  refresh: boolean;
  onSuccess: (account: { username: string | null; updated?: boolean }) => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<"qr" | "sms" | "password" | "token">("qr");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // ---------- 扫码 ----------
  const [qrImage, setQrImage] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [qrState, setQrState] = useState<
    "loading" | "waiting" | "scanned" | "expired" | "error"
  >("loading");
  useEffect(() => {
    if (tab !== "qr" || refresh) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let scene = "";
    const start = async () => {
      try {
        const qr = await api.qrCreate();
        if (!alive) return;
        scene = qr.scene_id ?? "";
        setSceneId(scene);
        setQrImage(qr.qrcode ?? "");
        setQrState("waiting");
        poll();
      } catch (error) {
        if (alive) setQrState("error");
        notify((error as Error).message);
      }
    };
    const poll = async () => {
      if (!alive || !scene) return;
      try {
        const status = await api.qrStatus(scene);
        const value = String(status.status ?? "").toUpperCase();
        if (value === "EXPIRED") {
          setQrState("expired");
          return;
        }
        if (value && value !== "WAITING") setQrState("scanned");
      } catch {
        /* 轮询失败继续下一轮 */
      }
      timer = setTimeout(poll, 2500);
    };
    void start();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, refresh]);

  async function confirmQr() {
    if (!sceneId) return;
    setBusy(true);
    try {
      const account = await api.qrConfirm(sceneId, name);
      onSuccess(account);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- 易盾验证码 ----------
  const yidunCaptchaId = "5df84d9b61b743e48dbb7b14abab7f13"; // GitCode 国内 NORMAL
  function yidunValidate(): Promise<{
    captcha_id: string;
    token: string;
    authenticate: string;
    validate: string;
  }> {
    return new Promise((resolve, reject) => {
      const w = window as unknown as {
        initNECaptchaWithFallback?: (
          opts: Record<string, unknown>,
          onReady: (inst: { popUp: () => void }) => void,
          onError: (err: Error) => void,
        ) => void;
      };
      if (!w.initNECaptchaWithFallback) {
        reject(new Error("验证码组件未加载（检查网络后刷新页面）"));
        return;
      }
      const holder = document.getElementById("yidun-holder");
      if (!holder) {
        reject(new Error("验证码容器缺失"));
        return;
      }
      holder.innerHTML = "";
      const mount = document.createElement("div");
      mount.id = `yidun-${Date.now()}`;
      holder.appendChild(mount);
      w.initNECaptchaWithFallback(
        {
          captchaId: yidunCaptchaId,
          mode: "popup",
          element: `#${mount.id}`,
          onVerify: (err: Error | null, data: { validate?: string }) => {
            if (err || !data?.validate) {
              reject(new Error("验证码未完成"));
              return;
            }
            resolve({
              captcha_id: yidunCaptchaId,
              token: "",
              authenticate: "",
              validate: data.validate,
            });
          },
        },
        (instance) => instance.popUp(),
        (err) => reject(err),
      );
    });
  }

  // ---------- 短信 ----------
  const [mobile, setMobile] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsMask, setSmsMask] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function sendSms() {
    if (sending || countdown > 0) return;
    setSending(true);
    try {
      const captcha = await yidunValidate();
      const resp = await api.smsSend(mobile, captcha);
      const mask = (resp as { mask?: string }).mask;
      if (mask) setSmsMask(String(mask));
      setCountdown(60);
      notify("验证码已发送，请查收短信");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function submitSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const account = await api.smsVerify({
        mobile,
        code: smsCode,
        mask: smsMask,
        note: name,
      });
      onSuccess(account);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- 密码 ----------
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const captcha = await yidunValidate();
      const account = await api.passwordLogin({
        username,
        password,
        captcha,
        note: name,
      });
      onSuccess(account);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- 登录态导入 ----------
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const account = await api.addAccount({
        access_token: accessToken.trim(),
        refresh_token: refreshToken.trim(),
        note: name,
      });
      onSuccess(account);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    { id: "qr", label: "扫码登录", icon: "qr" },
    { id: "sms", label: "短信登录", icon: "phone" },
    { id: "password", label: "密码登录", icon: "lock" },
    { id: "token", label: "登录态导入", icon: "code" },
  ] as const;

  return (
    <>
      {!refresh && (
        <label className="field account-name-field">
          账号备注
          <input
            value={name}
            maxLength={30}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：主账号"
          />
        </label>
      )}
      <div className="login-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "selected" : ""}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
          </button>
        ))}
      </div>
      {tab === "qr" && (
        <div className="qr-panel">
          {qrState === "error" ? (
            <p className="form-hint">二维码加载失败，切换页签重试。</p>
          ) : qrImage ? (
            <img className="real-qr" src={qrImage} alt="GitCode 登录二维码" />
          ) : (
            <p className="form-hint">二维码生成中…</p>
          )}
          <strong>使用 GitCode 小程序扫码</strong>
          <p className="form-hint">
            {qrState === "expired"
              ? "二维码已过期，请切换页签重新生成"
              : qrState === "scanned"
                ? "已扫码，请在手机上确认后点击下方按钮"
                : "打开微信扫一扫，确认后回到这里"}
          </p>
          <button
            className="button primary full-width login-submit"
            disabled={busy || qrState === "expired" || qrState === "error" || !sceneId}
            onClick={() => void confirmQr()}
          >
            <Icon name="check" size={16} />
            我已扫码确认，完成登录
          </button>
        </div>
      )}
      {tab === "sms" && (
        <form onSubmit={submitSms}>
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
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value)}
                  placeholder="请输入 11 位手机号"
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
                  value={smsCode}
                  onChange={(event) => setSmsCode(event.target.value)}
                  placeholder="请输入 6 位验证码"
                />
                <button
                  type="button"
                  disabled={sending || countdown > 0 || mobile.length !== 11}
                  onClick={() => void sendSms()}
                >
                  {sending
                    ? "验证中…"
                    : countdown > 0
                      ? `${countdown}s 后重发`
                      : "获取验证码"}
                </button>
              </div>
            </label>
            <span className="form-hint">
              点击「获取验证码」会弹出网易易盾验证，完成后发送短信。
            </span>
          </div>
          <button
            className="button primary full-width login-submit"
            type="submit"
            disabled={busy}
          >
            <Icon name="login" size={16} />
            登录
          </button>
        </form>
      )}
      {tab === "password" && (
        <form onSubmit={submitPassword}>
          <div className="form-fields">
            <label className="field">
              用户名 / 手机号 / 邮箱
              <input
                required
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              密码
              <input
                required
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <span className="form-hint">
              提交时先弹出网易易盾验证；密码由服务端按 GitCode 同款算法加密后传输。
            </span>
          </div>
          <button
            className="button primary full-width login-submit"
            type="submit"
            disabled={busy}
          >
            <Icon name="login" size={16} />
            登录
          </button>
        </form>
      )}
      {tab === "token" && (
        <form onSubmit={submitImport}>
          <div className="form-fields">
            <label className="field">
              Access Token
              <input
                type="password"
                autoComplete="off"
                required
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="gitcode.com localStorage 的 access_token"
              />
            </label>
            <label className="field">
              Refresh Token
              <input
                type="password"
                autoComplete="off"
                required
                value={refreshToken}
                onChange={(event) => setRefreshToken(event.target.value)}
                placeholder="gitcode.com localStorage 的 refresh_token"
              />
            </label>
            <span className="form-hint">
              服务端现场校验并轮换保存（60 天有效期，过期后重新导出即可）。
            </span>
          </div>
          <button
            className="button primary full-width login-submit"
            type="submit"
            disabled={busy}
          >
            <Icon name="login" size={16} />
            校验并导入
          </button>
        </form>
      )}
      <div id="yidun-holder" />
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
        计划保存到服务端，由内置调度器在到点时自动触发。
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
          <p>GitCode 账号</p>
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
      {!canRemove && <p className="form-hint">保留至少一个账号。</p>}
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
