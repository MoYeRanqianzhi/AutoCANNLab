import { useEffect, useRef, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Command,
  Compass,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Gift,
  Globe2,
  Layers3,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Menu,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Account, Task } from "./data";

const icons: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  tasks: ListChecks,
  calendar: CalendarDays,
  users: Users,
  network: Network,
  logs: FileText,
  arrow: ArrowRight,
  arrowUp: ArrowUpRight,
  bell: Bell,
  book: BookOpen,
  check: Check,
  checks: CheckCheck,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  help: CircleHelp,
  clock: Clock3,
  code: Code2,
  command: Command,
  compass: Compass,
  copy: Copy,
  more: Ellipsis,
  external: ExternalLink,
  gift: Gift,
  globe: Globe2,
  layers: Layers3,
  loader: LoaderCircle,
  lock: LockKeyhole,
  login: LogIn,
  menu: Menu,
  pause: Pause,
  edit: Pencil,
  play: Play,
  plus: Plus,
  qr: QrCode,
  refresh: RefreshCw,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  phone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  terminal: Terminal,
  trash: Trash2,
  trend: TrendingUp,
  wallet: Wallet,
  close: X,
  zap: Zap,
  activity: Activity,
  download: ArrowDownToLine,
};

export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = icons[name] || Layers3;
  return (
    <Component
      size={size}
      strokeWidth={1.7}
      className={className}
      aria-hidden="true"
    />
  );
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="m20 8 11 22h-7l-4-9-4 9H9z" fill="currentColor" />
          <circle cx="28" cy="12" r="3" fill="currentColor" />
        </svg>
      </div>
      {!compact && (
        <div>
          <strong>AutoCANNLab</strong>
          <span>让日常自动发生</span>
        </div>
      )}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "orange" | "neutral" | "purple";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Avatar({
  account,
  small = false,
}: {
  account: Account;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${account.color} ${small ? "small" : ""}`}>
      {account.handle.slice(0, 1).toUpperCase()}
      <i className={account.status} />
    </span>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <Icon name="compass" size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

// 原生 dialog 提供焦点隔离；关闭后将焦点还给触发按钮，支持键盘和屏幕阅读器。
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-inner">
        <header className="modal-head">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function TaskTable({
  tasks,
  onRun,
  running,
  compact = false,
}: {
  tasks: Task[];
  onRun: (ids: string[]) => void;
  running: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`task-table ${compact ? "compact" : ""}`}>
      <div className="task-table-head">
        <span>任务名称</span>
        <span>任务奖励</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      {tasks.map((task) => (
        <div className="task-row" key={task.id}>
          <div className="task-name">
            <span
              className={`task-icon ${task.status === "done" ? "complete" : ""}`}
            >
              <Icon name={task.icon} size={19} />
            </span>
            <div>
              <strong>{task.name}</strong>
              <p>{task.description}</p>
            </div>
          </div>
          <div className="task-reward">
            {task.points ? (
              <>
                <strong>+{task.points}</strong>
                <span>{task.currency}</span>
              </>
            ) : (
              <span>按实际结算</span>
            )}
          </div>
          <span className={`task-state ${task.status}`}>
            <Icon
              name={
                task.status === "done"
                  ? "check"
                  : task.status === "running"
                    ? "loader"
                    : "clock"
              }
              size={13}
              className={task.status === "running" ? "spin" : ""}
            />
            {task.status === "done"
              ? "已完成"
              : task.status === "running"
                ? "执行中"
                : "待执行"}
          </span>
          <button
            className="task-action"
            disabled={running || task.status === "done"}
            onClick={() => onRun([task.id])}
            aria-label={`执行${task.name}`}
          >
            {task.status === "done" ? (
              <Icon name="check" size={16} />
            ) : (
              <Icon name="play" size={15} />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

// SVG 只负责呈现示例趋势，不依赖外部图表服务或运行时图片请求。
export function TrendChart({ period }: { period: "week" | "month" }) {
  const month = period === "month";
  const path = month
    ? "M0 82 C20 85 20 64 45 68 S80 44 104 48 S135 57 154 38 S180 43 202 22 S229 35 251 15 S282 20 308 3"
    : "M0 83 C20 83 26 61 51 61 S73 73 103 53 S131 53 155 30 S181 40 207 24 S234 35 260 18 S286 22 308 4";
  return (
    <div className="trend-chart">
      <div className="chart-y">
        <span>{month ? "300" : "100"}</span>
        <span>{month ? "150" : "50"}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <svg
          viewBox="0 0 308 110"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${month ? "30" : "7"} 天 CANN 积分增长示例趋势`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9cc19c" stopOpacity=".32" />
              <stop offset="100%" stopColor="#9cc19c" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 5H308M0 53H308M0 102H308"
            stroke="#e9ede7"
            strokeDasharray="3 5"
            fill="none"
          />
          <path d={`${path} L308 110 L0 110Z`} fill="url(#chart-fill)" />
          <path
            d={path}
            fill="none"
            stroke="#648d67"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="308" cy={month ? "3" : "4"} r="4" fill="#194e3d" />
        </svg>
        <div className="chart-x">
          {(month
            ? ["09.07", "09.13", "09.19", "09.25", "10.06"]
            : ["09.30", "10.01", "10.02", "10.03", "10.04", "10.05", "10.06"]
          ).map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrbitArt() {
  return (
    <div className="orbit-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <div className="orbit-dot dot-one" />
      <div className="orbit-dot dot-two" />
      <div className="orbit-center">
        <svg viewBox="0 0 40 40">
          <path d="m23 5-14 18h11l-3 12 15-19H21z" fill="currentColor" />
        </svg>
      </div>
      <span className="orbit-label">
        <i /> AUTOMATION, IN FLOW
      </span>
      <span className="art-plus plus-one">+</span>
      <span className="art-plus plus-two">+</span>
    </div>
  );
}
