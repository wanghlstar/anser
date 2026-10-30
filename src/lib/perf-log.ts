import { invoke, isTauri } from "@tauri-apps/api/core";

const STORAGE_KEY = "yanxin-perf-log-enabled";

export interface PerfLogInfo {
  enabled: boolean;
  path: string;
  size: number;
}

let enabled =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(STORAGE_KEY) === "1";

export function perfLogEnabled() {
  return enabled;
}

export function setPerfLogEnabledLocal(value: boolean) {
  enabled = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in restricted previews.
  }
}

export function logPerf(
  event: string,
  data: Record<string, unknown> = {},
  ms?: number,
) {
  if (!enabled || !isTauri()) return;
  const entry = {
    event,
    ms: ms == null ? undefined : Math.round(ms * 10) / 10,
    ...data,
  };
  void invoke("perf_log_append", {
    line: JSON.stringify(entry),
  }).catch(() => {});
}

export function perfQueryMeta(query: {
  view?: string;
  accountId?: string;
  folder?: string;
  remoteFolder?: string;
  limit?: number;
  unreadOnly?: boolean;
  search?: string;
}) {
  return {
    view: query.view,
    accountId: query.accountId ? "account" : "",
    folder: query.folder || "",
    remoteFolder: query.remoteFolder || "",
    limit: query.limit,
    unreadOnly: !!query.unreadOnly,
    hasSearch: !!query.search,
  };
}
