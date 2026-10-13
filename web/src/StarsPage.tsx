// Star 积分页：批量 star CANN org 项目赚积分（每项目 +50，服务端自动结算）。
// 手动触发、拟人化慢速执行；打出的 star 由服务端队列在 6-15 小时后逐个自动取消。
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Empty, Icon } from "./components";
import {
  api,
  ApiError,
  type BatchStarProject,
  type BatchStarRecord,
  type BatchStarRun,
} from "./api";

type Props = {
  activeId: string;
  notify: (message: string) => void;
};

const stateLabels: Record<BatchStarProject["star_state"], { label: string; tone: "green" | "orange" | "neutral" }> = {
  new: { label: "未 star", tone: "neutral" },
  batch_pending: { label: "已 star（待取消）", tone: "orange" },
  batch_unstarred: { label: "已完成（已取消）", tone: "green" },
};

export function StarsPage({ activeId, notify }: Props) {
  const [projects, setProjects] = useState<BatchStarProject[]>([]);
  const [records, setRecords] = useState<BatchStarRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<BatchStarRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRecords = useCallback(async () => {
    if (!activeId) return;
    try {
      setRecords(await api.batchStarRecords(activeId));
    } catch {
      // 记录查询失败不打断页面
    }
  }, [activeId]);

  const loadProjects = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    setLoadError("");
    try {
      const list = await api.batchStarProjects(activeId);
      setProjects(list);
      setSelected(new Set());
      await refreshRecords();
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : "拉取项目清单失败，请稍后再试",
      );
    } finally {
      setLoading(false);
    }
  }, [activeId, refreshRecords]);

  useEffect(() => {
    setProjects([]);
    setRunId(null);
    setRun(null);
    if (pollRef.current) clearInterval(pollRef.current);
    void loadProjects();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadProjects]);

  // 运行中轮询进度
  useEffect(() => {
    if (!runId) return;
    const poll = async () => {
      try {
        const current = await api.getRun(runId);
        setRun(current);
        if (current.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
          notify(
            current.status === "ok"
              ? `批量 star 完成：${current.summary ?? ""}`
              : `批量 star 结束（${current.status}）：${current.summary ?? ""}`,
          );
          setRunId(null);
          void loadProjects();
        }
      } catch {
        // 轮询失败下次重试
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runId, notify, loadProjects]);

  const available = projects.filter((p) => p.star_state === "new" && !p.archived);
  const allSelected = available.length > 0 && available.every((p) => selected.has(p.id));

  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const start = async (mode: "selected" | "all") => {
    const ids = mode === "all" ? null : [...selected];
    if (mode === "selected" && (!ids || ids.length === 0)) {
      notify("请先勾选要 star 的项目");
      return;
    }
    try {
      const started = await api.batchStarStart({ account_id: activeId, project_ids: ids });
      setRunId(started.run_id);
      notify(`批量 star 已启动（拟人化慢速执行，预计耗时较长）`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "启动失败");
    }
  };

  const stop = async () => {
    if (!runId) return;
    try {
      await api.batchStarStop(runId);
      notify("已请求中止，当前动作完成后退出；已打出的 star 会照常进入取消队列");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "中止请求失败");
    }
  };

  const pendingUnstar = records.filter((r) => r.source === "batch" && !r.unstarred);
  const doneUnstar = records.filter((r) => r.source === "batch" && r.unstarred);
  const estPoints = (run?.progress?.starred ?? 0) * 50;

  return (
    <>
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            <span className="status-dot" />
            <span>
              CANN org 项目 <strong>{projects.length}</strong> 个 · 可 star{" "}
              <strong>{available.length}</strong> 个 · 每个项目 +50 积分
            </span>
          </div>
          <div className="heading-actions">
            <button className="button" disabled={loading || !!runId} onClick={() => void loadProjects()}>
              <Icon name={loading ? "loader" : "activity"} className={loading ? "spin" : ""} size={16} />
              刷新清单
            </button>
            {runId ? (
              <button className="button" onClick={() => void stop()}>
                <Icon name="close" size={16} />
                中止本次
              </button>
            ) : (
              <>
                <button
                  className="button"
                  disabled={selected.size === 0}
                  onClick={() => void start("selected")}
                >
                  <Icon name="star" size={16} />
                  Star 勾选（{selected.size}）
                </button>
                <button
                  className="button primary"
                  disabled={available.length === 0}
                  onClick={() => void start("all")}
                >
                  <Icon name="star" size={16} />
                  Star 全部（{available.length} · 约 +{available.length * 50}）
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && (
          <p className="hint warning" style={{ padding: "0 16px" }}>
            {loadError}
          </p>
        )}

        {run && run.status === "running" && (
          <div className="panel-foot" style={{ borderTop: "1px solid var(--line)" }}>
            <Icon name="loader" className="spin" size={14} />
            <span>
              执行中 {run.progress?.done ?? 0}/{run.progress?.total ?? 0}
              （star {run.progress?.starred ?? 0} · 失败 {run.progress?.failed ?? 0} · 预计 +
              {estPoints} 积分）
              {run.cancel_requested ? " · 正在中止…" : ""}
            </span>
          </div>
        )}
        {run && run.status !== "running" && (
          <div className="panel-foot" style={{ borderTop: "1px solid var(--line)" }}>
            <Icon name="check" size={14} />
            <span>{run.summary ?? run.status}</span>
          </div>
        )}

        {loading ? (
          <Empty title="正在拉取项目清单…" description="需要访问 GitCode，稍等片刻。" />
        ) : projects.length ? (
          <div className="log-table">
            <div className="log-table-head">
              <span style={{ width: 40 }}>
                <input
                  type="checkbox"
                  aria-label="全选可 star 项目"
                  checked={allSelected}
                  disabled={!!runId}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(available.map((p) => p.id)),
                    )
                  }
                />
              </span>
              <span>项目</span>
              <span style={{ width: 140 }}>状态</span>
            </div>
            {projects.map((p) => {
              const meta = stateLabels[p.star_state];
              return (
                <div className="log-row" key={p.id}>
                  <span style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${p.path}`}
                      checked={selected.has(p.id)}
                      disabled={!!runId || p.star_state !== "new" || p.archived}
                      onChange={() => toggle(p.id)}
                    />
                  </span>
                  <span>
                    {p.archived ? `${p.path}（已归档）` : p.path}
                  </span>
                  <span style={{ width: 140 }}>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title="暂无项目数据"
            description="点击「刷新清单」从 GitCode 拉取 CANN org 的项目列表。"
          />
        )}
      </section>

      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            <span className="status-dot" />
            <span>
              Star 记录 · 待取消 <strong>{pendingUnstar.length}</strong> · 已取消{" "}
              <strong>{doneUnstar.length}</strong>
            </span>
          </div>
        </div>
        <p className="hint" style={{ padding: "0 16px 8px" }}>
          本功能打出的 star 会记录在案，并在 6-15 小时内由后台队列逐个自动取消；
          你手动 star 的项目不受影响，永远不会被自动取消。执行为拟人化慢速节奏
          （每个 star 间隔约 0.5-1 分钟、每 6-12 个休整数分钟），全部 85 个项目约需
          2-4 小时，期间请勿执行日常任务（全局串行）。
        </p>
        {records.length ? (
          <div className="log-table">
            <div className="log-table-head">
              <span>项目</span>
              <span style={{ width: 120 }}>来源</span>
              <span style={{ width: 150 }}>star 时间</span>
              <span style={{ width: 150 }}>取消状态</span>
            </div>
            {records
              .slice()
              .reverse()
              .map((r) => (
                <div className="log-row" key={`${r.account_id}-${r.project_id}`}>
                  <span>{r.path}</span>
                  <span style={{ width: 120 }}>
                    <Badge tone={r.source === "batch" ? "orange" : "neutral"}>
                      {r.source === "batch" ? "批量功能" : "手动"}
                    </Badge>
                  </span>
                  <span style={{ width: 150 }}>{r.starred_at.replace("T", " ")}</span>
                  <span style={{ width: 150 }}>
                    {r.unstarred
                      ? `已取消 ${r.unstarred_at?.replace("T", " ") ?? ""}`
                      : r.unstar_due
                        ? `排队中（约 ${new Date(r.unstar_due * 1000).toLocaleString("zh-CN", { hour12: false })}）`
                        : "待登记"}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <Empty
            title="还没有 star 记录"
            description="执行批量 star 后，这里会记录每个项目的 star 与取消状态。"
          />
        )}
      </section>
    </>
  );
}
