import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  Github,
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
  github: Github,
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

// 使用浏览器顶层 popover 绘制菜单，避免被卡片的 overflow 或原生 dialog 裁剪。
// 焦点始终留在 combobox，方向键只移动候选项，Enter 确认，Escape/Tab 取消展开。
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const typed = useRef({ text: "", time: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const enabledIndices = options.flatMap((option, index) =>
    option.disabled ? [] : [index],
  );

  function positionMenu() {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 18;
    const above = rect.top - 18;
    const desiredHeight = Math.min(options.length * 42 + 12, 264);
    const upward = below < desiredHeight && above > below;
    Object.assign(menu.current!.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      top: upward ? "auto" : `${rect.bottom + 6}px`,
      bottom: upward ? `${window.innerHeight - rect.top + 6}px` : "auto",
      maxHeight: `${Math.max(0, Math.min(264, upward ? above : below))}px`,
    });
  }

  function showMenu(index = selectedIndex) {
    setActiveIndex(options[index].disabled ? enabledIndices[0] : index);
    positionMenu();
    menu.current!.showPopover();
    setOpen(true);
  }

  function closeMenu() {
    menu.current!.hidePopover();
    setOpen(false);
  }

  function choose(index: number) {
    if (options[index].disabled) return;
    onChange(options[index].value);
    closeMenu();
    trigger.current!.focus();
  }

  useEffect(() => {
    if (!open) return;
    // 弹窗滚动、视口变化时继续跟随触发按钮；列表本身的滚动不改变选中值。
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  });
  useEffect(() => {
    if (open)
      menu.current!.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  return (
    <div className="select-control">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
        disabled={disabled}
        className="select-trigger"
        onClick={() => (open ? closeMenu() : showMenu())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
          } else if (event.key === "Tab") {
            if (open) closeMenu();
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(activeIndex);
            else showMenu();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) showMenu();
            else {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex(
                enabledIndices[
                  (enabledIndices.indexOf(activeIndex) +
                    direction +
                    enabledIndices.length) %
                    enabledIndices.length
                ],
              );
            }
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const index =
              event.key === "Home"
                ? enabledIndices[0]
                : enabledIndices[enabledIndices.length - 1];
            if (open) setActiveIndex(index);
            else showMenu(index);
          } else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const now = Date.now();
            typed.current = {
              text:
                (now - typed.current.time < 700 ? typed.current.text : "") +
                event.key.toLowerCase(),
              time: now,
            };
            const index = enabledIndices.find((item) =>
              options[item].label.toLowerCase().startsWith(typed.current.text),
            );
            if (index !== undefined) {
              if (open) setActiveIndex(index);
              else showMenu(index);
            }
          }
        }}
      >
        <span>{options[selectedIndex].label}</span>
        <Icon name="down" size={15} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="select-menu"
        onToggle={(event) =>
          setOpen((event.nativeEvent as ToggleEvent).newState === "open")
        }
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            className={`select-option ${activeIndex === index ? "highlighted" : ""}`}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse" && !option.disabled)
                setActiveIndex(index);
            }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {option.value === value && <Icon name="check" size={15} />}
          </div>
        ))}
      </div>
    </div>
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
