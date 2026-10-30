import { useEffect, useState } from "react";
import { call, native } from "@/lib/api";
import { setPerfLogEnabledLocal, type PerfLogInfo } from "@/lib/perf-log";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

export function PerfLogControl() {
  const [perf, setPerf] = useState<PerfLogInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<PerfLogInfo>("perf_log_status")
      .then((info) => {
        setPerf(info);
        setPerfLogEnabledLocal(info.enabled);
      })
      .catch(() => setPerf(null));
  }, []);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const info = await call<PerfLogInfo>("set_perf_log", { enabled });
      setPerf(info);
      setPerfLogEnabledLocal(info.enabled);
      toast.success(enabled ? "性能日志已开启" : "性能日志已关闭");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      const text =
        (await call<string>("perf_log_read", { limit: 300 })) || "（暂无日志）";
      // WKWebView 的 navigator.clipboard 会抛 NotAllowedError，原生侧写剪贴板。
      if (native) await call("copy_text", { text });
      else await navigator.clipboard.writeText(text);
      toast.success("最近性能日志已复制");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function clear() {
    try {
      await call("perf_log_clear");
      setPerf(await call<PerfLogInfo>("perf_log_status"));
      toast.success("性能日志已清空");
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">性能日志</span>
        <Switch
          checked={!!perf?.enabled}
          disabled={busy}
          aria-label="开启性能日志"
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        默认关闭。开启后记录点击导航、列表请求和命令耗时，不记录邮件正文；日志最多
        16 MB。
      </p>
      {perf && (
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {perf.enabled ? "已开启" : "已关闭"} · {perf.path}
          {perf.size ? ` · ${Math.round(perf.size / 1024)} KB` : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!perf?.enabled}
          onClick={() =>
            void call("open_perf_log").catch((e) => toast.error(String(e)))
          }
        >
          打开日志
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!perf?.enabled}
          onClick={() => void copy()}
        >
          复制最近 300 行
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!perf?.enabled}
          onClick={() => void clear()}
        >
          清空日志
        </Button>
      </div>
    </div>
  );
}
