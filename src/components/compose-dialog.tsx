import { useConfirmation } from "@/hooks/use-confirmation";
import { MailContent } from "./mail-content";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field,
  FieldContent,
  FieldLabel,
} from "./ui/field";
import { signatureContent, greetingSpec } from "@/lib/signatures";
import type { MailSignature } from "@/lib/types";
import { disableFrameContextMenu } from "@/lib/context-menu";
import {
  mergeAttachmentPaths,
  attachmentPathsFromClipboard,
  attachmentSubject,
  insideComposeDrop,
} from "@/lib/compose-attachments";
import { ComposeAttachments } from "./compose-attachments";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Paperclip,
  Send,
  Check,
  LoaderCircle,
  ChevronUp,
  Clock3,
  Eye,
  Code2,
  FileUp,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { call, native, isDemo } from "@/lib/api";
import type {
  Account,
  Address,
  Compose,
  ForwardFile,
  Preferences,
} from "@/lib/types";
import {
  textToHtml,
  sanitizeComposeHtml,
  composeFormat,
  compileSource,
  hasDraftContent,
  prepareCompose,
  prepareEditorCompose,
  type ComposeFormat,
} from "@/lib/compose-format";
import { safeMailHtml } from "@/lib/mail-html";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
const RichEditor = lazy(() =>
  import("./rich-editor").then((m) => ({ default: m.RichEditor })),
);
import { RecipientInput } from "./recipient-input";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import { toast } from "sonner";
import { isImagePath, type BodyImage } from "@/lib/rich-body";
import type { RichEditorHandle } from "./rich-editor";
import { RichEditorBoundary } from "./rich-editor-boundary";

/** 写信窗口（浮动面板）的位置与尺寸，单位 px，相对视口左上角。 */
type ComposeGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};
const COMPOSE_MIN_WIDTH = 640;
const COMPOSE_MIN_HEIGHT = 420;
/** 写信窗口窄于此宽度时，工具条只留图标（媒体查询在窄视口下的兜底）。
 *  默认写信窗口 1100px 宽：实测工具条各控件在 1100px 与 1316px 下宽度完全一致、仍是单行，
 *  所以阈值放在默认宽度之下，保住「发送预览 / 导入文件」的文字标签。 */
