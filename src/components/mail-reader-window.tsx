// 独立阅读窗口（Rust 侧创建的 WebviewWindow，label 形如 mail-window-N）。
// 和主窗口共用同一份前端产物：main.tsx 按窗口 label 决定渲染 App 还是这个组件。
// 窗口是真正的系统窗口（原生标题栏），所以这里只管内容；回复/转发/导出/附件保存
// 一律发事件交给主窗口处理（写信窗口、保存对话框都在那边，只有一份实现）。
import { useEffect, useState } from "react";
import { ArrowDownToLine, Reply, ReplyAll, Send } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "./ui/button";
import { MailAttachments } from "./mail-attachments";
import { MailRecipientLine } from "./mail-recipient-line";
import { MailContent } from "./mail-content";
import { MailBodySkeleton } from "./mail-skeleton";
import { ScrollPane } from "./scroll-pane";
import { call, isDemo } from "../lib/api";
import { disableNativeContextMenu } from "../lib/context-menu";
import { mailTime } from "../lib/conversations";
import { mailLink } from "../lib/mail-html";
import { parseAddresses } from "../lib/addresses";
import type { Detail } from "../lib/types";

export function MailReaderWindow({ label }: { label: string }) {
  const [mailId, setMailId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dark, setDark] = useState(false);
  const demo = isDemo();

  useEffect(() => {
    const night = localStorage.getItem("mail-theme") === "dark";
    setDark(night);
    document.documentElement.classList.toggle("dark", night);
    return disableNativeContextMenu(document);
  }, []);

  // 这扇窗显示哪封邮件由 Rust 按 label 登记，窗口自己反查（不走 URL，避免编码问题）。
  useEffect(() => {
    let live = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<string | null>("mail_window_mail", { label }).then((id) => {
          if (!live) return;
          if (id) setMailId(id);
          else setError("这扇窗口没有对应的邮件");
        }),
      )
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [label]);

  useEffect(() => {
    if (!mailId) return;
    let live = true;
    setError("");
    void call<Detail>("mail_detail", { id: mailId })
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((e) => {
        if (live) {
          setDetail(null);
          setError(String(e));
        }
      });
    return () => {
      live = false;
    };
  }, [mailId, retry]);

  function forward(action: string, extra: Record<string, unknown> = {}) {
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) =>
        emitTo("main", "mail-window-action", { action, id: mailId, ...extra }),
      )
      .catch((e) => toast.error(String(e)));
  }

  async function openLink(href: string) {
    const url = mailLink(href);
    if (!url) return;
    // mailto 要开写信窗口，写信窗口只在主窗口里，交给那边处理。
    if (url.protocol === "mailto:") {
      forward("link", { href });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_mail_link", { url: url.href });
    } catch (e) {
      toast.error(String(e));
    }
  }

  const mail = detail?.mail;
  const title = mail?.subject?.trim() ? mail.subject : "无主题";
  const sender = mail ? (parseAddresses(mail.sender)[0] ?? null) : null;
  return (
    <div className="mail-reader">
      <Toaster
        position="bottom-center"
        theme={dark ? "dark" : "light"}
        richColors
        closeButton
      />
      <header className="mail-reader-head">
        <div className="mail-reader-title" title={`主题：${title}`}>
          {title}
        </div>
        <div className="mail-reader-toolbar">
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => forward("reply")}
          >
            <Reply />
            回复
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => forward("reply-all")}
          >
            <ReplyAll />
            全部回复
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => forward("forward")}
          >
            <Send />
            转发
          </Button>
          <span className="mail-reader-toolbar-spacer" />
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => forward("export")}
          >
            <ArrowDownToLine />
            导出原始邮件
          </Button>
        </div>
        {mail && (
          <>
            <div className="mail-reader-byline">
              <strong>{sender?.name || sender?.email || mail.sender}</strong>
              {sender?.name && (
                <span className="mail-reader-address">{sender.email}</span>
              )}
            </div>
            <MailRecipientLine
              mail={mail}
              detail={detail}
              meta={<time dateTime={mail.date}>{mailTime(mail.date)}</time>}
            />
          </>
        )}
      </header>
      <ScrollPane className="reader-scroll">
        {detail ? (
          <>
            {detail.html ? (
              <MailContent html={detail.html} onOpenLink={openLink} />
            ) : (
              // 演示模式没有真实 MIME 正文，回落到纯文本，保证窗口里能读到内容。
              <div className="message-body">{detail.mail.body}</div>
            )}
            <MailAttachments
              mailId={detail.mail.id}
              demo={demo}
              attachments={detail.attachments}
              onDownload={async (index, name) =>
                forward("attachment", { index, name })
              }
            />
          </>
        ) : error ? (
          <div role="alert" className="turn-error">
            正文加载失败：{error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetry((n) => n + 1)}
            >
              重新加载
            </Button>
          </div>
        ) : (
          <MailBodySkeleton />
        )}
      </ScrollPane>
    </div>
  );
}
