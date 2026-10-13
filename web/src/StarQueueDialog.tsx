// CANN 项目 Star 队列的内联管理区：随任务中心 Star 分类行展开（非弹窗、不跳页）。
// 左栏点项目旁的 star 即入队，右栏队列由后台自动执行（拟人化节奏）；
// star 后 6-15 小时自动取消；项目清单缓存服务端，仅「更新清单」访问 GitCode。
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
  notify: (message: string) => void;
  onChanged: () => void; // 状态变化后让任务清单刷新
};

export function StarQueueDialog({ accountId, notify, onChanged }: Props) {
  const [projects, setProjects] = useState<BatchStarProject[]>([]);
  const [records, setRecords] = useState<BatchStarRecord[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [queueBusy, setQueueBusy] = useState<number | null>(null);
  const [enqueueAllBusy, setEnqueueAllBusy] = useState(false);
  const [paused, setPaused] = useState(false);
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
      notify(error instanceof ApiError ? error.message : "加载 Star 队列失败");
    }
  }, [accountId, notify]);

  useEffect(() => {
    void loadLocal();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadLocal]);

  // 执行进度轮询
  useEffect(() => {
    const poll = async () => {
      try {
        const runs = await api.listRuns();
        const starRun = runs.find((r) => r.mode === "batch_star");
        if (starRun && starRun.status === "running") {
          setRun(starRun as BatchStarRun);
        } else if (starRun) {
          setRun(starRun.status === "ok" ? null : (starRun as BatchStarRun));
          if (starRun.status === "ok") void loadLocal();
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
  }, [loadLocal]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api.batchStarRefresh(accountId);
      setFetchedAt(result.fetched_at);
      notify(`清单已更新，共 ${result.count} 个项目`);
      await loadLocal();
      onChanged();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "更新清单失败");
    } finally {
      setRefreshing(false);
    }
  }, [accountId, loadLocal, notify, onChanged]);

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

  const enqueueAll = async () => {
    if (!pool.length) return;
    setEnqueueAllBusy(true);
    try {
      const result = await api.batchStarEnqueueAll({
        account_id: accountId,
        project_ids: pool.map((p) => p.id),
      });
      notify(`已把 ${result.added} 个项目加入队列，共 ${result.total} 项待执行`);
      await loadLocal();
      onChanged();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "批量入队失败");
    } finally {
      setEnqueueAllBusy(false);
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
    <div className="star-queue-body">
      {run && run.status === "running" && (
        <div className="running-banner">
          <Icon name="loader" className="spin" />
          <span>
            正在执行 {run.progress?.done ?? 0}/{run.progress?.total ?? 0}
            （已 star {run.progress?.starred ?? 0}）
            {run.cancel_requested ? " · 暂停中…" : ""}
          </span>
          <button onClick={() => void togglePause()}>{paused ? "继续" : "暂停"}</button>
        </div>
      )}

      <div className="star-queue-toolbar">
        <span className="star-queue-hint">
          {fetchedAt
            ? `清单更新于 ${fetchedAt.replace("T", " ")}`
            : "尚未拉取项目清单"}
        </span>
        <div className="star-queue-toolbar-actions">
          <button
            className="button star-all-btn"
            disabled={enqueueAllBusy || !pool.length}
            onClick={() => void enqueueAll()}
          >
            <Icon
              name={enqueueAllBusy ? "loader" : "star"}
              className={enqueueAllBusy ? "spin" : ""}
              size={15}
            />
            一键全部入队（{pool.length} · 约 +{pool.length * 50}）
          </button>
          <button className="text-button" disabled={refreshing} onClick={() => void refresh()}>
            <Icon
              name={refreshing ? "loader" : "activity"}
              className={refreshing ? "spin" : ""}
              size={15}
            />
            {refreshing ? "更新中" : "更新清单"}
          </button>
        </div>
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
