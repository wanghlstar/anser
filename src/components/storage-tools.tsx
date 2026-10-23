import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  Clock3,
  HardDrive,
  LoaderCircle,
} from "lucide-react";
import { call, isDemo, native } from "@/lib/api";
import type {
  ArchiveHealth,
  Preferences,
  TierInfo,
  TierLog,
} from "@/lib/types";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { toast } from "sonner";

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

export function StorageTools() {
  const [preferences, setPreferences] = useState<Preferences>({
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
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
          {/* 三个下拉同行并排（含义看卡底说明），合并后的保存按钮靠右 */}
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

const ARCHIVE_HEALTH_KEY = "yanxin.archiveHealth";
function loadStoredHealth(): ArchiveHealth | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_HEALTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ArchiveHealth;
    if (
      !value ||
      typeof value.checked !== "number" ||
      typeof value.healthy !== "number" ||
      typeof value.checkedAt !== "string" ||
      !Array.isArray(value.problems)
    ) {
      return null;
    }
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

export function ArchiveTools() {
  const [tier, setTier] = useState<TierInfo | null>(null),
    [tierLog, setTierLog] = useState<TierLog | null>(null),
    [tierBusy, setTierBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [health, setHealth] = useState<ArchiveHealth | null>(loadStoredHealth);
  useEffect(() => {
    void call<TierInfo>("archive_tier_info")
      .then(setTier)
      .catch(() => setTier(null));
    void loadTierLog();
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
      await call("save_archive_tier_settings", {
        externalDir: picked,
        retentionDays: tier?.retentionDays ?? 30,
        indexEnabled: tier?.indexEnabled ?? true,
      });
      setTier(await call<TierInfo>("archive_tier_info"));
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
      });
      setTier(await call<TierInfo>("archive_tier_info"));
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
  async function check() {
    setChecking(true);
    try {
      const result = await call<ArchiveHealth>("archive_health");
      setHealth(result);
      storeHealth(result);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setChecking(false);
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
    <Card className="settings-tool">
      <div className="settings-tool-title">
        <HardDrive size={18} />
        <h3>存档校验</h3>
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
              ? `已归档 ${tierLog.total.toLocaleString("zh-CN")} 封`
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
            disabled={checking}
            onClick={() => void check()}
          >
            {checking && <LoaderCircle className="animate-spin" size={14} />}
            校验存档
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
        随盘生成 index.html 索引，任何机器用浏览器打开即可检索）。未带外置盘时：
        账户与近期邮件不受影响，打开旧邮件会提示连接外置盘。「校验存档」会核对本地原件与附件的完整性。
        {tier && tier.pending > 0 && (
          <>
            {" "}
            当前待归档 <strong>{tier.pending}</strong> 封。
          </>
        )}
        {tier?.externalDir && !tier.externalReachable && "（外置盘当前未连接）"}
      </p>
      <Separator className="settings-tool-divider" />
      <div className="settings-tool-row">
        <span className="text-sm">
          {health
            ? `校验 ${health.healthy} / ${health.checked} 封通过`
            : checking
              ? "正在校验原始邮件与附件…"
              : "尚未校验"}
        </span>
        {health && (
          <small className="settings-tool-note">
            {checking ? "正在重新校验；上次校验：" : "最近校验："}
            {new Date(health.checkedAt).toLocaleString("zh-CN", {
              hour12: false,
            })}
          </small>
        )}
      </div>
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
  );
}
