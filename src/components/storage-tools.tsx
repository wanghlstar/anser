import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useRef, useState } from "react";
import { Bell, Clock3, HardDrive } from "lucide-react";
import { call, isDemo, native } from "@/lib/api";
import { formatSize } from "@/lib/providers";
import type { Preferences, TierInfo, TierLog } from "@/lib/types";
import type { ThemeMode } from "@/lib/theme";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation";

function formatArchivedAt(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// 发送倒计时可选档位；0 = 立即发送
const SEND_COUNTDOWN_OPTIONS = [0, 3, 5, 10];
const DEFAULT_RESTORE_SHORTCUT = "CommandOrControl+Alt+Backquote";
const shortcutKeys: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backquote: "Backquote",
  Minus: "Minus",
  Equal: "Equal",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
  Backspace: "Backspace",
};
const shortcutModifierLabels: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};
const shortcutKeyLabels: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Space: "空格",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
function shortcutLabel(value: string) {
  return value
    .split("+")
    .map(
      (part) => shortcutModifierLabels[part] ?? shortcutKeyLabels[part] ?? part,
    )
    .join("");
}
function shortcutFromEvent(event: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  if (!(event.metaKey || event.ctrlKey || event.altKey)) return null;
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)
        ? event.code
        : shortcutKeys[event.code];
  if (!key) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("CommandOrControl");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function StorageTools({
  themeMode = "system",
  onThemeModeChange,
}: {
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
}) {
  const [preferences, setPreferences] = useState<Preferences>({
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
      startupArchiveCheck: true,
    }),
    [interval, setInterval] = useState(5),
    [countdown, setCountdown] = useState(5),
    [shortcut, setShortcut] = useState(DEFAULT_RESTORE_SHORTCUT),
    [recordingShortcut, setRecordingShortcut] = useState(false),
    [shortcutBusy, setShortcutBusy] = useState(false),
    [ready, setReady] = useState(false),
    [scale, setScale] = useState(1);
  const shortcutRef = useRef(shortcut);
  const recordingRef = useRef(recordingShortcut);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    shortcutRef.current = shortcut;
  }, [shortcut]);
  useEffect(() => {
    recordingRef.current = recordingShortcut;
  }, [recordingShortcut]);
  const [desktop, setDesktop] = useState<{
    autoStart: boolean;
    autoStartAvailable: boolean;
  } | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [saving, setSaving] = useState(false),
    [notifBusy, setNotifBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void call<Preferences>("get_preferences")
      .then((p) => {
        if (live) {
          setPreferences(p);
          setInterval(p.syncIntervalMinutes);
          // 下拉只提供 0/3/5/10；历史值或缺失时回退 8 会匹配不上选项，
          // 这里统一归到最近的合法档位（5 秒），保证回显不为空。
          setCountdown(
            SEND_COUNTDOWN_OPTIONS.includes(p.sendCountdownSeconds ?? 8)
              ? p.sendCountdownSeconds!
              : 5,
          );
          setShortcut(p.restoreShortcut || DEFAULT_RESTORE_SHORTCUT);
          setScale(p.sidebarScale ?? 1);
          setReady(true);
        }
      })
      .catch((e) => toast.error(String(e)));
    void call<{ autoStart: boolean; autoStartAvailable: boolean }>(
      "desktop_settings",
    )
      .then((p) => {
        if (live) setDesktop(p);
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, []);
  // 托盘「免打扰」切换后，已打开的设置页同步「新邮件通知」开关状态
  useEffect(() => {
    if (!native) return;
    let cleanup = () => {};
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      cleanup = await listen("preferences-updated", () => {
        void call<Preferences>("get_preferences")
          .then((p) => {
            setPreferences(p);
            setInterval(p.syncIntervalMinutes);
            setCountdown(
              SEND_COUNTDOWN_OPTIONS.includes(p.sendCountdownSeconds ?? 8)
                ? p.sendCountdownSeconds!
                : 5,
            );
            setShortcut(p.restoreShortcut || DEFAULT_RESTORE_SHORTCUT);
            setScale(p.sidebarScale ?? 1);
          })
          .catch(() => {});
      });
    });
    return () => cleanup();
  }, []);
  // 同一张卡里的三个下拉一起保存：后台检查间隔、延时发送、侧边栏字号
  async function save() {
    setSaving(true);
    try {
      const p = {
        ...preferences,
        syncIntervalMinutes: interval,
        sendCountdownSeconds: countdown,
        sidebarScale: scale,
      };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      document.documentElement.style.setProperty("--nav-scale", String(scale));
      toast.success("设置已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function notifications(
    key: "newMailNotifications" | "sendResultNotifications",
    enabled: boolean,
  ) {
    setNotifBusy(true);
    try {
      const p = { ...preferences, [key]: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      if (key === "newMailNotifications" && enabled) {
        void call("test_notification")
          .then(() =>
            toast.success(
              isDemo()
                ? "演示模式不发送系统通知"
                : "测试通知已提交，请检查通知中心",
            ),
          )
          .catch((e) => toast.error(String(e)));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setNotifBusy(false);
    }
  }
  async function saveStartupArchiveCheck(enabled: boolean) {
    setNotifBusy(true);
    try {
      const p = { ...preferences, startupArchiveCheck: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success(enabled ? "下次启动将自动校验存档" : "已关闭启动校验存档");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setNotifBusy(false);
    }
  }
  async function saveDockVisible(enabled: boolean) {
    setNotifBusy(true);
    try {
      const p = { ...preferences, dockVisible: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success(
        enabled ? "Dock 图标将始终显示" : "Dock 图标将仅在打开窗口时显示",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setNotifBusy(false);
    }
  }
  async function autoStart(enabled: boolean) {
    setDesktopBusy(true);
    try {
      await call("set_auto_start", { enabled });
      setDesktop(await call("desktop_settings"));
      toast.success(enabled ? "开机自启已开启" : "开机自启已关闭");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDesktopBusy(false);
    }
  }
  async function beginRecording() {
    if (recordingShortcut) {
      cancelRecording();
      return;
    }
    if (native) {
      try {
        await call("suspend_restore_shortcut");
      } catch (e) {
        toast.error(String(e));
        return;
      }
    }
    setRecordingShortcut(true);
  }
  function cancelRecording() {
    setRecordingShortcut(false);
    if (!native) return;
    void call("set_restore_shortcut", { shortcut: shortcutRef.current }).catch(
      (e) => toast.error(String(e)),
    );
  }
  useEffect(() => {
    if (!recordingShortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        cancelRecording();
        return;
      }
      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
      const next = shortcutFromEvent(event);
      if (next) void saveShortcut(next);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !shortcutButtonRef.current?.contains(event.target)
      )
        cancelRecording();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  });
  useEffect(() => {
    return () => {
      if (!recordingRef.current || !native) return;
      void call("set_restore_shortcut", {
        shortcut: shortcutRef.current,
      }).catch(() => {});
    };
  }, []);
  async function saveShortcut(value: string) {
    setRecordingShortcut(false);
    setShortcutBusy(true);
    try {
      await call("set_restore_shortcut", { shortcut: value });
      setShortcut(value);
      setPreferences((current) => ({ ...current, restoreShortcut: value }));
      toast.success(`恢复窗口快捷键已设为 ${shortcutLabel(value)}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setShortcutBusy(false);
    }
  }
  return (
    <div className="storage-tools">
      <div className="storage-tools-top">
        <Card className="settings-tool">
          <div className="settings-tool-title">
            <Bell size={18} />
            <h3>通知与启动</h3>
          </div>
          <div className="settings-tool-switches">
            <div className="settings-tool-row justify-between">
              <Label htmlFor="new-mail-notifications">新邮件通知</Label>
              <Switch
                id="new-mail-notifications"
                checked={preferences.newMailNotifications ?? true}
                disabled={!ready || notifBusy}
                onCheckedChange={(enabled) =>
                  void notifications("newMailNotifications", enabled)
                }
              />
            </div>
            <div className="settings-tool-row justify-between">
              <Label htmlFor="send-result-notifications">发送结果通知</Label>
              <Switch
                id="send-result-notifications"
                checked={preferences.sendResultNotifications ?? true}
                disabled={!ready || notifBusy}
                onCheckedChange={(enabled) =>
                  void notifications("sendResultNotifications", enabled)
                }
              />
            </div>
            <div className="settings-tool-row justify-between">
              <Label htmlFor="startup-archive-check">启动校验存档</Label>
              <Switch
                id="startup-archive-check"
                checked={preferences.startupArchiveCheck ?? true}
                disabled={!ready || notifBusy}
                onCheckedChange={(enabled) =>
                  void saveStartupArchiveCheck(enabled)
                }
              />
            </div>
            <div className="settings-tool-row justify-between">
              <Label htmlFor="dock-visible">Dock 图标</Label>
              <Switch
                id="dock-visible"
                checked={preferences.dockVisible ?? true}
                disabled={!ready || notifBusy}
                onCheckedChange={(enabled) => void saveDockVisible(enabled)}
              />
            </div>
            <div className="settings-tool-row justify-between">
              <Label htmlFor="auto-start">开机自启</Label>
              <Switch
                id="auto-start"
                checked={desktop?.autoStart || false}
                disabled={
                  !desktop ||
                  desktopBusy ||
                  (!desktop.autoStartAvailable && !desktop.autoStart)
                }
                onCheckedChange={(enabled) => void autoStart(enabled)}
              />
            </div>
          </div>
          <p>
            新邮件和发送结果使用系统通知；首次导入旧邮件不通知，横幅由 macOS
            设置控制。
          </p>
          <p>
            启动校验存档会在每次打开应用后检查一次本地原件；另外内置定时每日
            10:00 和 17:00 定时校验不受此控制。此通知不受通知开关控制。
          </p>
          <p>
            开启 Dock
            图标时始终显示；关闭时仅在打开窗口时显示，关闭或最小化窗口会自动隐藏，菜单栏图标仍可打开主窗口。
          </p>
          <p>
            {desktop?.autoStartAvailable === false
              ? "开发预览依赖前端服务，请在正式应用中开启开机自启。"
              : "登录 Mac 后自动在后台启动，继续收信和处理定时发送。"}
          </p>
          {isDemo() && <p>演示模式不修改系统启动项。</p>}
        </Card>
        <Card className="settings-tool">
          <div className="settings-tool-title">
            <Clock3 size={18} />
            <h3>间隔与外观</h3>
          </div>
          {/* 下拉同行并排（含义看卡底说明），合并后的保存按钮靠右 */}
          <div className="settings-tool-row">
            <div className="settings-tool-selects">
              <SelectField
                aria-label="后台检查间隔"
                value={interval}
                disabled={!ready || saving}
                onValueChange={(value) => setInterval(Number(value))}
              >
                {[1, 5, 10, 15, 30, 60].map((n) => (
                  <SelectOption key={n} value={n}>
                    每 {n} 分钟
                  </SelectOption>
                ))}
              </SelectField>
              <SelectField
                aria-label="延时发送时间"
                value={countdown}
                disabled={!ready || saving}
                onValueChange={(value) => setCountdown(Number(value))}
              >
                {SEND_COUNTDOWN_OPTIONS.map((n) => (
                  <SelectOption key={n} value={n}>
                    {n ? `延时 ${n} 秒` : "立即发送"}
                  </SelectOption>
                ))}
              </SelectField>
              <SelectField
                aria-label="侧栏字号"
                value={scale}
                disabled={!ready || saving}
                onValueChange={(value) => setScale(Number(value))}
              >
                {[
                  [0.9, "紧凑"],
                  [1, "标准"],
                  [1.15, "大"],
                ].map(([value, label]) => (
                  <SelectOption key={String(value)} value={value as number}>
                    {label}
                  </SelectOption>
                ))}
              </SelectField>
              <SelectField
                aria-label="界面主题"
                value={themeMode}
                onValueChange={(value) =>
                  onThemeModeChange?.(value as ThemeMode)
                }
              >
                <SelectOption value="system">跟随系统</SelectOption>
                <SelectOption value="light">浅色</SelectOption>
                <SelectOption value="dark">深色</SelectOption>
              </SelectField>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !ready ||
                saving ||
                (interval === preferences.syncIntervalMinutes &&
                  countdown === (preferences.sendCountdownSeconds ?? 5) &&
                  scale === (preferences.sidebarScale ?? 1))
              }
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
          <div className="settings-tool-row">
            <span className="text-sm">恢复窗口快捷键</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              ref={shortcutButtonRef}
              className="min-w-24 font-mono"
              aria-label="恢复窗口快捷键"
              disabled={!ready || shortcutBusy}
              title={
                recordingShortcut
                  ? "请按包含 ⌘、⌃ 或 ⌥ 的组合键；Esc 取消"
                  : `当前：${shortcutLabel(shortcut)}`
              }
              onClick={() => void beginRecording()}
            >
              {shortcutBusy
                ? "保存中…"
                : recordingShortcut
                  ? "请按组合键…"
                  : shortcutLabel(shortcut)}
            </Button>
          </div>
          <p>IMAP 优先实时收取；此间隔用于定时补查和 POP3。</p>
          <p>
            延时发送：点「发送邮件」后先收起写信窗口，倒计时结束再发送；
            期间可继续操作其他功能，也能撤回或立即发送。
          </p>
          <p>侧栏字号：调整左侧栏文字大小，立即生效，无需重启。</p>
          <p>
            恢复窗口快捷键：窗口隐藏或最小化后，按此组合键恢复并聚焦；点击后直接按新组合键，Esc
            取消。被 macOS 占用的组合键无法录制，请换一个。
          </p>
        </Card>
      </div>
    </div>
  );
}

export function ArchiveTools() {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [tier, setTier] = useState<TierInfo | null>(null),
    [tierLog, setTierLog] = useState<TierLog | null>(null),
    [tierBusy, setTierBusy] = useState(false);
  useEffect(() => {
    const reload = () => {
      void call<TierInfo>("archive_tier_info")
        .then(setTier)
        .catch(() => setTier(null));
    };
    reload();
    window.addEventListener("archive-tier-changed", reload);
    void loadTierLog();
    return () => window.removeEventListener("archive-tier-changed", reload);
  }, []);
  async function pickExternalDir() {
    if (isDemo()) {
      toast.error("演示模式不支持选择目录");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: tier?.externalDir || undefined,
        title: "选择外置存档目录",
      });
      if (!picked || typeof picked !== "string") return;
      if (tier?.importLocation === "external" && picked !== tier.externalDir) {
        const ok = await askConfirmation({
          title: "更改外置存档位置？",
          description:
            "当前新导入邮件使用外置存档。更改后，之后导入的邮件会写入新目录；已有邮件不会自动迁移。",
          action: "更改目录",
        });
        if (!ok) return;
      }
      await call("save_archive_tier_settings", {
        externalDir: picked,
        retentionDays: tier?.retentionDays ?? 30,
        indexEnabled: tier?.indexEnabled ?? true,
        importLocation: tier?.importLocation ?? "internal",
      });
      setTier(await call<TierInfo>("archive_tier_info"));
      window.dispatchEvent(new Event("archive-tier-changed"));
      void loadTierLog();
      toast.success("外置存档目录已设置");
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function saveTier(patch: Partial<TierInfo>) {
    setTierBusy(true);
    try {
      await call("save_archive_tier_settings", {
        externalDir: patch.externalDir ?? tier?.externalDir ?? "",
        retentionDays: patch.retentionDays ?? tier?.retentionDays ?? 30,
        indexEnabled: patch.indexEnabled ?? tier?.indexEnabled ?? true,
        importLocation:
          patch.importLocation ?? tier?.importLocation ?? "internal",
      });
      setTier(await call<TierInfo>("archive_tier_info"));
      window.dispatchEvent(new Event("archive-tier-changed"));
      toast.success("已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTierBusy(false);
    }
  }
  async function normalizeNames() {
    setTierBusy(true);
    try {
      const n = await call<number>("normalize_archive_paths");
      setTier(await call<TierInfo>("archive_tier_info"));
      void loadTierLog();
      toast.success(n ? `已规范 ${n} 封存档目录名` : "目录名均已是最新");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTierBusy(false);
    }
  }
  async function recallTier() {
    setTierBusy(true);
    try {
      const n = await call<number>("tier_recall");
      setTier(await call<TierInfo>("archive_tier_info"));
      void loadTierLog();
      toast.success(n ? `已取回 ${n} 封到本地` : "没有需要取回的存档");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTierBusy(false);
    }
  }
  async function loadTierLog() {
    try {
      setTierLog(await call<TierLog>("archive_tier_log"));
    } catch {
      setTierLog(null);
    }
  }
  async function runTierNow() {
    setTierBusy(true);
    try {
      const report = await call<{ moved: number; errors: string[] }>(
        "tier_archives_now",
      );
      setTier(await call<TierInfo>("archive_tier_info"));
      void loadTierLog();
      toast.success(
        report.errors.length
          ? `归档完成，${report.errors.length} 个失败`
          : `已归档 ${report.moved} 封`,
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTierBusy(false);
    }
  }
  async function openArchive() {
    try {
      await call("open_external_archive");
    } catch (e) {
      toast.error(String(e));
    }
  }
  return (
    <>
      <Card className="settings-tool">
        <div className="settings-tool-title">
          <HardDrive size={18} />
          <h3>附加存档</h3>
        </div>
        <div className="settings-tool-row">
          <span className="text-sm">
            {tier?.externalDir
              ? `外置存档：${tier.externalDir}`
              : "未设置外置存档目录"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void pickExternalDir()}
          >
            {tier?.externalDir ? "更改目录" : "选择存档目录"}
          </Button>
        </div>
        <div className="settings-tool-row">
          <div className="settings-tool-inline">
            <SelectField
              aria-label="本地保留天数"
              value={tier?.retentionDays ?? 30}
              disabled={tierBusy}
              onValueChange={(v) => void saveTier({ retentionDays: Number(v) })}
            >
              {[7, 14, 30, 90].map((n) => (
                <SelectOption key={n} value={n}>
                  保留 {n} 天
                </SelectOption>
              ))}
              <SelectOption value={0}>永久保留本地</SelectOption>
            </SelectField>
            <span className="text-sm">
              {tierLog?.total != null
                ? `已归档 ${tierLog.total.toLocaleString("zh-CN")} 封` +
                  (tierLog.totalBytes != null
                    ? ` · ${formatSize(tierLog.totalBytes)}`
                    : "")
                : "外置盘未连接"}
            </span>
          </div>
          <div className="settings-tool-actions">
            {tier?.externalDir && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openArchive()}
              >
                打开存档
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={tierBusy || !tier?.externalDir}
              onClick={() => void runTierNow()}
            >
              {tierBusy ? "处理中…" : "立即归档"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={tierBusy || !tier?.externalDir}
              onClick={() => void recallTier()}
            >
              取回本地
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={tierBusy}
              onClick={() => void normalizeNames()}
            >
              规范目录
            </Button>
          </div>
        </div>
        <p>
          收到超过保留天数的邮件，其本地存档会自动移到外置目录（按邮件日期计算，
          随盘生成 index.html
          索引，任何机器用浏览器打开即可检索）。未带外置盘时：
          账户与近期邮件不受影响，打开旧邮件会提示连接外置盘。
          {tier && tier.pending > 0 && (
            <>
              {" "}
              当前待归档 <strong>{tier.pending}</strong> 封。
            </>
          )}
          {tier?.externalDir &&
            !tier.externalReachable &&
            "（外置盘当前未连接）"}
        </p>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="tier-log-trigger">
              最近归档记录（{tierLog?.entries.length ?? 0}）
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="tier-log-list">
              {tierLog && tierLog.entries.length > 0 ? (
                tierLog.entries.map((entry, i) => (
                  <div
                    key={`${entry.archivedAt}-${entry.subject}-${i}`}
                    className="tier-log-item"
                  >
                    <span className="tier-log-date">
                      {formatArchivedAt(entry.archivedAt)}
                    </span>
                    <span className="tier-log-subject">
                      {entry.subject || "（无主题）"}
                    </span>
                    <span className="tier-log-sender">{entry.sender}</span>
                  </div>
                ))
              ) : (
                <p>暂无归档记录</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
      {confirmationDialog}
    </>
  );
}

export function ImportLocationSelect() {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [tier, setTier] = useState<TierInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      void call<TierInfo>("archive_tier_info")
        .then((value) => live && setTier(value))
        .catch(() => live && setTier(null));
    load();
    window.addEventListener("archive-tier-changed", load);
    return () => {
      live = false;
      window.removeEventListener("archive-tier-changed", load);
    };
  }, []);
  async function change(value: "internal" | "external") {
    if (value === "external" && !tier?.externalDir) {
      toast.error("请先设置外置存档目录");
      return;
    }
    const ok = await askConfirmation({
      title: value === "external" ? "改为外置导入？" : "改为内置导入？",
      description:
        value === "external"
          ? "之后导入的新邮件会直接写入外置存档目录。外置盘未连接时导入会失败；已有邮件不会自动迁移。"
          : "之后导入的新邮件会写入内置数据目录。已经在外置存档中的邮件不受影响。",
      action: value === "external" ? "使用外置" : "使用内置",
    });
    if (!ok || !tier) return;
    setBusy(true);
    try {
      const next = await call<TierInfo>("save_archive_tier_settings", {
        externalDir: tier.externalDir,
        retentionDays: tier.retentionDays,
        indexEnabled: tier.indexEnabled,
        importLocation: value,
      });
      setTier(next);
      window.dispatchEvent(new Event("archive-tier-changed"));
      toast.success(
        value === "external" ? "之后导入到外置存档" : "之后导入到内置存档",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-tool-inline">
      <SelectField
        aria-label="新邮件导入位置"
        value={tier?.importLocation ?? "internal"}
        disabled={busy || !tier}
        onValueChange={(value) => void change(value as "internal" | "external")}
      >
        <SelectOption value="internal">导入到内置存档</SelectOption>
        {!!tier?.externalDir && (
          <SelectOption value="external">导入到外置存档</SelectOption>
        )}
      </SelectField>
      <span className="text-sm text-muted-foreground">
        仅影响更改之后的邮件导入位置
      </span>
      {confirmationDialog}
    </div>
  );
}
