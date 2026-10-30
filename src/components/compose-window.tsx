// 独立写信窗口（Rust 侧创建的 WebviewWindow，label 形如 compose-window-N）。
// 和主窗口共用同一份前端产物：main.tsx 按窗口 label 决定渲染 App 还是这个组件。
// 这扇窗是真正的系统窗口（原生标题栏 + 系统三灯），所以 ComposeDialog 用 nativeWindow
// 模式渲染：只画写信表单，拖动/缩放/最大化/最小化/⌘W 全交给系统。
// 草稿本身由主窗口拼好（回复/转发/签名/账号都在那边算），这里按 label 反查，
// 发送/定时/存草稿的结果发事件回主窗口（刷新列表、倒计时撤回都在那边）。
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { ComposeDialog } from "./compose-dialog";
import { disableNativeContextMenu } from "../lib/context-menu";
import type { Account, Compose } from "../lib/types";

interface ComposeWindowPayload {
  draft: Compose;
  accounts: Account[];
}

export function ComposeWindow({ label }: { label: string }) {
  const [draft, setDraft] = useState<Compose | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [closeSignal, setCloseSignal] = useState(0);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const night = localStorage.getItem("mail-theme") === "dark";
    setDark(night);
    document.documentElement.classList.toggle("dark", night);
    return disableNativeContextMenu(document);
  }, []);

  // 这扇窗编辑哪封草稿由 Rust 按 label 登记，窗口自己反查（不走 URL，避免编码问题）。
  useEffect(() => {
    let live = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<ComposeWindowPayload | null>("compose_window_draft", {
          label,
        }).then((payload) => {
          if (!live) return;
          if (payload?.draft) {
            setDraft(payload.draft);
            setAccounts(payload.accounts ?? []);
          } else {
            setError("这扇窗口没有对应的草稿");
          }
        }),
      )
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [label]);

  // ⌘W / 红灯：Rust 把窗口关闭请求拦下来转成事件，走「保存 / 不保存 / 取消」确认。
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        // 事件名与主窗口收到的 compose-close-requested 刻意分开：不带 options 的
        // listen 目标为 Any，会给「发给别的窗口」的同名事件也触发（回环）。
        listen("compose-window-close", () => setCloseSignal((n) => n + 1)),
      )
      .then((fn) => {
        if (live) stop = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  // 关掉这扇窗由 Rust 负责（它同时清掉 label 登记，主窗口才知道「没在写信了」）。
  async function closeWindow() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("close_compose_window", { label });
    } catch (e) {
      toast.error(String(e));
    }
  }

  function tellMain(event: string, payload?: unknown) {
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("main", event, payload))
      .catch((e) => toast.error(String(e)));
  }

  return (
    <>
      <Toaster
        position="bottom-center"
        theme={dark ? "dark" : "light"}
        richColors
        closeButton
      />
      {error ? (
        <div className="compose-window-error">
          <div role="alert" className="turn-error">
            写信窗口打不开：{error}
          </div>
        </div>
      ) : (
        <ComposeDialog
          nativeWindow
          draft={draft}
          accounts={accounts}
          closeSignal={closeSignal}
          onClose={() => void closeWindow()}
          onSent={() => tellMain("compose-changed")}
          onBackground={(value, seconds) => {
            // 倒计时发送：主窗口收起倒计时条并负责撤回，这扇窗跟着关掉。
            tellMain("compose-background", { draft: value, seconds });
            void closeWindow();
          }}
        />
      )}
    </>
  );
}
