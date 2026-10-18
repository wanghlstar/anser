import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChevronUp,
  Forward,
  Reply,
  ReplyAll,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { MailBodySkeleton } from "./mail-skeleton";
import { MailContent } from "./mail-content";
import { MailAttachments } from "./mail-attachments";
import { ScrollPane } from "./scroll-pane";
import { call } from "../lib/api";
import { mailTime } from "../lib/conversations";
import { senderAddress, senderName } from "../lib/providers";
import type { Detail, Mail } from "../lib/types";

/**
 * 浮动阅读窗口：收件列表双击 / 右键「在新窗口打开」时弹出，参考 Foxmail 的独立阅读窗。
 *
 * 窗口外壳（非模态 Dialog + CSS 自定义属性定位 + 标题栏拖动 + 八角缩放 + 三灯 + 最小化还原条）
 * 刻意复用写信窗口那套已验证的实现：类名同为 compose-* 系列、几何变量同为 --compose-*。
 * 那是本项目「浮动窗口外壳」的既有实现（装机验收过），这里只加 .mail-window 覆盖默认尺寸与
 * 内部排版，避免把拖动/缩放/居中这三处踩过坑的逻辑复制第二份。
 *
 * 与写信窗口的关键差别：**点窗口外面不自动收起** —— 用户要的是「再去点列表里的别的邮件，
 * 这个窗口原样留在原位」，所以这里不挂「点外面自动最小化」的 document 监听。
 */
type MailGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};
const MAIL_MIN_WIDTH = 640;
const MAIL_MIN_HEIGHT = 420;

/** 抓住指针：拖到窗口外再松手也能收到 pointerup 正常收尾。
 *  jsdom 等环境没有指针捕获，失败就退回 window 上的监听。 */
function capturePointer(event: React.PointerEvent<HTMLElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    /* 环境不支持指针捕获 */
  }
}

/** 把窗口收敛到「不小于最小尺寸、且完整留在视口内」，避免拖到屏幕外找不回来。 */
function clampMailGeometry(next: MailGeometry): MailGeometry {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    Math.max(next.width, MAIL_MIN_WIDTH),
    viewportWidth - 16,
  );
  const height = Math.min(
    Math.max(next.height, MAIL_MIN_HEIGHT),
    viewportHeight - 16,
  );
  return {
    width,
    height,
    left: Math.min(
      Math.max(next.left, 8),
      Math.max(8, viewportWidth - width - 8),
    ),
    top: Math.min(
      Math.max(next.top, 8),
      Math.max(8, viewportHeight - height - 8),
    ),
  };
}

/** 点到这些控件上时视为普通点击，不触发拖动/双击最大化。 */
function isWindowControl(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest?.(
    "button, input, textarea, select, a, [role=button], [data-no-drag]",
  );
}

/** 第二个及以后的新窗口按阶梯错开，避免多封阅读窗叠在同一个位置。 */
function cascadeGeometry(index: number): MailGeometry {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const titlebar = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--window-titlebar-height",
    ),
  );
  const width = Math.min(Math.max(viewportWidth - 360, MAIL_MIN_WIDTH), 980);
  const height = Math.min(
    Math.max(
      viewportHeight - (Number.isFinite(titlebar) ? titlebar : 38) - 240,
      MAIL_MIN_HEIGHT,
    ),
    720,
  );
  return clampMailGeometry({
    left: (viewportWidth - width) / 2 + index * 28,
    top: (viewportHeight - height) / 2 + index * 20,
    width,
    height,
  });
}

