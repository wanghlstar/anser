import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { call, isDemo } from "@/lib/api";
import type { ArchiveHealth, ArchiveHealthProgress } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "./ui/button";

const ARCHIVE_HEALTH_KEY = "yanxin.archiveHealth";

function loadStoredHealth(): ArchiveHealth | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_HEALTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ArchiveHealth;
    if (
      typeof value.checked !== "number" ||
      typeof value.healthy !== "number" ||
      typeof value.checkedAt !== "string" ||
      !Array.isArray(value.problems)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function storeHealth(value: ArchiveHealth) {
  try {
    localStorage.setItem(ARCHIVE_HEALTH_KEY, JSON.stringify(value));
  } catch {
    // 存储失败时仍显示当前窗口的校验结果
  }
}

export function useArchiveHealth() {
  const [checking, setChecking] = useState(false);
  const [mode, setMode] = useState<"quick" | "deep" | null>(null);
  const running = useRef(false);
  const [health, setHealth] = useState<ArchiveHealth | null>(loadStoredHealth);
  const [progress, setProgress] = useState<ArchiveHealthProgress | null>(null);

  // 后端的 10:00 / 17:00 自动校验完成后推送结果；不能只写入日志，
  // 否则设置页会一直显示上一次手动校验的时间。
  useEffect(() => {
    if (isDemo()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ArchiveHealth>("archive-health-auto", (event) => {
          setHealth(event.payload);
          storeHealth(event.payload);
        }),
      )
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  async function check(deep = false) {
    if (running.current) return;
    running.current = true;
    setMode(deep ? "deep" : "quick");
    setChecking(true);
    setProgress({ done: 0, total: 0, deep, running: true });
    toast.loading(deep ? "正在深度校验存档…" : "正在快速校验存档…", {
      id: "archive-health-check",
    });
    const poll = setInterval(() => {
      void call<ArchiveHealthProgress>("archive_health_progress")
        .then((value) => {
          if (running.current) setProgress(value);
        })
        .catch(() => {});
    }, 200);
    try {
      const result = await call<ArchiveHealth>("archive_health", { deep });
      setHealth(result);
      storeHealth(result);
      if (result.problems.length) {
        toast.warning(
          `校验完成：${result.problems.length} 封需要处理，检查 ${result.checked} 封`,
          { id: "archive-health-check", duration: 5000 },
        );
      } else {
        toast.success(
          `校验完成：检查 ${result.checked} 封，通过 ${result.healthy} 封` +
            (result.unavailable
              ? `，${result.unavailable} 封外置暂未校验`
              : ""),
          { id: "archive-health-check", duration: 5000 },
        );
      }
    } catch (e) {
      if (String(e).includes("已取消"))
        toast.info("已取消存档校验", { id: "archive-health-check" });
      else toast.error(String(e), { id: "archive-health-check" });
    } finally {
      clearInterval(poll);
      running.current = false;
      setChecking(false);
      setMode(null);
      setProgress(null);
    }
  }

  async function cancel() {
    if (!running.current) return;
    try {
      await call("archive_health_cancel");
      toast.loading("正在取消存档校验…", { id: "archive-health-check" });
    } catch (e) {
      toast.error(String(e), { id: "archive-health-check" });
    }
  }

  return { checking, mode, health, check, progress, cancel };
}

export function ArchiveHealthStatus({
  checking,
  mode,
  health,
  progress,
  onCancel,
}: {
  checking: boolean;
  mode?: "quick" | "deep" | null;
  health: ArchiveHealth | null;
  progress?: ArchiveHealthProgress | null;
  onCancel?: () => void;
}) {
  return (
    <div className="storage-health">
      <div className="storage-health-row">
        <span className="text-sm">
          {health
            ? `校验 ${health.healthy} / ${health.checked} 封通过`
            : checking
              ? mode === "deep"
                ? "正在进行深度校验…"
                : "正在进行快速校验…"
              : "尚未校验"}
        </span>
        {checking && progress && (
          <small className="storage-health-note">
            {progress.total
              ? `已检查 ${progress.done} / ${progress.total} 封`
              : "正在读取存档…"}
          </small>
        )}
        {!checking && health && (
          <small className="storage-health-note">
            最近校验：
            {new Date(health.checkedAt).toLocaleString("zh-CN", {
              hour12: false,
            })}
          </small>
        )}
        {checking && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
      {health?.externalArchiveUnavailable && (
        <p className="storage-health-note">
          外置存档未连接，{health.unavailable ?? 0}{" "}
          封暂未校验；连接外置盘后可重新校验。
        </p>
      )}
      {isDemo() && <p>演示模式仅展示示例校验结果。</p>}
      {health && health.problems.length > 0 && (
        <div className="archive-problems" role="alert">
          <p>
            <AlertCircle size={14} /> {health.problems.length}{" "}
            封需要检查，可从备份恢复
          </p>
          {health.problems.map((p) => (
            <div key={p.mailId}>
              <strong>{p.subject || "（无主题）"}</strong>
              <span>{p.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
