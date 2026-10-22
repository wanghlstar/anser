import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  CalendarPlus,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Send,
  ShieldCheck,
  SquarePen,
  Star,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { MailBodySkeleton } from "./mail-skeleton";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { MailContent } from "./mail-content";
import { MailAttachments } from "./mail-attachments";
import { ScrollArea } from "./ui/scroll-area";
import { call, newDraft } from "../lib/api";
import { parseAddresses, replyRecipients } from "../lib/addresses";
import { mailTime, prefixedSubject, replyHeaders } from "../lib/conversations";
import {
  meetingKey,
  meetingNotes,
  meetingProviderLabel,
  meetingTimeLabel,
  parseMeeting,
} from "../lib/meeting";
import { senderName, senderAddress } from "../lib/providers";
import type { Account, Compose, Detail, Mail } from "../lib/types";

function ParseWarnings({ mail }: { mail: Mail }) {
  if (!mail.parseWarnings?.length) return null;
  return (
    <Alert className="mb-4">
      <AlertTitle>这封邮件的部分内容编码异常</AlertTitle>
      <AlertDescription>
        {mail.savedLocally !== false
          ? "完整原件已保存，其余内容正常显示。"
          : "服务器原件未修改，其余内容正常显示。"}
        {mail.parseWarnings.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function MeetingBanner({ mail }: { mail: Mail }) {
  const info = parseMeeting(mail.body || "");
  const ignoreKey = `yanxin-meeting-ignored:${mail.id}`;
  const [ignored, setIgnored] = useState(
    () => localStorage.getItem(ignoreKey) === "1",
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!info || ignored) return null;
  const label = meetingProviderLabel(info.provider);

  async function addToCalendar() {
    setSaving(true);
    try {
      await call("save_meeting_event", {
        event: {
          id: "",
          title: mail.subject.trim() || label,
          start: info!.start,
          end: info!.end,
          allDay: false,
          location: "",
          notes: meetingNotes(
            info!,
            `${senderName(mail.sender)} <${senderAddress(mail.sender)}>`,
            mail.date,
          ),
          color: info!.provider === "tencent" ? "blue" : "green",
          reminderMinutes: 15,
          repeat: "none",
          createdAt: "",
          updatedAt: "",
          sourceMailId: mail.id,
          meetingUrl: info!.url,
          meetingCode: info!.code,
          meetingProvider: info!.provider,
        },
      });
      setSaved(true);
      toast.success("已添加到日历", {
        description: meetingTimeLabel(info!),
      });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setSaving(false);
    }
  }

  function ignore() {
    localStorage.setItem(ignoreKey, "1");
    setIgnored(true);
  }

  return (
    <Card className="meeting-banner" data-meeting-key={meetingKey(info)}>
      <Video className="meeting-banner-icon" aria-hidden="true" />
      <div className="meeting-banner-main">
        <strong>检测到{label}</strong>
        <span>{meetingTimeLabel(info)}</span>
        <small>
          {info.code ? `会议号 ${info.code}` : ""}
          {info.code && info.url ? " · " : ""}
          {info.url ? "可直接入会" : ""}
        </small>
      </div>
      <div className="meeting-banner-actions">
        {saved ? (
          <span className="meeting-banner-saved">已添加到日历</span>
        ) : (
          <Button
            size="sm"
            disabled={saving}
            onClick={() => void addToCalendar()}
          >
            <CalendarPlus />
            {saving ? "添加中…" : "添加到日历"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={ignore}>
          忽略
        </Button>
      </div>
    </Card>
  );
}

function Turn({
  mail,
  selected,
  own,
  demo,
  onReply,
  onExport,
  onAttachment,
  onAction,
  onLink,
  onInteract,
  onLoaded,
}: {
  mail: Mail;
  selected: Detail | null;
  own: boolean;
  demo: boolean;
  onReply: (detail: Detail, forward?: boolean, all?: boolean) => void;
  onExport: (mail: Mail) => void;
  onAttachment: (mail: Mail, index: number, name: string) => Promise<void>;
  onAction: (mail: Mail, action: string, value: string) => void;
  onLink: (href: string) => void;
  onInteract?: () => void;
  onLoaded: (detail: Detail) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(selected);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    if (selected) {
      setDetail(selected);
      onLoaded(selected);
    } else
      void call<Detail>("mail_detail", { id: mail.id })
        .then((d) => {
          if (live) {
            setDetail(d);
            onLoaded(d);
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [
    mail.id,
    mail.hash,
    selected?.mail.id,
    selected?.mail.hash,
    retry,
    onLoaded,
  ]);
  return (
    <article
      className={`conversation-turn ${own ? "outgoing" : "incoming"}`}
      data-mail-id={mail.id}
      aria-label={`${own ? "我发出的邮件" : "收到的邮件"}：${mail.subject}`}
    >
      <div className="turn-byline">
        <span className="sender-avatar" aria-hidden="true">
          {own ? "我" : senderName(mail.sender).slice(0, 1)}
        </span>
        <div className="turn-sender">
          <strong>{own ? "我" : senderName(mail.sender)}</strong>
          <span title={mail.sender}>{senderAddress(mail.sender)}</span>
        </div>
        <time dateTime={mail.date}>{mailTime(mail.date)}</time>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`邮件操作：${mail.subject}`}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail)}
              >
                <Reply size={14} />
                回复这封邮件
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail, false, true)}
              >
                <ReplyAll size={14} />
                全部回复
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail, true)}
              >
                <Send size={14} />
                转发
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {mail.savedLocally === false && (
                <DropdownMenuItem onClick={() => onAction(mail, "save", "")}>
                  <ArrowDownToLine />
                  完整保存到本地
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onExport(mail)}>
                <ArrowDownToLine size={14} />
                导出原始邮件
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAction(mail, "star", String(!mail.starred))}
              >
                <Star size={14} />
                {mail.starred ? "取消星标" : "星标"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction(mail, "trash", String(!mail.trashed))}
              >
                <Trash2 size={14} />
                {mail.trashed ? "恢复邮件" : "移到本地废纸篓"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Card className={`conversation-bubble ${detail?.html ? "has-html" : ""}`}>
        {mail.recipients.trim() && (
          <div className="turn-recipients" title={mail.recipients}>
            收件人：{mail.recipients}
          </div>
        )}
        {detail && <ParseWarnings mail={detail.mail} />}
        {!detail ? (
          error ? (
            <div role="alert" className="turn-error">
              正文加载失败
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
          )
        ) : detail.html ? (
          <MailContent
            html={detail.html}
            title={`邮件正文：${mail.id}`}
            onOpenLink={onLink}
            onInteract={onInteract}
          />
        ) : (
          <div className="message-body">{detail.mail.body}</div>
        )}
        <MailAttachments
          mailId={mail.id}
          demo={demo}
          attachments={detail?.attachments || []}
          onDownload={(index, name) => onAttachment(mail, index, name)}
        />
        <div className="turn-footer">
          <ShieldCheck size={12} />
          <span>
            {demo
              ? "演示存档"
              : mail.savedLocally === false
                ? "服务器邮件"
                : "已保存"}
          </span>
          {mail.starred && <Star size={12} className="star-on" />}
        </div>
      </Card>
    </article>
  );
}

function QuickReply({
  target,
  accounts,
  onEdit,
  onSent,
  onEditing,
}: {
  target: Detail;
  accounts: Account[];
  onEdit: (draft: Compose) => void;
  onSent: () => void;
  onEditing: (value: boolean) => void;
}) {
  const account = accounts.find(
    (a) => a.id === target.mail.accountId && a.enabled,
  );
  const [draft, setDraft] = useState<Compose | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const persisted = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    let live = true;
    setReady(false);
    setDraft(null);
    if (!account) return;
    const recipients = replyRecipients(
      target,
      [target.mail.accountEmail, ...accounts.map((a) => a.email)],
      false,
      account.email,
    );
    void call<Compose[]>("list_drafts")
      .then((list) => {
        if (!live) return;
        const existing = list.find(
          (d) =>
            d.replyAnchorId === target.mail.id && d.accountId === account.id,
        );
        persisted.current = !!existing;
        setDraft(
          existing || {
            ...newDraft(account.id),
            replyAnchorId: target.mail.id,
            ...replyHeaders(target.mail),
            ...recipients,
            subject: prefixedSubject(target.mail.subject),
          },
        );
        setReady(true);
      })
      .catch((e) => {
        if (live) toast.error(`回复草稿读取失败：${e}`);
      });
    return () => {
      live = false;
    };
  }, [target.mail.id, account?.id]);
  useEffect(() => {
    if (
      !ready ||
      !draft ||
      sending ||
      (!draft.body.trim() && !persisted.current)
    )
      return;
    setSaving(true);
    setSaveError(false);
    const timer = setTimeout(() => {
      void call("save_draft", { draft })
        .then(() => setSaving(false))
        .catch((e) => {
          setSaving(false);
          setSaveError(true);
          toast.error(`草稿保存失败：${e}`);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, ready, sending]);
  // Flush the latest body on navigation; draft identity is per reply target.
  useEffect(
    () => () => {
      const current = latest.current;
      if (current && (current.body.trim() || persisted.current))
        void call("save_draft", { draft: current }).catch((e) =>
          toast.error(`草稿保存失败：${e}`),
        );
    },
    [],
  );
  useEffect(() => {
    onEditing(
      !!draft &&
        (!!draft.body.trim() || !!draft.html || !!draft.attachments.length),
    );
    return () => onEditing(false);
  }, [draft?.body, draft?.html, draft?.attachments.length, onEditing]);
  async function send() {
    if (!draft || !draft.body.trim() || sending) return;
    setSending(true);
    try {
      await call("save_draft", { draft });
      const result = await call<string>("send_mail", { draft });
      // A new draft ID prevents a subsequent reply reusing a completed send.
      latest.current = null;
      persisted.current = false;
      setDraft({
        ...newDraft(draft.accountId),
        replyAnchorId: target.mail.id,
        ...replyHeaders(target.mail),
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
      });
      toast.success(result);
      onSent();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void send();
      return;
    }
    const timer = setTimeout(
      () => setCountdown((n) => (n === null ? n : n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [countdown]);
  const complex =
    !!draft &&
    (!!draft.html ||
      !!draft.deliveryHtml ||
      !!draft.attachments.length ||
      !!draft.quote?.included ||
      (draft.format && draft.format !== "plain"));
  if (complex)
    return (
      <div className="conversation-reply quick-rich-draft">
        <span>已有回复草稿 · 保留原格式和附件</span>
        <Button
          size="sm"
          disabled={sending}
          onClick={() => {
            latest.current = null;
            onEdit(draft);
          }}
        >
          <SquarePen size={14} />
          继续编辑回复
        </Button>
      </div>
    );
  return (
    <div className="conversation-reply">
      {account ? (
        <>
          <div className="quick-reply-heading">
            <span>
              回复给{" "}
              <strong>{draft?.to || senderName(target.mail.sender)}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || sending || countdown !== null}
              onClick={() => {
                if (draft) {
                  latest.current = null;
                  onEdit(draft);
                }
              }}
            >
              <SquarePen size={14} />
              完整编辑
            </Button>
          </div>
          <Textarea
            aria-label="对话回复正文"
            placeholder="写下回复…"
            value={draft?.body || ""}
            disabled={!ready || sending || countdown !== null}
            onChange={(e) => {
              persisted.current = true;
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      body: e.target.value,
                      deliveryBody: undefined,
                      deliveryHtml: undefined,
                    }
                  : d,
              );
            }}
          />
          <div className="quick-reply-actions">
            <span>
              {sending
                ? "正在发送…"
                : countdown !== null
                  ? `${countdown} 秒后发送`
                  : saving
                    ? "正在保存草稿…"
                    : saveError
                      ? "草稿保存失败"
                      : draft?.body.trim()
                        ? "草稿已保存"
                        : "以邮件发送"}
            </span>
            <Button
              size="sm"
              disabled={
                !ready || !draft?.body.trim() || !draft.to.trim() || sending
              }
              onClick={() => setCountdown(countdown === null ? 8 : null)}
            >
              <Send size={14} />
              {countdown === null ? "发送回复" : `取消发送（${countdown}秒）`}
            </Button>
          </div>
        </>
      ) : (
        <span>原账号已暂停或移除，启用账号后可回复。</span>
      )}
    </div>
  );
}

export function ConversationReader({
  selected,
  singleMessage = false,
  revision,
  accounts,
  demo,
  scrollRef,
  editorOpen,
  onReply,
  onEdit,
  onSent,
  onExport,
  onAttachment,
  onAction,
  onLink,
  onInteract,
}: {
  selected: Detail;
  singleMessage?: boolean;
  revision: Mail[];
  accounts: Account[];
  demo: boolean;
  editorOpen: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onReply: (detail: Detail, forward?: boolean, all?: boolean) => void;
  onEdit: (draft: Compose) => void;
  onSent: () => void;
  onExport: (mail: Mail) => void;
  onAttachment: (mail: Mail, index: number, name: string) => Promise<void>;
  onAction: (mail: Mail, action: string, value: string) => void;
  onLink: (href: string) => void;
  onInteract?: () => void;
}) {
  const [messages, setMessages] = useState<Mail[]>([selected.mail]);
  const [details, setDetails] = useState<Record<string, Detail>>({
    [selected.mail.id]: selected,
  });
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [newBelow, setNewBelow] = useState(false);
  const [replying, setReplying] = useState(false);
  const replyTarget = useRef("");
  const stream = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchoring = useRef(true);
  const automaticScrollTop = useRef(0);
  const newest = useRef("");
  const loaded = useCallback(
    (detail: Detail) =>
      setDetails((d) =>
        d[detail.mail.id] === detail ? d : { ...d, [detail.mail.id]: detail },
      ),
    [],
  );
  const bottom = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTo(0, scroll.scrollHeight);
    anchoring.current = false;
    automaticScrollTop.current = scroll?.scrollTop || 0;
    pinned.current = true;
    setNewBelow(false);
  }, [scrollRef]);
  useEffect(() => {
    let live = true;
    if (singleMessage) {
      setMessages([selected.mail]);
      setError("");
      return;
    }
    void call<Mail[]>("mail_conversation", { id: selected.mail.id })
      .then((list) => {
        if (!live) return;
        setMessages(list);
        setError("");
        if (
          newest.current &&
          newest.current !== list.at(-1)?.id &&
          !pinned.current
        )
          setNewBelow(true);
        newest.current = list.at(-1)?.id || "";
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [selected.mail.id, revision, retry, singleMessage]);
  useEffect(() => {
    const scroll = scrollRef.current,
      content = stream.current;
    if (!scroll || !content) return;
    const root = scroll.closest('[data-slot="scroll-area"]') ?? scroll;
    const changed = () => {
      if (anchoring.current) {
        const turn = [
          ...content.querySelectorAll<HTMLElement>("[data-mail-id]"),
        ].find((element) => element.dataset.mailId === selected.mail.id);
        if (!turn) return;
        scroll.scrollTop +=
          turn.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        pinned.current = false;
      } else if (pinned.current) {
        scroll.scrollTo(0, scroll.scrollHeight);
      }
      automaticScrollTop.current = scroll.scrollTop;
    };
    const scrolled = () => {
      if (anchoring.current) return;
      if (Math.abs(scroll.scrollTop - automaticScrollTop.current) < 2) return;
      pinned.current =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 96;
      if (pinned.current) setNewBelow(false);
    };
    const interact = () => {
      anchoring.current = false;
    };
    const key = (event: Event) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes((event as KeyboardEvent).key)
      )
        interact();
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(changed);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    scroll.addEventListener("scroll", scrolled);
    root.addEventListener("wheel", interact, { passive: true, capture: true });
    root.addEventListener("touchstart", interact, {
      passive: true,
      capture: true,
    });
    root.addEventListener("pointerdown", interact, true);
    root.addEventListener("keydown", key, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", scrolled);
      root.removeEventListener("wheel", interact, true);
      root.removeEventListener("touchstart", interact, true);
      root.removeEventListener("pointerdown", interact, true);
      root.removeEventListener("keydown", key, true);
    };
  }, [scrollRef, messages, selected.mail.id]);
  const own = (mail: Mail) =>
    parseAddresses(mail.sender).some(
      (a) =>
        a.email.toLowerCase() === mail.accountEmail.toLowerCase() ||
        accounts.some(
          (account) => account.email.toLowerCase() === a.email.toLowerCase(),
        ),
    );
  const target =
    [...messages].reverse().find((m) => !own(m)) || messages.at(-1);
  if (!replying || !messages.some((mail) => mail.id === replyTarget.current))
    replyTarget.current = target?.id || "";
  const targetDetail = details[replyTarget.current];
  if (
    singleMessage ||
    (messages.length === 1 &&
      (selected.mail.conversationCount || 1) === 1 &&
      !selected.mail.inReplyTo?.length &&
      !selected.mail.references?.length)
  ) {
    return (
      <ScrollArea
        className="reader-scroll reader-scroll-area"
        type="always"
        viewportRef={scrollRef}
        viewportProps={{ id: "mail-reader-content" } as ComponentProps<"div">}
      >
        <div className="reader-scroll-content">
          <ParseWarnings mail={selected.mail} />
          <MeetingBanner mail={selected.mail} />
          {selected.html ? (
            <MailContent
              html={selected.html}
              onOpenLink={onLink}
              onInteract={onInteract}
            />
          ) : (
            <div className="message-body">{selected.mail.body}</div>
          )}
          <MailAttachments
            mailId={selected.mail.id}
            demo={demo}
            attachments={selected.attachments}
            onDownload={(index, name) =>
              onAttachment(selected.mail, index, name)
            }
          />
        </div>
      </ScrollArea>
    );
  }
  return (
    <>
      <ScrollArea
        className="reader-scroll reader-scroll-area conversation-scroll"
        type="always"
        viewportRef={scrollRef}
        viewportProps={{ id: "mail-reader-content" } as ComponentProps<"div">}
      >
        <div className="reader-scroll-content conversation-stream" ref={stream}>
          <MeetingBanner mail={selected.mail} />
          <div className="conversation-start">
            <Badge variant="secondary">{messages.length} 封邮件</Badge>
            <span>按时间排列</span>
          </div>
          {error && (
            <div role="alert" className="turn-error">
              对话加载失败
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                重新加载对话
              </Button>
            </div>
          )}
          {messages.map((mail) => (
            <Turn
              key={mail.id}
              mail={mail}
              selected={mail.id === selected.mail.id ? selected : null}
              own={own(mail)}
              demo={demo}
              onReply={onReply}
              onExport={onExport}
              onAttachment={onAttachment}
              onAction={onAction}
              onLink={onLink}
              onInteract={onInteract}
              onLoaded={loaded}
            />
          ))}
        </div>
      </ScrollArea>
      {newBelow && (
        <Button
          variant="secondary"
          size="sm"
          className="new-conversation-mail"
          onClick={bottom}
        >
          <ArrowDown size={14} />
          有新邮件 · 查看
        </Button>
      )}
      {targetDetail && !editorOpen && !selected.mail.trashed && (
        <QuickReply
          key={targetDetail.mail.id}
          target={targetDetail}
          accounts={accounts}
          onEdit={onEdit}
          onSent={onSent}
          onEditing={setReplying}
        />
      )}
    </>
  );
}