export function MailWindow({
  mail,
  demo,
  stackIndex = 0,
  onClose,
  onReply,
  onExport,
  onAttachment,
  onLink,
}: {
  mail: Mail;
  demo: boolean;
  /** 同屏第几个阅读窗：错开位置与还原条 */
  stackIndex?: number;
  onClose: () => void;
  onReply: (detail: Detail, forward?: boolean, all?: boolean) => void;
  onExport: (mail: Mail) => void;
  onAttachment: (mail: Mail, index: number, name: string) => Promise<void>;
  onLink: (href: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    void call<Detail>("mail_detail", { id: mail.id })
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [mail.id, mail.hash, retry]);

  // 浮动窗口几何：null 时用 .mail-window 的默认居中尺寸，一旦拖动/缩放就切到显式定位。
  const [geometry, setGeometry] = useState<MailGeometry | null>(() =>
    stackIndex > 0 ? cascadeGeometry(stackIndex) : null,
  );
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const dialogElement = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<MailGeometry | null>(null);
  // 进行中的拖动/缩放。move/up 挂在 window 上（见下面的 effect），所以状态不放在触发元素上。
  const [gesture, setGesture] = useState<{
    kind: "drag" | "resize";
    dir?: string;
    x: number;
    y: number;
    base: MailGeometry;
  } | null>(null);
  const commitGeometry = useCallback((next: MailGeometry | null) => {
    geometryRef.current = next;
    setGeometry(next);
  }, []);
  // 居中布局下没有显式几何，拖动/缩放前先取一次基准。
  // 取 getBoundingClientRect()：居中不用 translate（见 index.css），且外壳用 transform:none
  // 关掉了入场缩放，所以 rect 就是真实的布局盒。
  const measureGeometry = (): MailGeometry | null => {
    const element = dialogElement.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || expanded || minimized || gesture) return;
    if (isWindowControl(event.target)) return;
    const base = geometryRef.current ?? measureGeometry();
    if (!base) return;
    const next = clampMailGeometry(base);
    commitGeometry(next);
    capturePointer(event);
    setGesture({
      kind: "drag",
      x: event.clientX,
      y: event.clientY,
      base: next,
    });
    event.preventDefault();
  };
  const beginResize =
    (dir: string) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || expanded || minimized || gesture) return;
      const base = geometryRef.current ?? measureGeometry();
      if (!base) return;
      const next = clampMailGeometry(base);
      commitGeometry(next);
      capturePointer(event);
      setGesture({
        kind: "resize",
        dir,
        x: event.clientX,
        y: event.clientY,
        base: next,
      });
      event.preventDefault();
    };
  // move/up 挂在 window 上：只挂元素上时指针一离开就断，手势收不了尾。
  // 也绝不能靠 event.buttons 判断「鼠标已松开」——WKWebView 里它恒为 0（见 RULES 关键发现 21）。
  useEffect(() => {
    if (!gesture) return;
    const handleMove = (event: PointerEvent) => {
      const { base } = gesture;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.kind === "drag") {
        commitGeometry(
          clampMailGeometry({
            left: base.left + dx,
            top: base.top + dy,
            width: base.width,
            height: base.height,
          }),
        );
        return;
      }
      const dir = gesture.dir ?? "";
      let { left, top, width, height } = base;
      if (dir.includes("e")) width = base.width + dx;
      if (dir.includes("w")) {
        width = base.width - dx;
        left = base.left + dx;
      }
      if (dir.includes("s")) height = base.height + dy;
      if (dir.includes("n")) {
        height = base.height - dy;
        top = base.top + dy;
      }
      // 顶到最小尺寸时，向「西/北」缩放要反向补偿，避免窗口被推着跑。
      if (width < MAIL_MIN_WIDTH) {
        if (dir.includes("w")) left = base.left + base.width - MAIL_MIN_WIDTH;
        width = MAIL_MIN_WIDTH;
      }
      if (height < MAIL_MIN_HEIGHT) {
        if (dir.includes("n")) top = base.top + base.height - MAIL_MIN_HEIGHT;
        height = MAIL_MIN_HEIGHT;
      }
      commitGeometry(clampMailGeometry({ left, top, width, height }));
    };
    const finishGesture = () => setGesture(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finishGesture);
    window.addEventListener("pointercancel", finishGesture);
    // pointerup 丢失时（指针在窗口外松开）mouseup 兜底收尾。
    window.addEventListener("mouseup", finishGesture);
    window.addEventListener("blur", finishGesture);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finishGesture);
      window.removeEventListener("pointercancel", finishGesture);
      window.removeEventListener("mouseup", finishGesture);
      window.removeEventListener("blur", finishGesture);
    };
  }, [gesture, commitGeometry]);
  const toggleExpanded = () => {
    setMinimized(false);
    setExpanded((current) => !current);
  };
  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isWindowControl(event.target)) return;
    toggleExpanded();
  };
  // 视口变化后把浮动窗口拉回可见范围。
  useEffect(() => {
    const handleViewportResize = () => {
      if (geometryRef.current)
        commitGeometry(clampMailGeometry(geometryRef.current));
    };
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [commitGeometry]);

  const title = mail.subject.trim() || "无主题";
  return (
    <Dialog
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={dialogElement}
        overlay={false}
        className={`compose-dialog mail-window translate-x-0 translate-y-0${
          expanded ? " compose-expanded" : ""
        }${!expanded && geometry ? " compose-floating" : ""}${
          minimized ? " compose-minimized" : ""
        }`}
        style={
          !expanded && geometry
            ? ({
                "--compose-left": `${geometry.left}px`,
                "--compose-top": `${geometry.top}px`,
                "--compose-width": `${geometry.width}px`,
                "--compose-height": `${geometry.height}px`,
              } as React.CSSProperties)
            : undefined
        }
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        // Esc 留给写信窗口（有草稿要确认）；阅读窗口用红点或还原条关闭，避免多窗口互相误关。
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {!expanded &&
          (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((dir) => (
            <div
              key={dir}
              className="compose-resize-handle"
              data-dir={dir}
              onPointerDown={beginResize(dir)}
            />
          ))}
        <DialogHeader
          onPointerDown={beginDrag}
          onDoubleClick={handleHeaderDoubleClick}
        >
          <div className="compose-heading">
            <div className="compose-lights">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="compose-light compose-light-close"
                aria-label="关闭阅读窗口"
                onClick={onClose}
              >
                <svg
                  viewBox="0 0 12 12"
                  width={12}
                  height={12}
                  aria-hidden="true"
                >
                  <path
                    d="M4.2 4.2 7.8 7.8M7.8 4.2 4.2 7.8"
                    stroke="currentColor"
                    strokeWidth={1.15}
                    strokeLinecap="round"
                  />
                </svg>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="compose-light compose-light-min"
                aria-label="最小化阅读窗口"
                onClick={() => setMinimized(true)}
              >
                <svg
                  viewBox="0 0 12 12"
                  width={12}
                  height={12}
                  aria-hidden="true"
                >
                  <path
                    d="M3.4 6H8.6"
                    stroke="currentColor"
                    strokeWidth={1.15}
                    strokeLinecap="round"
                  />
                </svg>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="compose-light compose-light-zoom"
                aria-label={expanded ? "还原阅读窗口" : "最大化阅读窗口"}
                onClick={toggleExpanded}
              >
                <svg
                  viewBox="0 0 12 12"
                  width={12}
                  height={12}
                  aria-hidden="true"
                >
                  {expanded ? (
                    <path
                      d="M3.3 3.3V7L7 3.3ZM8.7 8.7V5L5 8.7Z"
                      fill="currentColor"
                    />
                  ) : (
                    <path
                      d="M8.7 3.3V7L5 3.3ZM3.3 8.7V5L7 8.7Z"
                      fill="currentColor"
                    />
                  )}
                </svg>
              </Button>
            </div>
            <DialogTitle className="mail-window-title" title={title}>
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            在新窗口阅读这封邮件，可拖动标题栏移动、拖动边角缩放。
          </DialogDescription>
        </DialogHeader>
        <div className="mail-window-toolbar">
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => detail && onReply(detail)}
          >
            <Reply size={14} />
            回复
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => detail && onReply(detail, false, true)}
          >
            <ReplyAll size={14} />
            全部回复
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!detail}
            onClick={() => detail && onReply(detail, true)}
          >
            <Forward size={14} />
            转发
          </Button>
          <span className="mail-window-toolbar-spacer" />
          <Button variant="ghost" size="sm" onClick={() => onExport(mail)}>
            <ArrowDownToLine size={14} />
            导出原始邮件
          </Button>
        </div>
        <div className="mail-window-byline">
          <strong>{senderName(mail.sender)}</strong>
          <span className="mail-window-address" title={mail.sender}>
            {senderAddress(mail.sender)}
          </span>
          <time dateTime={mail.date}>{mailTime(mail.date)}</time>
        </div>
        {mail.recipients.trim() && (
          <div className="mail-window-recipients" title={mail.recipients}>
            收件人：{mail.recipients}
          </div>
        )}
        <div className="sb-host">
          <ScrollPane className="reader-scroll">
            {detail ? (
              <>
                {detail.html ? (
                  <MailContent
                    html={detail.html}
                    title={`邮件正文：${mail.id}`}
                    onOpenLink={onLink}
                  />
                ) : (
                  <div className="message-body">{detail.mail.body}</div>
                )}
                <MailAttachments
                  mailId={mail.id}
                  demo={demo}
                  attachments={detail.attachments}
                  onDownload={(index, name) => onAttachment(mail, index, name)}
                />
              </>
            ) : error ? (
              <div role="alert" className="turn-error">
                正文加载失败
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  重新加载
                </Button>
                <p>{error}</p>
              </div>
            ) : (
              <MailBodySkeleton />
            )}
          </ScrollPane>
        </div>
      </DialogContent>
      {minimized && (
        <div
          className="compose-restore-bar"
          style={
            {
              "--compose-bar-lift": `${stackIndex * 52}px`,
            } as React.CSSProperties
          }
        >
          <span className="compose-restore-label">阅读 · {title}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMinimized(false)}
          >
            <ChevronUp size={14} />
            继续阅读
          </Button>
        </div>
      )}
    </Dialog>
  );
}
