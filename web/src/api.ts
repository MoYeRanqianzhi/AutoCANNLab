// 管理 API 客户端。Token 保存在 localStorage（仅本机使用），所有请求带 Bearer 头。

const TOKEN_KEY = "autocannlab_api_token";

export function getApiToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setApiToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getApiToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (resp.status === 401) {
    throw new ApiError(401, "API Token 无效，请在右上角设置中填入服务端 Token");
  }
  const text = await resp.text();
  const body = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new ApiError(resp.status, body.detail ?? `请求失败（${resp.status}）`);
  }
  return body as T;
}

export type ServerAccount = {
  id: string;
  username: string | null;
  note: string;
  proxy_id: string | null;
  enabled: boolean;
  is_default: boolean;
  created_at: string | null;
  has_tokens: boolean;
};
export type ServerProxy = {
  id: string;
  name: string;
  protocol: "HTTP" | "SOCKS5";
  host: string;
  port: number;
  enabled: boolean;
  has_auth: boolean;
};
export type ServerState = {
  accounts: ServerAccount[];
  proxies: ServerProxy[];
  schedule: {
    enabled: boolean;
    time: string;
    weekdays: number[];
    mode: "daily" | "full";
    account_id: string;
  };
  running: ServerRun[];
};
export type ServerRun = {
  id: string;
  account_id: string;
  username: string | null;
  mode: string;
  status: "running" | "ok" | "error";
  started_at: string | null;
  finished_at: string | null;
  log: { time: string; level: string; message: string }[];
  summary: string | null;
};
export type AccountStatus = {
  signed_in: boolean;
  cann_points: number | null;
  quota: {
    label: string;
    remaining: number;
    total: number;
    unit: string;
  }[];
  refresh_days_left: number | null;
};
export type UiTask = {
  task_id: number;
  cn_name: string;
  description: string;
  score: number;
  currency: "CANN" | "GitCode";
  category: "daily" | "once";
  done: boolean;
};

export const api = {
  state: () => request<ServerState>("/state"),
  addAccount: (body: {
    access_token: string;
    refresh_token: string;
    note: string;
    proxy_id?: string | null;
  }) => request<ServerAccount>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  removeAccount: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
  pauseAccount: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}/pause`, { method: "POST" }),
  resumeAccount: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}/resume`, { method: "POST" }),
  setDefault: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}/default`, { method: "POST" }),
  patchAccount: (id: string, body: { note?: string }) =>
    request<ServerAccount>(`/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setAccountProxy: (id: string, proxyId: string | null) =>
    request<{ ok: boolean }>(`/accounts/${id}/proxy`, {
      method: "POST",
      body: JSON.stringify({ proxy_id: proxyId }),
    }),
  accountStatus: (id: string) =>
    request<AccountStatus>(`/accounts/${id}/status`),
  accountTasks: (id: string) => request<UiTask[]>(`/accounts/${id}/tasks`),
  addProxy: (body: {
    name: string;
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    enabled?: boolean;
  }) => request<ServerProxy>("/proxies", { method: "POST", body: JSON.stringify(body) }),
  removeProxy: (id: string) =>
    request<{ ok: boolean }>(`/proxies/${id}`, { method: "DELETE" }),
  testProxy: (id: string) =>
    request<{ ok: boolean; status?: number; latency_ms?: number; error?: string }>(
      `/proxies/${id}/test`,
      { method: "POST" },
    ),
  saveSchedule: (body: Partial<ServerState["schedule"]>) =>
    request<ServerState["schedule"]>("/schedule", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  startRun: (accountId: string, mode: "daily" | "full") =>
    request<{ run_id: string }>("/runs", {
      method: "POST",
      body: JSON.stringify({ account_id: accountId, mode }),
    }),
  getRun: (id: string) => request<ServerRun>(`/runs/${id}`),
  listRuns: () => request<ServerRun[]>("/runs"),
  logs: (level = "all", q = "") =>
    request<{ file: string; level: string; message: string }[]>(
      `/logs?level=${encodeURIComponent(level)}&q=${encodeURIComponent(q)}&limit=200`,
    ),
};
