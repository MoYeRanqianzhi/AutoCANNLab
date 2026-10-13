// CANN 项目 Star 队列管理弹窗：从任务中心「CANN 项目 Star 积分」任务行打开。
// 左侧可选项目清单（缓存，点「更新清单」才请求 GitCode），点行内 star 即入队；
// 队列常驻后台自动执行（拟人化节奏），可暂停/继续；star 后 6-15 小时自动取消。
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
  accountId: string;
  accountName: string;
  notify: (message: string) => void;
  onChanged: () => void; // 关闭或状态变化后让任务中心刷新
};

// 任务中心顶部的 Star 队列专属面板：概要 + 打开管理入口。
export function StarQueuePanel({
  activeId,
  onOpen,
}: {
  activeId: string;
  onOpen: () => void;
}) {
  const [summary, setSummary] = useState<{
    queued: number;
    starred: number;
    done: number;
    projects_cached: number;
    paused: boolean;
    running: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api.batchStarSummary(activeId));
    } catch {
      // 概要失败不阻塞任务中心
    }
  }, [activeId]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const total = summary ? summary.queued + summary.starred + summary.done : 0;

  return (
    <section className="panel star-panel">
      <div className="table-toolbar">
        <div className="star-panel-title">
          <span className="task-icon">
            <Icon name="star" size={19} />
          </span>
          <div>
            <strong>CANN 项目 Star 积分</strong>
            <p>批量 star CANN org 项目，每个 +50 积分，star 后自动取消。</p>
          </div>
        </div>
        <button className="button primary" onClick={onOpen}>
          <Icon name="arrow" size={16} />
          管理 Star 队列
        </button>
      </div>
      <div className="star-panel-summary">
        {summary && total > 0 ? (
          <>
            <span>
              队列中 <strong>{summary.queued}</strong>
            </span>
            <span>
              已 star <strong>{summary.starred}</strong>
            </span>
            <span>
              已完成 <strong>{summary.done}</strong>
            </span>
            <span>
              预计积分 <strong>+{(summary.queued + summary.starred) * 50}</strong>
            </span>
            {summary.running && (
              <Badge tone="orange">
                <Icon name="loader" className="spin" size={12} /> 执行中
              </Badge>
            )}
            {summary.paused && !summary.running && <Badge tone="neutral">已暂停</Badge>}
          </>
        ) : (
          <span>
            {summary && summary.projects_cached > 0
              ? `清单已缓存 ${summary.projects_cached} 个项目，尚无 star 记录`
              : "尚未拉取项目清单，进入管理后点「更新清单」"}
          </span>
        )}
      </div>
      <div className="panel-foot">
        <Icon name="shield" size={14} />
        拟人化慢速执行，手动 star 的项目永远不会被自动取消
        <span>{total > 0 ? `${total} 条记录` : "独立于日常任务"}</span>
      </div>
    </section>
  );
}

