// 展示层类型与导航定义。列表数据全部来自服务端（见 api.ts），此文件不再持有初始数据。
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

export const navigation: { id: Page; label: string; icon: string }[] = [
  { id: "overview", label: "工作台", icon: "overview" },
  { id: "tasks", label: "任务中心", icon: "tasks" },
  { id: "schedule", label: "定时计划", icon: "calendar" },
  { id: "accounts", label: "账号管理", icon: "users" },
  { id: "proxies", label: "代理节点", icon: "network" },
  { id: "logs", label: "运行日志", icon: "logs" },
];

// CANN 与 GitCode 分开显示和累计，避免把两种用途不同的积分合并。
export const initialTasks: Task[] = [];
export const initialAccounts: Account[] = [];
export const initialProxies: ProxyNode[] = [];
export const initialSchedule: Schedule = {
  enabled: false,
  time: "08:30",
  days: [1, 2, 3, 4, 5, 6, 0],
  mode: "daily",
  account: "all",
};
export const initialLogs: LogEntry[] = [];
export const weekdays = [
  { id: 1, label: "一" },
  { id: 2, label: "二" },
  { id: 3, label: "三" },
  { id: 4, label: "四" },
  { id: 5, label: "五" },
  { id: 6, label: "六" },
  { id: 0, label: "日" },
];

// 以真实当前时间推算下一次计划运行。
export function nextSchedule(schedule: Schedule) {
  if (!schedule.enabled || schedule.days.length === 0) return "计划已暂停";
  const now = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const candidate = new Date(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${schedule.time}:00`,
    );
    if (candidate > now && schedule.days.includes(candidate.getDay())) {
      const prefix = offset === 0 ? "今天" : offset === 1 ? "明天" : `${candidate.getMonth() + 1} 月 ${candidate.getDate()} 日`;
      return `${prefix} ${schedule.time}`;
    }
  }
  return "暂无运行计划";
}

let sequence = 0;
export function demoId() {
  return `draft-${++sequence}`;
}