const COMPOSE_NARROW_WIDTH = 1080;

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
function clampGeometry(next: ComposeGeometry): ComposeGeometry {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    Math.max(next.width, COMPOSE_MIN_WIDTH),
    viewportWidth - 16,
  );
  const height = Math.min(
    Math.max(next.height, COMPOSE_MIN_HEIGHT),
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
function isComposeControl(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest?.(
    "button, input, textarea, select, a, [role=button], [data-no-drag]",
  );
}

// 写信窗口/悬浮还原条上的标题：按草稿主题前缀区分回复与转发。
export function composeTitle(draft: Compose | null | undefined): string {
  if (draft?.subject.startsWith("Re:")) return "回复邮件";
  if (draft?.subject.startsWith("Fwd:")) return "转发邮件";
  return "写邮件";
}
export function ComposeDialog({
  draft,
  onClose,
  accounts,
  onSent,
  onBackground,
  stackIndex = 0,
  closeSignal,
  nativeWindow = false,
}: {
  draft: Compose | null;
  onClose: () => void;
  accounts: Account[];
  onSent: () => void;
  /** 收起写信窗口，倒计时期间在后台继续，撤回时回到草稿 */
  onBackground?: (draft: Compose, seconds: number) => void;
  /** 同屏第几个写信窗口：多个「继续写信」还原条错开，避免叠在一起 */
  stackIndex?: number;
  /** 外部（⌘W）请求关闭这封信：自增的序号，变化即触发关闭确认 */
  closeSignal?: number;
  /** 跑在系统原生窗口里（Rust 建的 compose-window-*）：窗口壳——拖动、八角缩放、
      自绘三灯、最大化/最小化——都归系统管，这里不再画，内容铺满整扇窗。 */
  nativeWindow?: boolean;
}) {
  const { askConfirmation, cancelConfirmation, confirmationDialog } =
    useConfirmation();
  const [value, setValue] = useState<Compose | null>(null),
    [saved, setSaved] = useState(false),
    [sending, setSending] = useState(false),
    [closing, setClosing] = useState(false),
    [bccOpen, setBccOpen] = useState<boolean | null>(null);
  const [closePrompt, setClosePrompt] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [signatureReload, setSignatureReload] = useState(0);
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  // 抄送默认就在版面上，密送点「密送」展开、再点「收起密送」收回去；
  // 初始为 null 表示跟随草稿（草稿本来有密送就直接显示）。
  const showBcc = bccOpen ?? !!value?.bcc.trim();
  const [deliveryPreview, setDeliveryPreview] = useState(false);
  // 发送倒计时秒数来自设置；未读到偏好时按 8 秒（历史默认值）
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const previewContent = useMemo(
    () => (deliveryPreview && value ? prepareCompose(value) : null),
    [deliveryPreview, value],
  );
  const [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState(true),
    [planning, setPlanning] = useState(false),
    [planTime, setPlanTime] = useState(localDateTime);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const closingNow = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const sourceFile = useRef<HTMLInputElement>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const dialogElement = useRef<HTMLDivElement>(null);
  // 浮动写信窗口：geometry 为 null 时保持默认居中布局，一旦拖动/缩放就切到显式定位。
  const [geometry, setGeometry] = useState<ComposeGeometry | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [narrowToolbar, setNarrowToolbar] = useState(false);
  const geometryRef = useRef<ComposeGeometry | null>(null);
  // 进行中的拖动/缩放。move/up 挂在 window 上（见下面的 effect），所以状态不放在触发元素上。
  const [gesture, setGesture] = useState<{
    kind: "drag" | "resize";
    dir?: string;
    x: number;
    y: number;
    base: ComposeGeometry;
  } | null>(null);
  const commitGeometry = useCallback((next: ComposeGeometry | null) => {
    geometryRef.current = next;
    setGeometry(next);
  }, []);
  // 居中布局下没有显式几何，拖动/缩放前先取一次基准。
  // 取 getBoundingClientRect()：居中已经不用 translate（见 index.css 里的居中方式），
  // 且写信窗口用 transform:none 关掉了入场缩放，所以 rect 就是真实的布局盒，
  // 不会像 computed style 那样把居中 margin 漏掉（left 恒为 0）。
  const measureGeometry = (): ComposeGeometry | null => {
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
    if (isComposeControl(event.target)) return;
    const base = geometryRef.current ?? measureGeometry();
    if (!base) return;
    const next = clampGeometry(base);
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
      const next = clampGeometry(base);
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
  // move/up 挂在 window 上：只挂元素上时指针一离开就断，手势收不了尾，
  // 之后再滑回标题区还会带着旧基准把窗口拽飞。
  // 注意：这里绝不能靠 event.buttons 判断「鼠标已松开」——WKWebView 里
  // pointermove/mousemove 的 buttons 恒为 0（实测 131 次移动全是 0），
  // 用它做守卫会把每一次拖动都在第一次 move 时取消，表现为「拖不动」。
  useEffect(() => {
    if (!gesture) return;
    const handleMove = (event: PointerEvent) => {
      const { base } = gesture;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.kind === "drag") {
        commitGeometry(
          clampGeometry({
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
      if (width < COMPOSE_MIN_WIDTH) {
        if (dir.includes("w"))
          left = base.left + base.width - COMPOSE_MIN_WIDTH;
        width = COMPOSE_MIN_WIDTH;
      }
      if (height < COMPOSE_MIN_HEIGHT) {
        if (dir.includes("n"))
          top = base.top + base.height - COMPOSE_MIN_HEIGHT;
        height = COMPOSE_MIN_HEIGHT;
      }
      commitGeometry(clampGeometry({ left, top, width, height }));
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
  // 最小化只收起窗口，不改最大化状态：从「继续写信」恢复要回到上一次的尺寸。
  const minimizeCompose = useCallback(() => {
    setMinimized(true);
  }, []);
  const toggleExpanded = () => {
    setMinimized(false);
    setExpanded((current) => !current);
  };
  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isComposeControl(event.target)) return;
    toggleExpanded();
  };
  // 点写信框以外的区域自动把窗口收成底部细条（用户要求：写信时要能腾出手看别的邮件）。
  // 这里自己挂 document 监听，不用 Radix 的 onInteractOutside——那个只负责「别关闭草稿」，
  // 而且在 jsdom 里不触发，单测覆盖不到。注册时机在打开它的那次 pointerdown 之后，不会自伤。
  useEffect(() => {
    // 原生窗口本身就是系统窗口，点窗口外不该把信收起来。
    if (
      nativeWindow ||
      !draft ||
      minimized ||
      sending ||
      closing ||
      closePrompt
    )
      return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      // 写信窗派生出来的 UI 不算「离开写信窗口」：
      // 窗口自己的字体/字号下拉、发送预览、右键菜单（role 判定），
      // 富文本工具条的提示气泡（tooltip），
      // 图片缩放 − % + 浮条（.rich-image-zoom，portal 到 body），
      // sonner 通知横幅，别的写信窗的「继续写信」还原条。
      // 后三样以前没进白名单：点一下缩放、点一下通知或还原条，正在写的信就被收起来。
      if (
        target.closest(
          '.rich-image-zoom, [data-sonner-toast], .compose-restore-bar, [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [role="tooltip"]',
        )
      )
        return;
      minimizeCompose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [
    draft,
    minimized,
    sending,
    closing,
    closePrompt,
    minimizeCompose,
    nativeWindow,
  ]);
  // 关闭这封信的请求来源：主窗口的原生 ⌘W（Rust 转成 closeSignal），
  // 以及能收键时的前端 ⌘W 兜底。都走同一个「保存 / 不保存 / 取消」确认。
  const requestCloseRef = useRef<() => void>(() => {});
  requestCloseRef.current = requestClose;
  const lastCloseSignal = useRef(closeSignal ?? 0);
  useEffect(() => {
    if (!closeSignal || closeSignal === lastCloseSignal.current) return;
    lastCloseSignal.current = closeSignal;
    requestCloseRef.current();
  }, [closeSignal]);
  useEffect(() => {
    if (!draft) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "w") return;
      event.preventDefault();
      requestCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft]);
  // 视口变化后把浮动窗口拉回可见范围（原生窗口由系统管，不参与）。
  useEffect(() => {
    if (nativeWindow) return;
    const handleViewportResize = () => {
      if (geometryRef.current)
        commitGeometry(clampGeometry(geometryRef.current));
    };
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [commitGeometry, nativeWindow]);
  // 工具条按「写信窗口自身宽度」而非视口决定是否只留图标，缩放后也能正确降级。
  useEffect(() => {
    const element = dialogElement.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setNarrowToolbar(entry.contentRect.width < COMPOSE_NARROW_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft?.id]);
  const [forwardError, setForwardError] = useState("");
  const [forwardLoading, setForwardLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const imageBusy = useRef(false);
  const richEditor = useRef<RichEditorHandle>(null);
  const [forwardReload, setForwardReload] = useState(0);
  const [sessionReload, setSessionReload] = useState(0);
  const sessionChain = useRef<Promise<void>>(Promise.resolve());
  const session = useRef<{ id: string; promise: Promise<string> } | null>(null);
  const interactionLocked = useRef(false);
  interactionLocked.current = sending || closing;
  // 写信窗口打开期间持有编辑会话 token：正文图片读取与原附件准备都以它为准。
  useEffect(() => {
    if (!draft?.id || !native || isDemo()) {
      session.current = null;
      return;
    }
    const id = draft.id;
    const promise = sessionChain.current.then(() =>
      call<string>("open_compose_session", { id }),
    );
    session.current = { id, promise };
    sessionChain.current = promise.then(
      () => {},
      () => {},
    );
    return () => {
      const close = promise.then((token) =>
        call<void>("close_compose_session", { id, token }),
      );
      sessionChain.current = close.catch(() => {});
    };
  }, [draft?.id, sessionReload]);
  // 转发打开后准备原附件副本：失败可重试，也可以选择不携带原附件。
  useEffect(() => {
    if (!value?.forwardSource || value.id !== draft?.id || !native || isDemo())
      return;
    const source = value.forwardSource,
      id = value.id,
      lease = session.current;
    if (!lease || lease.id !== id) return;
    let live = true;
    setForwardLoading(true);
    setForwardError("");
    void lease.promise
      .then((token) =>
        call<ForwardFile[]>("prepare_forward_files", { id, token, source }),
      )
      .then((files) => {
        if (!live || closingNow.current || latest.current?.id !== id) return;
        setForwardLoading(false);
        setValue((current) =>
          current?.id === id &&
          current.forwardSource?.hash === source.hash &&
          current.forwardSource.id === source.id
            ? {
                ...current,
                forwardSource: undefined,
                forwardFiles: [...(current.forwardFiles || []), ...files],
              }
            : current,
        );
      })
      .catch((error) => {
        if (live && latest.current?.id === id) {
          setForwardLoading(false);
          setForwardError(String(error));
        }
      });
    return () => {
      live = false;
    };
  }, [
    value?.id,
    value?.forwardSource?.id,
    value?.forwardSource?.hash,
    forwardReload,
    sessionReload,
    draft?.id,
  ]);
  // 从 Finder 拖拽文件到写信窗口：图片插入正文，其余登记为附件（Tauri 原生拖放，DOM drop 收不到）
  useEffect(() => {
    if (!draft?.id || !native || isDemo()) return;
    const id = draft.id;
    let live = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (
            !live ||
            event.payload.type !== "drop" ||
            latest.current?.id !== id ||
            closingNow.current ||
            interactionLocked.current ||
            isDemo()
          )
            return;
          const rect = dialogElement.current?.getBoundingClientRect();
          if (
            !rect ||
            !insideComposeDrop(
              event.payload.position,
              rect,
              window.devicePixelRatio,
            )
          )
            return;
          const paths = event.payload.paths;
          if (paths.some((path) => !path || path.includes("\0"))) {
            toast.error("附件路径无效，未添加文件");
            return;
          }
          const images = paths.filter(isImagePath);
          const embedded =
            images.length > 0 &&
            !!richEditor.current?.insertPaths(images, {
              x: event.payload.position.x / window.devicePixelRatio,
              y: event.payload.position.y / window.devicePixelRatio,
            });
          const attached = embedded
            ? paths.filter((path) => !isImagePath(path))
            : paths;
          if (!attached.length) return;
          setValue((current) => {
            if (current?.id !== id) return current;
            const attachments = mergeAttachmentPaths(
              current.attachments,
              attached,
            );
            return {
              ...current,
              attachments,
              subject: attachmentSubject(current.subject, attachments),
            };
          });
        }),
      )
      .then((stop) => {
        if (!live) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (live)
          toast.error(`拖拽附件未就绪，可使用附件按钮：${String(error)}`);
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [draft?.id]);
  useEffect(() => {
    if (previewFrame.current)
      return disableFrameContextMenu(previewFrame.current);
  }, [preview, value?.html, value?.format]);
  useEffect(() => {
    cancelConfirmation();
    closingNow.current = false;
    setClosing(false);
    setValue(draft);
    setSaved(false);
    setSignatureError("");
    setForwardError("");
    setForwardLoading(false);
    imageBusy.current = false;
    setImageLoading(false);
    setBccOpen(null);
    setExpanded(false);
    setGeometry(null);
    geometryRef.current = null;
    setMinimized(false);
    setNarrowToolbar(false);
    setPlanning(false);
    setDeliveryPreview(false);
    setPlanTime(localDateTime());
  }, [draft, cancelConfirmation]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    void call<Preferences>("get_preferences")
      .then((p) => {
        if (live) setCountdownSeconds(p.sendCountdownSeconds ?? 5);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft?.id]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    void call<Address[]>("contact_suggestions")
      .then((list) => {
        if (live) setSuggestions(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft?.id]);
  // 更换发件身份时重新读取该账号签名，草稿里仍冻结旧账号的快照。
  useEffect(() => {
    if (!value?.accountId || value.signature?.accountId === value.accountId)
      return;
    setSignatureError("");
    const accountId = value.accountId,
      id = value.id;
    let live = true;
    void call<MailSignature>("mail_signature", { accountId })
      .then((config) => {
        if (live)
          setValue((current) =>
            current?.id === id && current.accountId === accountId
              ? { ...current, signature: signatureContent(accountId, config) }
              : current,
          );
      })
      .catch((e) => {
        if (live) setSignatureError(String(e));
      });
    return () => {
      live = false;
    };
  }, [
    value?.id,
    value?.accountId,
    value?.signature?.accountId,
    signatureReload,
  ]);
  // 本封生效的签名预览：与正文下方展示、发送时附加的是同一份快照
  const signaturePreview = Boolean(
    value?.signature &&
    value.signature.accountId === value.accountId &&
    (value.signature.body || value.signature.html) &&
    value.signature.included,
  );
  // 问候语并入正文第一行（可编辑）：字体字号随签名设置；Markdown/HTML 由发送时拼接兜底
  const greeting = useMemo(
    () =>
      value?.signature?.included
        ? greetingSpec(value.signature.greeting, value.signature.greetingHtml)
        : null,
    [value?.signature],
  );
  function persist(action: () => Promise<void>) {
    const next = persistence.current.then(action);
    persistence.current = next.catch(() => {});
    return next;
  }
  useEffect(() => {
    if (!value || sending || closing) return;
    setSaved(false);
    if (!hasDraftContent(value)) return;
    const snapshot = value;
    const t = setTimeout(() => {
      void persist(async () => {
        if (closingNow.current || latest.current?.id !== snapshot.id) return;
        await call("save_draft", { draft: snapshot });
        if (latest.current === snapshot && !closingNow.current) setSaved(true);
      }).catch((e) => toast.error(String(e)));
    }, 600);
    autosaveTimer.current = t;
    return () => {
      clearTimeout(t);
      if (autosaveTimer.current === t) autosaveTimer.current = null;
    };
  }, [value, sending, closing]);
  function update(p: Partial<Compose>) {
    setValue((v) => (v ? { ...v, ...p } : null));
  }
  /** 关闭前的把关：有内容先问「保存 / 不保存 / 取消」，空白邮件直接舍弃。 */
  function requestClose() {
    if (sending || closingNow.current) return;
    if (imageBusy.current) {
      toast.info("正文图片正在读取，请稍后关闭");
      return;
    }
    const current = latest.current;
    if (!current || !hasDraftContent(current)) {
      void close();
      return;
    }
    setClosePrompt(true);
  }
  async function close(discard = false) {
    if (sending || closingNow.current) return;
    if (imageBusy.current) {
      toast.info("正文图片正在读取，请稍后关闭");
      return;
    }
    setClosePrompt(false);
    const current = latest.current;
    closingNow.current = true;
    setClosing(true);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      if (current)
        await persist(async () => {
          // 不保存 = 删掉自动存下的那份草稿；其余情况有内容就保存。
          if (!discard && hasDraftContent(current))
            await call("save_draft", { draft: current });
          else await call("delete_draft", { id: current.id });
        });
      const lease = session.current;
      if (native && !isDemo() && lease && current && lease.id === current.id) {
        const token = await lease.promise;
        await call("close_compose_session", { id: lease.id, token });
      }
      onClose();
    } catch (e) {
      toast.error(
        `${current && !hasDraftContent(current) ? "空白邮件舍弃" : "草稿保存"}失败：${e}`,
      );
    } finally {
      closingNow.current = false;
      setClosing(false);
    }
  }
  async function send() {
    const current = latest.current;
    if (!current || closingNow.current) return;
    setSending(true);
    try {
      await persistence.current;
      const result = await call<string>("send_mail", {
        draft: prepareCompose(current),
      });
      toast.success(result);
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  async function valid() {
    if (imageBusy.current) {
      toast.error("正文图片正在读取，请稍后发送");
      return false;
    }
    if (forwardLoading || value?.forwardSource) {
      toast.error("原附件尚未准备完成，请重试或选择不携带原附件");
      return false;
    }
    if (!value?.accountId || !value.to.trim()) {
      toast.error("请选择发件账号并填写收件人");
      return false;
    }
    if (value.signature?.accountId !== value.accountId) {
      toast.error(
        signatureError
          ? "签名读取失败，请重试或选择本封不使用签名"
          : "正在读取发件账号签名，请稍后发送",
      );
      return false;
    }
    for (const [name, addresses] of [
      ["收件人", value.to],
      ["抄送", value.cc],
      ["密送", value.bcc],
    ]) {
      if (
        addressTokens(addresses).filter(Boolean).length !==
        parseAddresses(addresses).length
      ) {
        toast.error(`${name}中存在无效的邮箱地址`);
        return false;
      }
    }
    if (
      !value.subject.trim() &&
      !(await askConfirmation({
        title: "邮件主题为空",
        description: "这封邮件没有主题，仍要继续发送或安排定时发送吗？",
        action: "继续",
      }))
    )
      return false;
    return true;
  }
  async function queue() {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    // 倒计时 0 = 立即发送，不收起窗口；否则收起窗口，倒计时在后台继续。
    if (!countdownSeconds) {
      await persistence.current;
      void send();
      return;
    }
    const current = latest.current;
    if (!current) return;
    await persist(async () => {
      if (hasDraftContent(current))
        await call("save_draft", { draft: current });
    });
    onBackground?.(current, countdownSeconds);
  }
  async function schedule(selectedTime = planTime) {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (e) {
      toast.error(String(e));
      return;
    }
    setSending(true);
    try {
      await persistence.current;
      await call("schedule_mail", {
        draft: prepareCompose(latest.current),
        scheduledAt,
      });
      toast.success(
        isDemo()
          ? "演示发送计划已保存，不会发送邮件"
          : "发送计划已保存，可在发送记录中修改或取消",
      );
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSending(false);
    }
  }
  function changeFormat(format: ComposeFormat) {
    if (!value) return;
    const prepared = prepareEditorCompose(value);
    if (format === "rich")
      update({
        format,
        body: prepared.body,
        html: prepared.html || textToHtml(prepared.body),
        source: "",
      });
    else if (format === "markdown" || format === "html") {
      const source =
        format === "html"
          ? prepared.html || textToHtml(prepared.body)
          : prepared.body;
      update({ format, source, ...compileSource(source, format) });
    }
  }
  async function importSource(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("正文文件超过 10 MB，请精简后导入");
      const source = await file.text();
      const format = /\.html?$/i.test(file.name) ? "html" : "markdown";
      update({ format, source, ...compileSource(source, format) });
      toast.success(`已导入 ${file.name}`);
    } catch (e) {
      toast.error(String(e));
    }
  }
  const format = value ? composeFormat(value) : "rich";
  const hasContent = !!value && hasDraftContent(value);
  const composeLabel = composeTitle(draft);
  async function attach() {
    if (!native || isDemo()) {
      toast.info("请在桌面客户端中添加真实附件");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({ multiple: true, directory: false });
    if (paths) {
      const attachments = mergeAttachmentPaths(
        value?.attachments || [],
        Array.isArray(paths) ? paths : [paths],
      );
      update({
        attachments,
        subject: attachmentSubject(value?.subject || "", attachments),
      });
    }
  }
  // 富文本模式下并入编辑器工具条；Markdown/HTML 模式下回到正文上方的格式栏
  const formatControls = value ? (
    <>
      <SelectField
        aria-label="正文格式"
        value={format}
        onValueChange={(value) => changeFormat(value as ComposeFormat)}
      >
        <SelectOption value="rich">富文本</SelectOption>
        <SelectOption value="markdown">Markdown</SelectOption>
        <SelectOption value="html">HTML 源码</SelectOption>
      </SelectField>
      {value.quote && (
        <Label
          htmlFor={`include-original-${value.id}`}
          className="compose-quote-toggle"
        >
          <Switch
            id={`include-original-${value.id}`}
            checked={value.quote.included}
            disabled={sending || closing}
            onCheckedChange={(included) =>
              update({ quote: { ...value.quote!, included } })
            }
          />
          包含原文
        </Label>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title="发送预览"
        onClick={() => setDeliveryPreview(true)}
      >
        <Eye size={14} />
        <span className="extras-label">发送预览</span>
      </Button>
      {(format === "markdown" || format === "html") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPreview(!preview)}
        >
          <Eye size={14} />
          {preview ? "收起预览" : "预览正文"}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title="导入文件"
        onClick={() => sourceFile.current?.click()}
      >
        <FileUp size={14} />
        <span className="extras-label">导入文件</span>
      </Button>
      <Input
        ref={sourceFile}
        type="file"
        accept=".html,.htm,.md,.markdown"
        className="sr-only"
        aria-label="导入正文文件"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importSource(file);
        }}
      />
    </>
  ) : null;
  return (
    <Dialog
      modal={false}
      open={!!draft}
      onOpenChange={(v) => {
        if (!v) requestClose();
      }}
    >
      {/* DialogContent 自带 translate-x/y-[-50%] 居中；写信窗口改成 left/right + margin:auto
          居中（见 index.css），这两个类必须一起顶掉，否则窗口会整体偏半个身位。 */}
      <DialogContent
        ref={dialogElement}
        overlay={false}
        className={`compose-dialog translate-x-0 translate-y-0${
          nativeWindow
            ? " compose-native"
            : `${expanded ? " compose-expanded" : ""}${
                !expanded && geometry ? " compose-floating" : ""
              }${minimized ? " compose-minimized" : ""}`
        }${narrowToolbar ? " compose-narrow" : ""}`}
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
        onEscapeKeyDown={(e) => {
          // 最小化时窗口已经让开，Esc 不该把别处的操作误当成关闭草稿。
          if (sending || closing || minimized) e.preventDefault();
          else if (expanded) {
            e.preventDefault();
            setExpanded(false);
          } else {
            // 关闭也走「保存 / 不保存 / 取消」，与红点 ×、⌘W 一致。
            e.preventDefault();
            requestClose();
          }
        }}
      >
        {!nativeWindow &&
          !expanded &&
          (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((dir) => (
            <div
              key={dir}
              className="compose-resize-handle"
              data-dir={dir}
              onPointerDown={beginResize(dir)}
            />
          ))}
        <DialogHeader
          onPointerDown={nativeWindow ? undefined : beginDrag}
          onDoubleClick={nativeWindow ? undefined : handleHeaderDoubleClick}
        >
          <div className="compose-heading">
            {!nativeWindow && (
              <div className="compose-lights">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="compose-light compose-light-close"
                  aria-label={hasContent ? "保存草稿并关闭" : "舍弃空白邮件"}
                  disabled={sending || closing}
                  onClick={requestClose}
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
                  aria-label="最小化写信窗口"
                  onClick={minimizeCompose}
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
                  aria-label={expanded ? "还原写信窗口" : "最大化写信窗口"}
                  onClick={toggleExpanded}
                >
                  {/* 主窗口（原生 macOS 三灯）的素材：绿灯是两块对角三角，
                    最大化时朝外、还原时朝内。 */}
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
            )}
            <DialogTitle>{composeLabel}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            有内容的邮件会自动保存草稿，空白邮件关闭时直接舍弃。
          </DialogDescription>
        </DialogHeader>
        {value && (
          <>
            <fieldset disabled={sending || closing}>
              <div className="compose-row">
                <Label>发件人</Label>
                <SelectField
                  value={value.accountId}
                  onValueChange={(value) => update({ accountId: value })}
                >
                  <SelectOption value="" disabled>
                    选择发件账号
                  </SelectOption>
                  {accounts
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <SelectOption key={a.id} value={a.id}>
                        {a.name} &lt;{a.email}&gt;
                      </SelectOption>
                    ))}
                </SelectField>
              </div>
              <div className="compose-row">
                <Label htmlFor="to">收件人</Label>
                <RecipientInput
                  id="to"
                  autoFocus
                  value={value.to}
                  onChange={(to) => update({ to })}
                  suggestions={suggestions}
                />
              </div>
              <div className="compose-row">
                <Label htmlFor="cc">抄送</Label>
                <RecipientInput
                  id="cc"
                  value={value.cc}
                  onChange={(cc) => update({ cc })}
                  suggestions={suggestions}
                />
                {showBcc ? (
                  <Button
                    variant="ghost"
                    type="button"
                    className="text-link"
                    onClick={() => setBccOpen(false)}
                  >
                    收起密送
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    type="button"
                    className="text-link"
                    onClick={() => setBccOpen(true)}
                  >
                    密送
                  </Button>
                )}
              </div>
              {showBcc && (
                <div className="compose-row">
                  <Label htmlFor="bcc">密送</Label>
                  <RecipientInput
                    id="bcc"
                    value={value.bcc}
                    onChange={(bcc) => update({ bcc })}
                    suggestions={suggestions}
                  />
                </div>
              )}
              <div className="compose-row">
                <Label htmlFor="subject">主题</Label>
                <Input
                  id="subject"
                  value={value.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="给这封邮件一个主题"
                  onPaste={(event) => {
                    // 在主题栏 ⌘V 复制的文件：登记成附件，主题栏保持空白
                    // （主题为空时用附件名兜底）。剪贴板里没有可粘贴的文本时
                    // 才走系统剪贴板，免得把普通文本粘贴也吞掉。
                    const paths = attachmentPathsFromClipboard(
                      event.clipboardData,
                    );
                    if (paths.length) {
                      event.preventDefault();
                      const attachments = mergeAttachmentPaths(
                        value.attachments,
                        paths,
                      );
                      update({
                        attachments,
                        subject: attachmentSubject(value.subject, attachments),
                      });
                      return;
                    }
                    const clipboard = event.clipboardData;
                    const plain = clipboard?.getData("text/plain") ?? "";
                    const markup = clipboard?.getData("text/html") ?? "";
                    if (
                      native &&
                      !isDemo() &&
                      !plain.trim() &&
                      !markup.trim()
                    ) {
                      event.preventDefault();
                      void call<string[]>("pasteboard_file_paths")
                        .then((found) => {
                          if (!found.length) return;
                          const attachments = mergeAttachmentPaths(
                            latest.current?.attachments || value.attachments,
                            found,
                          );
                          update({
                            attachments,
                            subject: attachmentSubject(
                              latest.current?.subject ?? value.subject,
                              attachments,
                            ),
                          });
                        })
                        .catch(() => {});
                    }
                  }}
                />
              </div>
              {format !== "rich" && (
                <div className="compose-format">
                  <span>正文</span>
                  {formatControls}
                </div>
              )}
              <div
                className={`compose-editor ${(format === "markdown" || format === "html") && preview ? "source-with-preview" : ""} ${signaturePreview ? "with-signature" : ""}`}
              >
                {format === "rich" ? (
                  <RichEditorBoundary key={value.id}>
                    <Suspense
                      fallback={
                        <div className="editor-loading">
                          <LoaderCircle className="animate-spin" size={18} />
                          正在加载编辑器…
                        </div>
                      }
                    >
                      <RichEditor
                        ref={richEditor}
                        key={`${value.id}-${format}`}
                        body={value.body}
                        html={value.html || textToHtml(value.body)}
                        disabled={sending || closing}
                        onChange={(body, html) => update({ body, html })}
                        onBusy={(busy) => {
                          imageBusy.current = busy;
                          setImageLoading(busy);
                        }}
                        readImages={async (paths) => {
                          const id = value.id;
                          const lease = session.current;
                          if (
                            !native ||
                            isDemo() ||
                            !lease ||
                            lease.id !== id ||
                            interactionLocked.current
                          )
                            throw new Error(
                              "正文图片只能在当前桌面写信窗口读取",
                            );
                          const token = await lease.promise;
                          if (
                            latest.current?.id !== id ||
                            closingNow.current ||
                            interactionLocked.current
                          )
                            throw new Error("写信窗口已关闭或提交");
                          return call<BodyImage[]>("read_body_images", {
                            id,
                            token,
                            paths,
                          });
                        }}
                        toolbarExtras={formatControls}
                        greeting={greeting}
                        onAttachFiles={(paths) => {
                          const attachments = mergeAttachmentPaths(
                            latest.current?.attachments || value.attachments,
                            paths,
                          );
                          update({
                            attachments,
                            subject: attachmentSubject(
                              latest.current?.subject ?? value.subject,
                              attachments,
                            ),
                          });
                        }}
                      />
                    </Suspense>
                  </RichEditorBoundary>
                ) : format === "markdown" || format === "html" ? (
                  <>
                    <Textarea
                      className="compose-body compose-source"
                      aria-label={
                        format === "markdown" ? "Markdown 源码" : "HTML 源码"
                      }
                      spellCheck={false}
                      placeholder={
                        format === "markdown"
                          ? "# 标题\n\n支持 **加粗**、列表、链接和表格…"
                          : "粘贴完整 HTML 文档或片段…"
                      }
                      value={value.source ?? ""}
                      onChange={(e) =>
                        update({
                          source: e.target.value,
                          ...compileSource(e.target.value, format),
                        })
                      }
                    />
                    {preview && (
                      <div
                        className="compose-preview"
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <div>
                          <Code2 size={13} />
                          正文预览
                        </div>
                        <iframe
                          ref={previewFrame}
                          title="写信正文预览"
                          sandbox="allow-same-origin"
                          referrerPolicy="no-referrer"
                          srcDoc={safeMailHtml(
                            value.html || textToHtml(value.body),
                          )}
                        />
                      </div>
                    )}
                  </>
                ) : null}
              </div>
              {signatureError && (
                <Alert variant="destructive" className="mx-6 w-auto">
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-destructive">
                      无法读取签名：{signatureError}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSignatureReload((v) => v + 1)}
                    >
                      重新读取签名
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSignatureError("");
                        update({
                          signature: {
                            accountId: value.accountId,
                            included: false,
                            greeting: "",
                            greetingHtml: "",
                            body: "",
                            html: "",
                          },
                        });
                      }}
                    >
                      本封不使用签名
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {signaturePreview && (
                <section className="px-6 pt-0 pb-2 compose-preview-flush">
                  {/* 与问候语同源：不用 iframe，直接作为编辑器下方的一部分渲染，
                      继承写信窗口的背景与文字色，观感与正文连续。 */}
                  <div
                    className="compose-signature-preview"
                    aria-label="本封邮件签名"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeComposeHtml(
                        value.signature!.html ||
                          textToHtml(value.signature!.body),
                      ),
                    }}
                  />
                </section>
              )}
              {value.quote?.included && (
                <section
                  className="compose-quoted-original"
                  aria-label="引用的原邮件"
                >
                  <div className="compose-quote-heading">
                    原文 · {value.quote.subject}
                  </div>
                  <MailContent
                    html={value.quote.html || textToHtml(value.quote.body)}
                    title="引用原文"
                    onOpenLink={() => {}}
                  />
                </section>
              )}
              {value.forwardSource && (
                <Alert
                  variant={forwardError ? "destructive" : "default"}
                  className="mx-4 w-auto"
                >
                  {forwardError ? (
                    <AlertCircle />
                  ) : (
                    <FileUp className="animate-pulse" />
                  )}
                  <AlertTitle>
                    {forwardLoading
                      ? "正在准备原邮件附件，暂时不能发送"
                      : forwardError
                        ? "原附件准备失败，暂时不能发送"
                        : "等待准备原邮件附件，暂时不能发送"}
                  </AlertTitle>
                  <AlertDescription>
                    {forwardLoading
                      ? "附件副本正在后台读取，原件保持不变。准备完成后会自动继续。"
                      : forwardError ||
                        "可以重试准备，或选择不携带原附件直接发送。"}
                    <div className="flex flex-wrap gap-2">
                      {!forwardLoading && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSessionReload((n) => n + 1);
                            setForwardReload((n) => n + 1);
                          }}
                        >
                          重试准备
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={sending || closing}
                        onClick={() => {
                          update({ forwardSource: undefined });
                          setForwardError("");
                          setForwardLoading(false);
                        }}
                      >
                        不携带原附件
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {!!value.forwardFiles?.length && (
                <FieldSet className="min-w-0 shrink-0 px-7 py-3">
                  <FieldLegend>原邮件附件</FieldLegend>
                  <FieldGroup>
                    {value.forwardFiles.map((file) => (
                      <Field key={file.id} orientation="horizontal">
                        <Checkbox
                          id={`forward-file-${file.id}`}
                          checked={file.included}
                          disabled={sending || closing}
                          onCheckedChange={(included) =>
                            update({
                              forwardFiles: value.forwardFiles!.map((item) =>
                                item.id === file.id
                                  ? { ...item, included: included === true }
                                  : item,
                              ),
                            })
                          }
                        />
                        <FieldContent className="min-w-0">
                          <FieldLabel
                            className="max-w-full break-words"
                            htmlFor={`forward-file-${file.id}`}
                          >
                            {file.name} · {file.size} 字节
                          </FieldLabel>
                        </FieldContent>
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
              )}
              {value.attachments.length > 0 && (
                <ComposeAttachments
                  paths={value.attachments}
                  onRemove={(index) =>
                    update({
                      attachments: value.attachments.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                />
              )}
            </fieldset>
            {planning && (
              <SchedulePicker
                value={planTime}
                onChange={setPlanTime}
                onConfirm={(time) => void schedule(time)}
                onCancel={() => setPlanning(false)}
                busy={sending || closing}
              />
            )}
            <div className="compose-footer">
              <Button
                disabled={
                  sending ||
                  closing ||
                  forwardLoading ||
                  imageLoading ||
                  !!value.forwardSource ||
                  isDemo() ||
                  !native
                }
                onClick={() => void queue()}
              >
                {sending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Send size={16} />
                )}{" "}
                {sending
                  ? "发送中…"
                  : countdownSeconds
                    ? "发送邮件"
                    : "立即发送"}
              </Button>
              <Button
                variant="outline"
                disabled={
                  sending ||
                  closing ||
                  forwardLoading ||
                  imageLoading ||
                  !!value.forwardSource ||
                  (!native && !isDemo())
                }
                onClick={() => setPlanning(!planning)}
              >
                <Clock3 size={16} />
                定时发送
              </Button>
              {value.signature &&
                value.signature.accountId === value.accountId &&
                (value.signature.body || value.signature.html) && (
                  <Label
                    htmlFor={`include-signature-${value.id}`}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap"
                  >
                    <Switch
                      id={`include-signature-${value.id}`}
                      checked={value.signature.included}
                      disabled={sending || closing}
                      onCheckedChange={(included) =>
                        update({
                          signature: { ...value.signature!, included },
                        })
                      }
                    />
                    附加邮件签名
                  </Label>
                )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void attach()}
                disabled={sending || closing}
                title="添加附件"
              >
                <Paperclip size={18} />
              </Button>
              <span>
                {hasContent && saved && <Check size={13} />}{" "}
                {closing
                  ? "正在关闭…"
                  : !hasContent
                    ? "空白邮件不会保存"
                    : saved
                      ? "草稿已保存"
                      : "正在保存草稿…"}
              </span>
              {isDemo() && <small>演示模式不会发送邮件</small>}
            </div>
          </>
        )}
      </DialogContent>
      {minimized && value && (
        <div
          className="compose-restore-bar"
          style={
            {
              "--compose-bar-lift": `${stackIndex * 52}px`,
            } as React.CSSProperties
          }
        >
          <span className="compose-restore-label">
            {composeLabel}
            {value.subject.trim() ? ` · ${value.subject.trim()}` : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMinimized(false)}
          >
            <ChevronUp size={14} />
            继续写信
          </Button>
        </div>
      )}
      <Dialog
        open={deliveryPreview && !!value}
        onOpenChange={setDeliveryPreview}
      >
        <DialogContent className="delivery-preview-dialog">
          <DialogHeader>
            <DialogTitle>发送效果预览</DialogTitle>
            <DialogDescription className="sr-only">
              发送正文预览，包含当前选择的原文。
            </DialogDescription>
          </DialogHeader>
          <div className="delivery-preview-body">
            {previewContent && (
              <MailContent
                title="发送效果预览正文"
                html={
                  previewContent.deliveryHtml ||
                  textToHtml(previewContent.deliveryBody || "")
                }
                onOpenLink={() => {}}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
      <AlertDialog open={closePrompt} onOpenChange={setClosePrompt}>
        <AlertDialogContent className="compose-close-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>保存这封邮件的草稿？</AlertDialogTitle>
            <AlertDialogDescription>
              邮件已经自动保存到草稿箱。选择「不保存」会删除这份草稿。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={closing}
              onClick={() => void close(true)}
            >
              不保存
            </Button>
            <AlertDialogAction
              disabled={closing}
              onClick={() => void close(false)}
            >
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