export function StarQueueDialog({ accountId, notify, onChanged }: Props) {
  const [projects, setProjects] = useState<BatchStarProject[]>([]);
  const [records, setRecords] = useState<BatchStarRecord[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [queueBusy, setQueueBusy] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<BatchStarRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLocal = useCallback(async () => {
    try {
      const [list, recs] = await Promise.all([
        api.batchStarProjects(accountId),
        api.batchStarRecords(accountId),
      ]);
      setProjects(list);
      setRecords(recs);
      setFetchedAt(list.find((p) => p.fetched_at)?.fetched_at ?? null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "加载失败");
    }
  }, [accountId, notify]);

  useEffect(() => {
    void loadLocal();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadLocal]);

  // 队列执行进度轮询：批量运行挂在最近一次 batch_star run 上
  useEffect(() => {
    const poll = async () => {
      try {
        const runs = await api.listRuns();
        const starRun = runs.find((r) => r.mode === "batch_star");
        if (starRun && starRun.status === "running") {
          setRunId(starRun.id);
          setRun(starRun as BatchStarRun);
        } else if (runId && starRun && starRun.id === runId) {
          setRun(starRun as BatchStarRun);
          if (starRun.status !== "running") {
            notify(starRun.summary ?? "队列执行结束");
            setRunId(null);
            await loadLocal();
            onChanged();
          }
        }
      } catch {
        // 轮询失败下次重试
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, loadLocal, onChanged]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.batchStarRefresh(accountId);
      setFetchedAt(result.fetched_at);
      notify(`清单已更新，共 ${result.count} 个项目`);
      await loadLocal();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "更新清单失败");
    } finally {
      setRefreshing(false);
    }
  }, [accountId, loadLocal, notify]);

  const enqueue = async (project: BatchStarProject) => {
    setQueueBusy(project.id);
    try {
      await api.batchStarEnqueue({ account_id: accountId, project_id: project.id });
      notify(`${project.path} 已加入队列，将自动逐个 star`);
      await loadLocal();
      onChanged();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "加入队列失败");
    } finally {
      setQueueBusy(null);
    }
  };

  const togglePause = async () => {
    try {
      if (paused) {
        await api.batchStarResume(accountId);
        setPaused(false);
        notify("队列已恢复，继续执行剩余项目");
      } else {
        await api.batchStarPause(accountId);
        setPaused(true);
        notify("队列已暂停，当前项目完成后停下");
      }
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "操作失败");
    }
  };

  const queued = records.filter((r) => r.source === "batch" && r.status === "queued");
  const starred = records.filter((r) => r.source === "batch" && r.status === "starred" && !r.unstarred);
  const done = records.filter((r) => r.source === "batch" && r.unstarred);

  const queuedPaths = new Set(queued.map((r) => r.path));
  const pool = projects
    .filter((p) => p.star_state === "new" && !p.archived && !queuedPaths.has(p.path))
    .filter((p) => !query || p.path.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="star-queue-dialog">
      <div className="star-queue-stats">
        <div>
          <span>队列中</span>
          <strong>{queued.length}</strong>
        </div>
        <div>
          <span>已 star</span>
          <strong>{starred.length}</strong>
        </div>
        <div>
          <span>已完成</span>
          <strong>{done.length}</strong>
        </div>
        <div>
          <span>积分</span>
          <strong>
            +{done.length * 50}
            <small> 已到账</small>
          </strong>
        </div>
      </div>

      {run && (
        <div className={`running-banner ${run.status !== "running" ? "done" : ""}`}>
          <Icon name={run.status === "running" ? "loader" : "check"} className={run.status === "running" ? "spin" : ""} />
          <span>
            {run.status === "running"
              ? `正在执行 ${run.progress?.done ?? 0}/${run.progress?.total ?? 0}（已 star ${run.progress?.starred ?? 0}）${run.cancel_requested ? " · 暂停中…" : ""}`
              : run.summary ?? "队列执行结束"}
          </span>
          {run.status === "running" && (
            <button onClick={() => void togglePause()}>{paused ? "继续" : "暂停"}</button>
          )}
        </div>
      )}

      <div className="star-queue-toolbar">
        <span className="star-queue-hint">
          {fetchedAt
            ? `清单更新于 ${fetchedAt.replace("T", " ")}`
            : "尚未拉取项目清单"}
        </span>
        <button className="text-button" disabled={refreshing} onClick={() => void refresh()}>
          <Icon name={refreshing ? "loader" : "activity"} className={refreshing ? "spin" : ""} size={15} />
          {refreshing ? "更新中" : "更新清单"}
        </button>
      </div>

      <div className="star-queue-grid">
        <section className="star-queue-panel">
          <div className="star-queue-head">
            <strong>可 star 项目</strong>
            <label className="search-field">
              <Icon name="search" size={14} />
              <input
                placeholder="搜索项目"
                aria-label="搜索项目"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="star-queue-list">
            {pool.length ? (
              pool.map((p) => (
                <div className="star-queue-row" key={p.id}>
                  <span className="stars-path">{p.path}</span>
                  <button
                    className="star-action"
                    aria-label={`把 ${p.path} 加入队列`}
                    title="加入队列"
                    disabled={queueBusy === p.id}
                    onClick={() => void enqueue(p)}
                  >
                    <Icon
                      name={queueBusy === p.id ? "loader" : "star"}
                      className={queueBusy === p.id ? "spin" : ""}
                      size={15}
                    />
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title="没有可 star 的项目"
                description="点右上角「更新清单」从 GitCode 拉取最新项目。"
              />
            )}
          </div>
        </section>

        <section className="star-queue-panel">
          <div className="star-queue-head">
            <strong>执行队列</strong>
            {queued.length > 0 && (
              <button className="text-button" onClick={() => void togglePause()}>
                {paused ? "继续" : "暂停"}
              </button>
            )}
          </div>
          <div className="star-queue-list">
            {queued.length ? (
              queued.map((r, index) => (
                <div className="star-queue-row" key={`${r.account_id}-${r.project_id}`}>
                  <span className="queue-order">{index + 1}</span>
                  <span className="stars-path">{r.path}</span>
                  <Badge tone="orange">+50</Badge>
                </div>
              ))
            ) : (
              <Empty
                title="队列为空"
                description="在左侧点项目旁的 star 图标，项目会排进队列自动执行。"
              />
            )}
          </div>
        </section>
      </div>

      {(starred.length > 0 || done.length > 0) && (
        <section className="star-queue-panel wide">
          <div className="star-queue-head">
            <strong>
              执行记录（已 star {starred.length}，已完成 {done.length}）
            </strong>
          </div>
          <div className="star-queue-list records">
            {[...starred, ...done]
              .sort((a, b) => (b.starred_at ?? "").localeCompare(a.starred_at ?? ""))
              .map((r) => (
                <div className="star-queue-row" key={`${r.account_id}-${r.project_id}`}>
                  <span className="stars-path">{r.path}</span>
                  <span className="record-meta">
                    {r.unstarred
                      ? `已取消 ${r.unstarred_at?.replace("T", " ") ?? ""}`
                      : r.unstar_due
                        ? `约 ${new Date(r.unstar_due * 1000).toLocaleString("zh-CN", { hour12: false })} 自动取消`
                        : "已 star"}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      <p className="star-queue-note">
        执行为拟人化慢速节奏：逐个 star、随机顺序与间隔、定期休整，全部项目约需 2-4 小时。
        star 后随机 6-15 小时由后台队列逐个自动取消；你手动 star 的项目永远不会被取消。
        队列执行与日常任务全局串行，执行期间请勿运行日常任务。
      </p>
    </div>
  );
}
