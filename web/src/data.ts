// 数据完全独立于 Python CLI 和真实账号，刷新页面即可恢复演示场景。
export type Page =
  | "overview"
  | "tasks"
  | "schedule"
  | "accounts"
  | "proxies"
  | "logs";
export type TaskStatus = "pending" | "running" | "done";
export type Task = {
  id: string;
  name: string;
  description: string;
  category: "daily" | "once";
  currency: "CANN" | "GitCode";
  points: number;
  status: TaskStatus;
  icon: string;
};
export type Account = {
  id: string;
  name: string;
  handle: string;
  color: string;
  status: "online" | "expired" | "paused";
  proxy: string;
  points: number;
};
export type ProxyNode = {
  id: string;
  name: string;
  protocol: "HTTP" | "SOCKS5";
  host: string;
  port: number;
  region: string;
  latency: number | null;
  enabled: boolean;
};
export type Schedule = {
  enabled: boolean;
  time: string;
  days: number[];
  mode: "daily" | "full";
  account: string;
};
export type LogEntry = {
  id: string;
  time: string;
  message: string;
  level: "success" | "info" | "warning";
};

// 这些标识只区分本次会话的演示记录，不承担认证用途，也不依赖 HTTPS API。
let sequence = 0;
export function demoId() {
  return `demo-${++sequence}`;
}

export const navigation: {
  id: Page;
  label: string;
  icon: string;
  preview?: boolean;
}[] = [
  { id: "overview", label: "工作台", icon: "overview" },
  { id: "tasks", label: "任务中心", icon: "tasks" },
  { id: "schedule", label: "定时计划", icon: "calendar" },
  { id: "accounts", label: "账号管理", icon: "users", preview: true },
  { id: "proxies", label: "代理节点", icon: "network", preview: true },
  { id: "logs", label: "运行日志", icon: "logs" },
];

// CANN 与 GitCode 分开显示和累计，避免把两种用途不同的积分合并。
export const initialTasks: Task[] = [
  {
    id: "community",
    name: "访问 CANN 社区",
    description: "发现社区动态，领取每日 CANN 积分",
    category: "daily",
    currency: "CANN",
    points: 10,
    status: "done",
    icon: "globe",
  },
  {
    id: "signin",
    name: "每日签到",
    description: "每一次坚持，都有一点收获",
    category: "daily",
    currency: "GitCode",
    points: 5,
    status: "done",
    icon: "calendar",
  },
  {
    id: "star",
    name: "Star 推荐项目",
    description: "领取奖励后自动取消 Star",
    category: "daily",
    currency: "GitCode",
    points: 10,
    status: "pending",
    icon: "star",
  },
  {
    id: "browse",
    name: "浏览推荐项目",
    description: "探索热门开源项目，发现新的灵感",
    category: "daily",
    currency: "GitCode",
    points: 10,
    status: "pending",
    icon: "compass",
  },
  {
    id: "claim",
    name: "领取待领奖励",
    description: "检查并领取已完成任务的奖励",
    category: "daily",
    currency: "GitCode",
    points: 0,
    status: "pending",
    icon: "gift",
  },
  {
    id: "search",
    name: "搜索开源项目",
    description: "完成首次项目搜索体验",
    category: "once",
    currency: "GitCode",
    points: 10,
    status: "pending",
    icon: "search",
  },
  {
    id: "code",
    name: "查看项目代码",
    description: "浏览一个开源项目的代码文件",
    category: "once",
    currency: "GitCode",
    points: 5,
    status: "pending",
    icon: "code",
  },
  {
    id: "download",
    name: "下载开源项目",
    description: "完成首次项目下载体验",
    category: "once",
    currency: "GitCode",
    points: 10,
    status: "pending",
    icon: "download",
  },
  {
    id: "ide",
    name: "体验 WebIDE",
    description: "探索云端开发环境",
    category: "once",
    currency: "GitCode",
    points: 5,
    status: "pending",
    icon: "terminal",
  },
];
export const initialAccounts: Account[] = [
  {
    id: "a1",
    name: "Lin 的工作空间",
    handle: "lin_dev",
    color: "green",
    status: "online",
    proxy: "direct",
    points: 1280,
  },
  {
    id: "a2",
    name: "开源探索账号",
    handle: "open_source",
    color: "purple",
    status: "online",
    proxy: "p1",
    points: 640,
  },
  {
    id: "a3",
    name: "实验室账号",
    handle: "cann_lab",
    color: "orange",
    status: "expired",
    proxy: "direct",
    points: 320,
  },
];
export const initialProxies: ProxyNode[] = [
  {
    id: "p1",
    name: "香港 · 日常节点",
    protocol: "HTTP",
    host: "hk.example.com",
    port: 7890,
    region: "香港",
    latency: 42,
    enabled: true,
  },
  {
    id: "p2",
    name: "新加坡 · 备用节点",
    protocol: "SOCKS5",
    host: "sg.example.com",
    port: 1080,
    region: "新加坡",
    latency: 86,
    enabled: true,
  },
  {
    id: "p3",
    name: "本地开发代理",
    protocol: "HTTP",
    host: "127.0.0.1",
    port: 7890,
    region: "本地",
    latency: null,
    enabled: false,
  },
];
export const initialSchedule: Schedule = {
  enabled: true,
  time: "08:30",
  days: [1, 2, 3, 4, 5, 6, 0],
  mode: "daily",
  account: "a1",
};
export const initialLogs: LogEntry[] = [
  {
    id: "l1",
    time: "08:30:12",
    message: "每日签到完成，获得 5 GitCode 积分",
    level: "success",
  },
  {
    id: "l2",
    time: "08:30:08",
    message: "访问 CANN 社区完成，获得 10 CANN 积分",
    level: "success",
  },
  {
    id: "l3",
    time: "08:30:02",
    message: "Lin 的工作空间 · 登录状态检查通过",
    level: "info",
  },
  {
    id: "l4",
    time: "08:30:00",
    message: "每日计划已触发，开始执行任务",
    level: "info",
  },
  {
    id: "l5",
    time: "08:20:00",
    message: "实验室账号登录已过期，等待刷新登录",
    level: "warning",
  },
];
export const weekdays = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 0, label: "日" },
];

// 演示日固定，所有日期和趋势与页面上的「示例数据」语义一致。
export function nextSchedule(schedule: Schedule) {
  if (!schedule.enabled || schedule.days.length === 0) return "计划已暂停";
  const reference = new Date("2026-10-06T09:00:00+08:00");
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(Date.UTC(2026, 9, 6 + offset));
    const candidate = new Date(
      `${date.toISOString().slice(0, 10)}T${schedule.time}:00+08:00`,
    );
    if (candidate > reference && schedule.days.includes(date.getUTCDay())) {
      return `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日 ${schedule.time}`;
    }
  }
  return "暂无运行计划";
}
