import { useConfirmation } from "./hooks/use-confirmation";
import { useNotificationMail } from "./hooks/use-notification-mail";
import {
  useAppUpdate,
  UpdateIndicator,
  UpdateSettings,
  UpdateDialog,
} from "./components/app-updates";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./components/ui/tooltip";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/ui/collapsible";
import { Skeleton } from "./components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { ServerDirectoryMenu } from "./components/server-directory-menu";
import {
  MoveToFolderMenu,
  type MoveTarget,
} from "./components/move-to-folder-menu";
import { MailActionTooltip } from "./components/mail-action-tooltip";
import { mailShortcut, mailShortcutKeys } from "./lib/mail-shortcuts";
import { FolderMappingDialog } from "./components/folder-mapping-dialog";
import { RetentionDialog } from "./components/retention-dialog";
import { MailSignatures } from "./components/mail-signatures";
import { InboxScope } from "./components/inbox-scope";
import { EmlViewer } from "./components/eml-viewer";
import { MailDateFilter } from "./components/mail-date-filter";
import { RemoteFolderList } from "./components/remote-folder-list";
import { remoteFolderLabel, compareFolders } from "./lib/remote-folders";
import { directorySource } from "./lib/server-destinations";
import { mailMenuKind } from "./lib/mail-menu";
import { coalesceRefresh } from "./lib/refresh-queue";
import { ConversationReader } from "./components/conversation-reader";
import { ScrollPane } from "./components/scroll-pane";
import { replyHeaders } from "./lib/conversations";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { disableNativeContextMenu } from "./lib/context-menu";
import { NavigationLayout, MailLayout } from "./components/resizable-layout";
import {
  MailListSkeleton,
  MailReaderSkeleton,
} from "./components/mail-skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  HardDriveDownload,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Forward,
  HardDrive,
  Inbox,
  Info,
  Mail as MailIcon,
  MailOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MessagesSquare,
  List,
  Paperclip,
  Plus,
  Printer,
  RefreshCw,
  Reply,
  ReplyAll,
  UsersRound,
  History,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  Star,
  Sun,
  Moon,
  Trash2,
  X,
  LogOut,
  ExternalLink,
  AlertCircle,
  Undo2,
} from "lucide-react";
import { Button } from "./components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "./components/ui/context-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Toaster, toast } from "sonner";
import { AccountDialog } from "./components/account-dialog";
import { RulesPanel } from "./components/rules-panel";
import { ComposeDialog } from "./components/compose-dialog";
import { PendingSend } from "./components/pending-send";
import { DraftsPanel } from "./components/drafts-panel";
import { ContactsPanel } from "./components/contacts-panel";
import { OutboxPanel } from "./components/outbox-panel";
import { StorageTools } from "./components/storage-tools";
import { DeleteArchiveDialog } from "./components/delete-archive-dialog";
import { RemoveAccountDialog } from "./components/remove-account-dialog";
import {
  replyRecipients,
  parseAddresses,
  formatAddress,
} from "./lib/addresses";
import {
  mailPage,
  mailNeighbor,
  call,
  initialSnapshot,
  native,
  enterDemo,
  leaveDemo,
  isDemo,
  restoreDemo,
  newDraft,
} from "./lib/api";
import {
  senderName,
  senderAddress,
  formatSize,
  providers,
} from "./lib/providers";
import type {
  MailPage,
  MailNeighbor,
  Query,
  Detail,
  Mail,
  Compose,
  Account,
  Address,
  RemoteFolder,
  DataDirInfo,
  DataDirCheck,
  Preferences,
  LocalArchiveGroup,
} from "./lib/types";
import { mailLink } from "./lib/mail-html";
import { printMail } from "./lib/mail-print";
import { invoke } from "@tauri-apps/api/core";
restoreDemo();
const viewNames: Record<string, string> = {
  all: "全部收件箱",
  unread: "未读邮件",
  starred: "星标邮件",
  sent: "已发送",
  trash: "本地废纸篓",
  local: "本地存档",
};
function time(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "时间未知";
  return d.toLocaleString("zh-CN", { hour12: false });
}
function friendlyError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("timed out") || text.includes("timeout"))
    return "连接超时，请检查网络，稍后将自动重试";
  if (text.includes("refused") || text.includes("connect error"))
    return "无法连接服务器，请检查网络或服务器地址";
  if (
    text.includes("dns") ||
    text.includes("resolve") ||
    text.includes("not known")
  )
    return "无法解析服务器地址，请检查网络";
  if (
    text.includes("auth") ||
    text.includes("login") ||
    text.includes("credential") ||
    text.includes("password")
  )
    return "登录失败，请检查账号或授权码";
  if (
    text.includes("tls") ||
    text.includes("ssl") ||
    text.includes("certificate")
  )
    return "安全连接失败，请检查端口与加密方式";
  return message;
}
function savedNavCollapsed(): boolean {
  try {
    return localStorage.getItem("mail-nav-collapsed") === "true";
  } catch {
    return false;
  }
}
function savedListMode(): "conversations" | "messages" {
  try {
    return localStorage.getItem("mail-list-mode") === "messages"
      ? "messages"
      : "conversations";
  } catch {
    return "conversations";
  }
}
function queryScope(query: Query) {
  return JSON.stringify({ ...query, limit: 0 });
}
export default function App() {
  const updates = useAppUpdate();
  const { askConfirmation, confirmationDialog } = useConfirmation();
  useEffect(() => disableNativeContextMenu(document), []);
  const [data, setData] = useState<MailPage>(() => ({
      ...initialSnapshot(),
      nextCursor: null,
      revision: 0,
      reset: false,
      bodyCoverage: { known: 0, unknown: 0 },
    })),
    [query, setQuery] = useState<Query>({
      view: "all",
      accountId: "",
      search: "",
      folder: "",
      limit: 200,
      unreadOnly: false,
      listMode: savedListMode(),
    }),
    [expandedAccounts, setExpandedAccounts] = useState<string[]>([]),
    [folderLoading, setFolderLoading] = useState<string[]>([]),
    [folderErrors, setFolderErrors] = useState<Record<string, string>>({}),
    [serverFolders, setServerFolders] = useState<RemoteFolder[]>([]),
    [page, setPage] = useState("mail"),
    [sidebarOpen, setSidebarOpen] = useState(true),
    [selected, setSelected] = useState(""),
    [readerExpanded, setReaderExpanded] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState<{
      id: string;
      message: string;
    } | null>(null),
    [detailRetry, setDetailRetry] = useState(0),
    [checked, setChecked] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [accountDialog, setAccountDialog] = useState(false),
    [editingAccount, setEditingAccount] = useState<Account | null>(null),
    [mappingAccount, setMappingAccount] = useState<Account | null>(null),
    [retentionAccount, setRetentionAccount] = useState<Account | null>(null),
    [removingAccount, setRemovingAccount] = useState<Account | null>(null),
    [retentionIntro, setRetentionIntro] = useState(false),
    [archiving, setArchiving] = useState(false),
    [contactSeed, setContactSeed] = useState<Address | null>(null),
    [draft, setDraft] = useState<Compose | null>(null),
    [drafts, setDrafts] = useState<Compose[]>([]),
    // 发送倒计时：写信窗口收起后仍走完，撤回后邮件回到草稿
    [pendingSend, setPendingSend] = useState<{
      draft: Compose;
      seconds: number;
    } | null>(null),
    [syncing, setSyncing] = useState(false),
    [syncText, setSyncText] = useState(""),
    [loading, setLoading] = useState(true),
    [demo, setDemo] = useState(isDemo()),
    [clearingDrafts, setClearingDrafts] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("mail-theme") === "dark");
  const searchRef = useRef<HTMLInputElement>(null),
    request = useRef(0),
    queryRef = useRef(query),
    readerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selected);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const readingNeighbors = useRef<{
    scope: string;
    previous: string[];
    next: string[];
    known: string[];
    date: string;
  } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const pagePending = useRef(false);
  const pageTicket = useRef(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [neighborHints, setNeighborHints] = useState<{
    id: string;
    scope: string;
    previous: boolean | null;
    next: boolean | null;
  } | null>(null);
  const neighborRequests = useRef<{
    id: string;
    scope: string;
    revision: number;
    previous?: Promise<MailNeighbor>;
    next?: Promise<MailNeighbor>;
  } | null>(null);
  const navigationRequest = useRef(0);
  const navigationPending = useRef(false);
  const shortcutMutationPending = useRef(false);
  const dataScope = useRef("");
  const [navigationLoading, setNavigationLoading] = useState(false);
  selectionRef.current = selected;
  const localChanges = useRef(new Map<string, Partial<Mail>>());
  const pendingDeletes = useRef(new Set<string>());
  queryRef.current = query;
  const [notificationToken, setNotificationToken] = useState<{
    token: string;
    click: number;
  } | null>(null);
  const notificationGeneration = useRef(0);
  const notificationReading = useRef("");
  const notificationContext = useRef({ page, search, draft, demo });
  notificationContext.current = { page, search, draft, demo };
  useNotificationMail(native && !demo, (token) => {
    const click = ++notificationGeneration.current;
    setNotificationToken({ token, click });
  });
  useEffect(() => {
    if (!notificationToken || draft || demo) return;
    let live = true;
    const ticket = ++notificationGeneration.current;
    const scope = queryRef.current;
    const reading = selectionRef.current;
    const context = notificationContext.current;
    void call<Mail>("notification_mail", { token: notificationToken.token })
      .then((mail) => {
        if (
          !live ||
          ticket !== notificationGeneration.current ||
          scope !== queryRef.current ||
          reading !== selectionRef.current ||
          context.page !== notificationContext.current.page ||
          context.search !== notificationContext.current.search ||
          context.draft !== notificationContext.current.draft ||
          context.demo !== notificationContext.current.demo
        )
          return;
        setSearch("");
        setChecked([]);
        setPage("mail");
        setQuery({
          view: mail.trashed
            ? "trash"
            : mail.savedLocally !== false
              ? "local"
              : "remote",
          accountId: mail.accountId,
          folder: "",
          remoteFolder: mail.savedLocally === false ? mail.sourceFolder : "",
          search: "",
          unreadOnly: false,
          limit: 200,
          listMode: queryRef.current.listMode,
        });
        notificationReading.current = mail.id;
        setSelected(mail.id);
        readingNeighbors.current = null;
        setDetailRetry((value) => value + 1);
      })
      .catch((error) => {
        if (live && ticket === notificationGeneration.current)
          toast.error(`无法打开通知邮件：${String(error)}`);
      })
      .finally(() => {
        if (live && ticket === notificationGeneration.current)
          setNotificationToken(null);
      });
    return () => {
      live = false;
    };
  }, [notificationToken, draft, demo]);
  const grouped = query.listMode !== "messages";
  useEffect(() => {
    try {
      localStorage.setItem("mail-list-mode", query.listMode || "conversations");
    } catch {
      // The current session remains usable when storage is unavailable.
    }
  }, [query.listMode]);
  useEffect(() => {
    if (data.remoteFolders) setServerFolders(data.remoteFolders);
  }, [data.remoteFolders]);
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null);
  const [archiveTree, setArchiveTree] = useState<LocalArchiveGroup[]>([]);
  // Shift 范围选择锚点
  const lastRowIndex = useRef(-1);
  // 服务器文件夹新建/删除对话框
  const [folderDialog, setFolderDialog] = useState<{
    accountId: string;
    mode: "create" | "delete";
    name?: string;
  } | null>(null);
  const [folderName, setFolderName] = useState("");
  // 本地存档树的账号组展开状态
  const [archiveOpen, setArchiveOpen] = useState<Record<string, boolean>>({});
  // 点"本地存档"整体隐藏/显示账号组；默认折叠，打开软件不展开下方账号
  const [archiveTreeHidden, setArchiveTreeHidden] = useState(true);
  // 侧栏主导航组（全部收件箱/星标邮件/已发送/草稿箱/发送记录）折叠状态
  const [navCollapsed, setNavCollapsed] = useState(savedNavCollapsed);
  useEffect(() => {
    void call<DataDirInfo>("data_dir_info")
      .then(setDataDir)
      .catch(() => setDataDir(null));
  }, []);
  // 侧边栏字号（偏好设置，应用到 CSS 变量）
  useEffect(() => {
    void call<Preferences>("get_preferences")
      .then((p) => {
        const scale = p.sidebarScale ?? 1;
        document.documentElement.style.setProperty(
          "--nav-scale",
          String(scale),
        );
      })
      .catch(() => {});
  }, []);
  // 本地存档树（按账号/服务器文件夹聚合）——跟随 refresh 同源刷新：
  // 服务器删信不改变 stats.saved/folderTotals，按它们触发会留下陈旧计数。
  const loadArchiveTree = useCallback(() => {
    void call<LocalArchiveGroup[]>("local_archive_tree")
      .then(setArchiveTree)
      .catch(() => setArchiveTree([]));
  }, []);
  useEffect(loadArchiveTree, [loadArchiveTree]);
  useEffect(() => {
    if (!selected || page !== "mail") setReaderExpanded(false);
  }, [selected, page]);
  useEffect(() => {
    if (!readerExpanded) return;
    const restore = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        setReaderExpanded(false);
      }
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, [readerExpanded]);
  async function openMailLink(href: string) {
    const url = mailLink(href);
    if (!url) return;
    if (url.protocol === "mailto:") {
      const next = newDraft(detail?.mail.accountId ?? "");
      next.to = decodeURIComponent(url.pathname);
      next.cc = url.searchParams.get("cc") ?? "";
      next.bcc = url.searchParams.get("bcc") ?? "";
      next.subject = url.searchParams.get("subject") ?? "";
      next.body = url.searchParams.get("body") ?? "";
      setDraft(next);
    } else if (native) {
      await invoke("open_mail_link", { url: url.href });
    } else {
      window.open(url.href, "_blank", "noopener,noreferrer");
    }
  }
  const openMailLinkRef = useRef(openMailLink);
  openMailLinkRef.current = openMailLink;
  const refreshAction = useRef<() => Promise<void>>(async () => {});
  refreshAction.current = async () => {
    const seq = ++request.current;
    const currentQuery = queryRef.current;
    try {
      const value = await mailPage({ ...currentQuery, limit: 200 });
      if (seq === request.current && currentQuery === queryRef.current) {
        const same =
          dataScope.current === queryScope(currentQuery) &&
          dataRef.current.revision === value.revision;
        const previous = dataRef.current;
        const merged =
          same && previous.messages.length > value.messages.length
            ? {
                ...value,
                messages: [
                  ...value.messages,
                  ...previous.messages.slice(value.messages.length),
                ],
                nextCursor: previous.nextCursor,
              }
            : value;
        dataScope.current = queryScope(currentQuery);
        dataRef.current = merged;
        setData(merged);
        // 存档树与列表同源刷新，侧栏计数与视图/徽标永不脱节。
        loadArchiveTree();
      }
      const reading = selectionRef.current;
      if (reading) {
        const metadata = await call<Mail>("mail_metadata", {
          id: reading,
        }).catch(() => null);
        if (
          metadata &&
          selectionRef.current === reading &&
          seq === request.current
        ) {
          if (
            detailRef.current?.mail.id === reading &&
            detailRef.current.mail.hash !== metadata.hash
          ) {
            // The body and attachments must come from the same new original
            // as the metadata, especially after online mail is archived.
            setDetail(null);
            setDetailRetry((n) => n + 1);
          } else
            setDetail((current) =>
              current?.mail.id === reading
                ? {
                    ...current,
                    mail: {
                      ...metadata,
                      body: current.mail.body,
                      ...localChanges.current.get(reading),
                    },
                  }
                : current,
            );
        }
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      if (seq === request.current && currentQuery === queryRef.current)
        setLoading(false);
    }
  };
  const [refresh] = useState(() =>
    coalesceRefresh(() => refreshAction.current()),
  );
  useEffect(() => {
    void refresh();
  }, [query, refresh]);
  useEffect(() => {
    const timer = setTimeout(
      () => setQuery((q) => ({ ...q, search, limit: 200 })),
      200,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("mail-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    let live = true;
    // A read message may leave an unread list while it remains open.
    // Keep its content during list refreshes, and clear only on selection changes.
    setDetail((current) => (current?.mail.id === selected ? current : null));
    setDetailError(null);
    if (selected)
      void call<Detail>("mail_detail", { id: selected })
        .then((d) => {
          if (live) {
            setDetail({
              ...d,
              mail: { ...d.mail, ...localChanges.current.get(d.mail.id) },
            });
            if (notificationReading.current === d.mail.id) {
              notificationReading.current = "";
              if (!d.mail.isRead)
                void updateMail(d.mail.id, "read", "true")
                  .then(() => refresh())
                  .catch((error) => toast.error(String(error)));
            }
          }
        })
        .catch((e) => {
          if (live) {
            setDetailError({ id: selected, message: String(e) });
            toast.error(String(e));
          }
        });
    return () => {
      live = false;
    };
  }, [selected, detailRetry]);
  useEffect(() => {
    setChecked((ids) =>
      ids.filter((id) => data.messages.some((m) => m.id === id)),
    );
  }, [data.messages]);
  // 彻底删除后先把邮件藏起来，直到服务器确认、快照里不再出现再清掉待删标记。
  // 不随导航清除，否则重开废纸篓又会闪回未确认删除的邮件。
  useEffect(() => {
    if (!pendingDeletes.current.size) return;
    const present = new Set(data.messages.map((m) => m.id));
    for (const id of [...pendingDeletes.current])
      if (!present.has(id)) pendingDeletes.current.delete(id);
  }, [data.messages]);
  useEffect(() => {
    if (!native) return;
    let cleanup = () => {};
    let active = true;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const a = await listen<string>("sync-progress", (e) =>
        setSyncText(e.payload),
      );
      const b = await listen("mail-updated", () => {
        setSyncText("");
        void refresh();
      });
      const c = await listen<{
        status: string;
        subject: string;
        message: string;
      }>("send-result", ({ payload }) => {
        const message = `${payload.subject || "（无主题）"}：${payload.message}`;
        if (payload.status === "sent") toast.success(message);
        else if (payload.status === "uncertain")
          toast.warning(message, { duration: 10000 });
        else toast.error(message, { duration: 10000 });
      });
      const d = await listen<string>("mail-link-open", ({ payload }) => {
        void openMailLinkRef
          .current(payload)
          .catch((error) => toast.error(`无法打开链接：${String(error)}`));
      });
      if (!active) {
        a();
        b();
        c();
        d();
      } else
        cleanup = () => {
          a();
          b();
          c();
          d();
        };
    });
    const timer = setInterval(() => void refresh(), 20000);
    return () => {
      active = false;
      cleanup();
      clearInterval(timer);
    };
  }, [refresh]);
  const compose = useCallback(
    (
      mail?: Mail,
      forward = false,
      all = false,
      origin?: Detail,
      // 账号内视图（草稿箱/文件夹）新建邮件时默认用该账号发件
      preferredAccountId = "",
    ) => {
      if (!data.accounts.some((a) => a.enabled)) {
        setAccountDialog(true);
        return;
      }
      const accountId =
        (mail && data.accounts.some((a) => a.id === mail.accountId && a.enabled)
          ? mail.accountId
          : undefined) ??
        (preferredAccountId &&
        data.accounts.some((a) => a.id === preferredAccountId && a.enabled)
          ? preferredAccountId
          : data.accounts.find((a) => a.enabled)!.id);
      const d = newDraft(accountId);
      if (mail) {
        const source =
          origin ||
          (detail?.mail.id === mail.id
            ? detail
            : { mail, html: "", attachments: [] });
        const recipients = replyRecipients(
          source,
          data.accounts.map((a) => a.email),
          all,
          data.accounts.find((a) => a.id === accountId)!.email,
        );
        if (!forward) Object.assign(d, replyHeaders(source.mail));
        d.to = forward ? "" : recipients.to;
        d.cc = forward ? "" : recipients.cc;
        d.subject = `${forward ? "Fwd" : "Re"}: ${mail.subject.replace(/^(Re|Fwd):\s*/i, "")}`;
        d.quote = {
          kind: forward ? "forward" : "reply",
          included: forward,
          sender: mail.sender,
          recipients: (source.to || []).map(formatAddress).join(", "),
          date: mail.date,
          subject: mail.subject,
          body: mail.body,
          html: source.html,
        };
        // 转发时把原邮件附件导出到临时文件并预填（未落盘的邮件按需从服务器取）
        if (forward && native && !isDemo() && source.attachments.length) {
          void call<string[]>("extract_attachments", { id: mail.id })
            .then((paths) => {
              if (!paths.length) return;
              setDraft((prev) =>
                prev && prev.id === d.id
                  ? {
                      ...prev,
                      attachments: [
                        ...prev.attachments,
                        ...paths.filter((p) => !prev.attachments.includes(p)),
                      ],
                    }
                  : prev,
              );
            })
            .catch((e) => toast.error(`无法附加原邮件附件：${String(e)}`));
        }
      }
      setDraft(d);
    },
    [data.accounts, detail],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      // 统一守卫：输入/富文本/下拉、弹层菜单、正在写信、组合输入、长按、已处理
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        draft ||
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]',
        ) ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        if (page !== "mail" || !selected) return;
        const direction = e.key === "ArrowUp" ? "previous" : "next";
        if (canNavigate(direction)) {
          e.preventDefault();
          void navigateReading(direction);
        }
        return;
      }
      const action = mailShortcut(e);
      if (action) {
        // 只作用于“当前正在阅读且落在选中集内”的单封邮件，多选/加载/跳转中不抢键
        if (
          page !== "mail" ||
          loading ||
          checked.length ||
          !detail ||
          detail.mail.id !== selected ||
          navigationPending.current ||
          !canSeek()
        )
          return;
        e.preventDefault();
        const mail = detail.mail;
        if (
          action === "reply" ||
          action === "replyAll" ||
          action === "forward"
        ) {
          compose(mail, action === "forward", action === "replyAll", detail);
        } else if (!shortcutMutationPending.current) {
          shortcutMutationPending.current = true;
          void mutate(
            [mail.id],
            action,
            String(action === "read" ? !mail.isRead : !mail.starred),
            false,
            [mail],
          ).finally(() => {
            shortcutMutationPending.current = false;
          });
        }
        return;
      }
      if (e.altKey || e.shiftKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        compose();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        // 全选当前列表（输入框/对话框内不拦截，见上方守卫）
        if (page !== "mail") return;
        e.preventDefault();
        setChecked(data.messages.map((m) => m.id));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compose, page, draft, selected, data, detail, query, loading, checked]);
  function navigate(
    view: string,
    accountId = "",
    folder = "",
    remoteFolder = "",
  ) {
    ++notificationGeneration.current;
    setNotificationToken(null);
    notificationReading.current = "";
    setPage("mail");
    setSearch("");
    setSelected("");
    setChecked([]);
    setQuery({
      view,
      accountId,
      folder,
      remoteFolder,
      search: "",
      limit: 200,
      unreadOnly: false,
      listMode: query.listMode,
    });
  }
  async function mutate(
    ids: string[],
    action: string,
    value: string,
    whole = false,
    originals: Mail[] = [],
  ) {
    let currentMessages = [
      ...new Map(
        [...data.messages, ...(detail ? [detail.mail] : []), ...originals].map(
          (m) => [m.id, m],
        ),
      ).values(),
    ];
    if (whole) {
      try {
        const threads = await Promise.all(
          ids.map((id) => call<Mail[]>("mail_conversation", { id })),
        );
        currentMessages = [
          ...new Map(threads.flat().map((m) => [m.id, m])).values(),
        ];
        ids = currentMessages.map((m) => m.id);
      } catch (e) {
        toast.error(String(e));
        return;
      }
    }
    const before = currentMessages
      .filter((m) => ids.includes(m.id))
      .map((m) => ({
        id: m.id,
        value:
          action === "read"
            ? String(m.isRead)
            : action === "star"
              ? String(m.starred)
              : action === "trash"
                ? String(m.trashed)
                : m.localFolder,
      }));
    try {
      if (action === "delete")
        for (const id of ids) pendingDeletes.current.add(id);
      for (const id of ids) await updateMail(id, action, value);
      await refresh();
      setChecked([]);
      // 删除正在阅读的邮件：阅读器前进到下一封，没有则回到空态
      if (
        (action === "trash" || action === "delete") &&
        selected &&
        ids.includes(selected)
      ) {
        const removed = new Set(ids);
        const at = data.messages.findIndex((m) => m.id === selected);
        const next =
          data.messages.slice(at + 1).find((m) => !removed.has(m.id)) ??
          [...data.messages.slice(0, at)]
            .reverse()
            .find((m) => !removed.has(m.id));
        setSelected(next?.id ?? "");
      }
      toast.success("已更新邮件", {
        action:
          action === "delete"
            ? undefined
            : {
                label: "撤销",
                onClick: () => {
                  void (async () => {
                    try {
                      for (const old of before)
                        await updateMail(old.id, action, old.value);
                      await refresh();
                    } catch (e) {
                      toast.error(String(e));
                    }
                  })();
                },
              },
      });
    } catch (e) {
      toast.error(String(e));
      void refresh();
    }
  }
  /// 删除本地文件夹：把邮件移回「全部存档」，文件夹随之从侧栏消失。
  async function removeLocalFolder(name: string) {
    const ok = await askConfirmation({
      title: `删除本地文件夹「${name}」？`,
      description:
        "文件夹里的邮件会移回「全部存档」，不会删除邮件，也不改动服务器上的原件。",
      action: "删除文件夹",
      destructive: true,
    });
    if (!ok) return;
    try {
      const moved = await call<number>("clear_local_folder", { name });
      if (query.folder === name) {
        setSelected("");
        setDetail(null);
      }
      await refresh();
      toast.success(
        moved ? `已移出 ${moved} 封邮件，文件夹已删除` : "文件夹已删除",
      );
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function updateMail(id: string, action: string, value: string) {
    await call("update_mail", { id, action, value });
    const change: Partial<Mail> =
      action === "read"
        ? { isRead: value === "true" }
        : action === "star"
          ? { starred: value === "true" }
          : action === "trash"
            ? { trashed: value === "true" }
            : { localFolder: value };
    localChanges.current.set(id, {
      ...localChanges.current.get(id),
      ...change,
    });
    setDetail((current) =>
      current?.mail.id === id
        ? { ...current, mail: { ...current.mail, ...change } }
        : current,
    );
  }
  function readingScope() {
    return queryScope(query);
  }
  useEffect(() => {
    navigationRequest.current++;
    navigationPending.current = false;
    setNavigationLoading(false);
    return () => {
      navigationRequest.current++;
      navigationPending.current = false;
    };
  }, [query, selected, page, demo, search]);
  function neighboringMail(
    direction: "previous" | "next",
    messages = data.messages,
  ) {
    if (dataScope.current !== readingScope()) return undefined;
    const conversationId =
      detail?.mail.id === selected ? detail.mail.conversationId : undefined;
    const index = messages.findIndex(
      (m) =>
        m.id === selected ||
        (grouped && !!m.conversationId && m.conversationId === conversationId),
    );
    if (index >= 0)
      return messages[index + (direction === "previous" ? -1 : 1)];
    const anchor = readingNeighbors.current;
    if (anchor?.scope !== readingScope()) return undefined;
    const byId = new Map(messages.map((m) => [m.id, m]));
    const id = anchor[direction].find((id) => byId.has(id));
    if (id) return byId.get(id);
    // An opened unread mail can leave the list before the next page arrives.
    // Only newly loaded older results may extend its recorded next boundary.
    const known = new Set(anchor.known);
    return direction === "next"
      ? messages.find(
          (mail) =>
            !known.has(mail.id) &&
            new Date(mail.date).getTime() <= new Date(anchor.date).getTime(),
        )
      : undefined;
  }
  function canSeek() {
    if (
      !selected ||
      dataScope.current !== readingScope() ||
      search !== query.search
    )
      return false;
    const conversationId =
      detail?.mail.id === selected ? detail.mail.conversationId : undefined;
    return (
      readingNeighbors.current?.scope === readingScope() ||
      data.messages.some(
        (mail) =>
          mail.id === selected ||
          (grouped &&
            !!conversationId &&
            mail.conversationId === conversationId),
      )
    );
  }
  function canNavigate(direction: "previous" | "next") {
    if (neighboringMail(direction)) return true;
    return (
      canSeek() &&
      !(
        neighborHints?.id === selected &&
        neighborHints.scope === readingScope() &&
        neighborHints[direction] === false
      )
    );
  }
  useEffect(() => {
    pageTicket.current++;
    pagePending.current = false;
    setPageLoading(false);
  }, [query, demo, page, search]);
  useEffect(() => {
    let live = true;
    neighborRequests.current = null;
    if (!canSeek()) {
      setNeighborHints(null);
      return;
    }
    const currentQuery = queryRef.current,
      id = selected!,
      scope = readingScope();
    const cache: {
      id: string;
      scope: string;
      revision: number;
      previous?: Promise<MailNeighbor>;
      next?: Promise<MailNeighbor>;
    } = { id, scope, revision: data.revision };
    neighborRequests.current = cache;
    setNeighborHints({
      id,
      scope,
      previous: neighboringMail("previous") ? true : null,
      next: neighboringMail("next") ? true : null,
    });
    for (const direction of ["previous", "next"] as const) {
      if (neighboringMail(direction)) continue;
      const promise = mailNeighbor(currentQuery, id, direction);
      cache[direction] = promise;
      void promise
        .then((result) => {
          if (
            live &&
            currentQuery === queryRef.current &&
            selectionRef.current === id &&
            result.revision >= dataRef.current.revision
          ) {
            setNeighborHints((current) =>
              current?.id === id && current.scope === scope
                ? { ...current, [direction]: !!result.mail }
                : current,
            );
          }
        })
        .catch(() => {
          if (neighborRequests.current === cache) cache[direction] = undefined;
        });
    }
    return () => {
      live = false;
    };
  }, [query, selected, data.revision, demo, page, search]);
  async function loadNextPage() {
    const base = dataRef.current,
      currentQuery = queryRef.current;
    if (
      pagePending.current ||
      !base.nextCursor ||
      dataScope.current !== queryScope(currentQuery)
    )
      return;
    const cursor = base.nextCursor,
      ticket = ++pageTicket.current,
      seq = ++request.current;
    pagePending.current = true;
    setPageLoading(true);
    try {
      const value = await mailPage({ ...currentQuery, limit: 200 }, cursor);
      if (
        ticket !== pageTicket.current ||
        seq !== request.current ||
        currentQuery !== queryRef.current ||
        cursor !== dataRef.current.nextCursor
      )
        return;
      const reset = value.reset || value.revision !== dataRef.current.revision;
      const merged = reset
        ? value
        : {
            ...value,
            messages: [
              ...dataRef.current.messages,
              ...value.messages.filter(
                (mail) =>
                  !dataRef.current.messages.some(
                    (existing) => existing.id === mail.id,
                  ),
              ),
            ],
          };
      dataRef.current = merged;
      dataScope.current = queryScope(currentQuery);
      setData(merged);
      if (reset) toast.info("邮件列表已更新，已重新加载最新结果");
    } catch (e) {
      if (ticket === pageTicket.current && currentQuery === queryRef.current)
        toast.error(`加载更多邮件失败：${String(e)}`);
    } finally {
      if (ticket === pageTicket.current) {
        pagePending.current = false;
        setPageLoading(false);
      }
    }
  }
  async function navigateReading(direction: "previous" | "next") {
    if (navigationPending.current) return;
    const neighbor = neighboringMail(direction);
    if (neighbor) {
      await openMail(neighbor);
      return;
    }
    if (!canSeek()) return;
    const currentQuery = queryRef.current,
      reading = selectionRef.current!,
      ticket = ++navigationRequest.current;
    navigationPending.current = true;
    setNavigationLoading(true);
    try {
      const cache = neighborRequests.current;
      const pending =
        cache?.id === reading &&
        cache.scope === readingScope() &&
        cache.revision === dataRef.current.revision
          ? cache[direction]
          : undefined;
      let value = await (pending ||
        mailNeighbor(currentQuery, reading, direction));
      if (
        ticket !== navigationRequest.current ||
        currentQuery !== queryRef.current ||
        reading !== selectionRef.current
      )
        return;
      if (value.revision < dataRef.current.revision)
        value = await mailNeighbor(currentQuery, reading, direction);
      if (
        ticket !== navigationRequest.current ||
        currentQuery !== queryRef.current ||
        reading !== selectionRef.current ||
        value.revision < dataRef.current.revision
      )
        return;
      if (value.mail)
        await openMail(
          value.mail,
          dataRef.current.messages.some((mail) => mail.id === value.mail!.id)
            ? dataRef.current.messages
            : [value.mail],
        );
      else
        setNeighborHints((current) =>
          current?.id === reading
            ? { ...current, [direction]: false }
            : current,
        );
    } catch (e) {
      if (
        ticket === navigationRequest.current &&
        currentQuery === queryRef.current
      ) {
        if (neighborRequests.current?.id === reading)
          neighborRequests.current[direction] = undefined;
        toast.error(`加载相邻邮件失败：${String(e)}`);
      }
    } finally {
      if (ticket === navigationRequest.current) {
        navigationPending.current = false;
        setNavigationLoading(false);
      }
    }
  }
  async function openMail(m: Mail, messages = data.messages) {
    ++notificationGeneration.current;
    setNotificationToken(null);
    notificationReading.current = "";
    const index = messages.findIndex(
      (item) =>
        item.id === m.id ||
        (grouped &&
          !!m.conversationId &&
          item.conversationId === m.conversationId),
    );
    if (index >= 0)
      readingNeighbors.current = {
        scope: readingScope(),
        previous: messages
          .slice(0, index)
          .reverse()
          .map((item) => item.id),
        next: messages.slice(index + 1).map((item) => item.id),
        known: messages.map((item) => item.id),
        date: m.date,
      };
    setSelected(m.id);
    try {
      const mode = query.listMode;
      const conversation = grouped
        ? await call<Mail[]>("mail_conversation", { id: m.id })
        : [m];
      if (queryRef.current.listMode !== mode) return;
      for (const mail of conversation.filter((mail) => !mail.isRead))
        await updateMail(mail.id, "read", "true");
      void refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function sync() {
    if (syncing) return;
    if (demo) {
      toast.info("演示模式不连接真实邮箱");
      return;
    }
    setSyncing(true);
    try {
      const n =
        query.remoteFolder && query.accountId
          ? await call<number>("sync_remote_folder", {
              id: query.accountId,
              folder: query.remoteFolder,
            })
          : await call<number>("sync_mail");
      toast.success(`收取完成，新增 ${n} 封邮件`);
    } catch (e) {
      toast.error(String(e), { duration: 8000 });
    } finally {
      setSyncing(false);
      setSyncText("");
      void refresh();
    }
  }
  function demoMode() {
    if (demo) {
      leaveDemo();
      setDemo(false);
    } else {
      enterDemo();
      setDemo(true);
    }
    setSelected("");
    setPage("mail");
    setQuery({
      view: "all",
      accountId: "",
      folder: "",
      search: "",
      limit: 200,
      unreadOnly: false,
      listMode: query.listMode,
    });
    setSearch("");
    void refresh();
  }
  async function loadDrafts() {
    try {
      setDrafts(await call<Compose[]>("list_drafts"));
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function showDrafts() {
    setPage("drafts");
    await loadDrafts();
  }
  // 清空草稿：删除列出的草稿，正在编辑的那份保留
  async function clearDrafts(list: Compose[]) {
    if (clearingDrafts) return;
    const removable = list.filter((d) => d.id !== draft?.id);
    if (!removable.length) {
      toast.info("没有可清空的草稿");
      return;
    }
    const ok = await askConfirmation({
      title: "清空草稿箱？",
      description: `将删除 ${removable.length} 份草稿，删除后无法恢复；正在编辑的草稿会保留。`,
      action: "清空草稿",
      destructive: true,
    });
    if (!ok) return;
    setClearingDrafts(true);
    let done = 0;
    let failed = 0;
    for (const d of removable) {
      try {
        await call("delete_draft", { id: d.id });
        done++;
      } catch {
        failed++;
      }
    }
    setClearingDrafts(false);
    await loadDrafts();
    if (done) toast.success(`已清空 ${done} 份草稿`);
    if (failed) toast.error(`${failed} 份草稿删除失败`);
  }
  // 清空本地废纸篓：彻底删除其中的邮件（含服务器副本）
  async function clearTrash() {
    const ids = data.messages.filter((m) => m.trashed).map((m) => m.id);
    if (!ids.length) {
      toast.info("本地废纸篓已空");
      return;
    }
    const ok = await askConfirmation({
      title: "清空本地废纸篓？",
      description: `将彻底删除 ${ids.length} 封邮件（含服务器副本），无法恢复。`,
      action: "清空废纸篓",
      destructive: true,
    });
    if (!ok) return;
    await mutate(ids, "delete", "true", grouped);
  }
  async function queueArchives(ids: string[], conversations = false) {
    if (archiving) return;
    setArchiving(true);
    try {
      const result = await call<{
        queued: number;
        alreadySaved: number;
        blocked: number;
      }>("queue_archives", { ids, conversations });
      toast.success(
        `已安排 ${result.queued} 封补存，${result.alreadySaved} 封已有完整存档，${result.blocked} 封需处理`,
        { action: { label: "查看任务", onClick: () => setPage("storage") } },
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setArchiving(false);
    }
  }
  // 右键菜单「移动到文件夹」：服务器可行就真移服务器（本机归档随后自动跟随），
  // 服务器已无副本/非 IMAP 时退化为仅重定本机归档目录，可逆。
  async function moveToFolder(
    ids: string[],
    accountId: string,
    target: string,
    targetLabel: string,
    server: boolean,
  ) {
    const mails = ids
      .map(
        (id) =>
          data.messages.find((m) => m.id === id) ??
          (detail?.mail.id === id ? detail.mail : undefined),
      )
      .filter((m): m is Mail => !!m);
    if (!mails.length) return;
    if (!server) {
      let moved = 0;
      let failed = 0;
      for (const m of mails) {
        try {
          await call("move_local_archive", { id: m.id, target });
          moved++;
        } catch {
          failed++;
        }
      }
      if (moved)
        toast.success(`已将 ${moved} 封邮件移入本机「${targetLabel}」`);
      if (failed) toast.error(`${failed} 封邮件无法移动`);
      void refresh();
      return;
    }
    const folders = serverFolders.filter((f) => f.accountId === accountId);
    const plan: { id: string; source: string }[] = [];
    const localOnly: string[] = [];
    for (const m of mails) {
      try {
        const sources = await call<string[]>("copy_sources", { id: m.id });
        if (!sources.length) {
          localOnly.push(m.id);
          continue;
        }
        const source = directorySource(
          m,
          sources,
          folders,
          query.view,
          query.remoteFolder,
        );
        if (source.toLowerCase() === target.toLowerCase()) continue;
        plan.push({ id: m.id, source });
      } catch {
        localOnly.push(m.id);
      }
    }
    if (plan.length) {
      const ok = await askConfirmation({
        title: `移动到「${targetLabel}」？`,
        description: `将在服务器上移动其中 ${plan.length} 封邮件，所有设备可见，操作不可逆${
          localOnly.length
            ? `；另有 ${localOnly.length} 封服务器已无副本，仅调整本机归档`
            : ""
        }。`,
        action: "移动",
        destructive: true,
      });
      if (!ok) return;
    }
    let queued = 0;
    let local = 0;
    let failed = 0;
    for (const item of plan) {
      try {
        await call("queue_server_move", {
          id: item.id,
          source: item.source,
          target,
        });
        queued++;
      } catch {
        failed++;
      }
    }
    for (const id of localOnly) {
      try {
        await call("move_local_archive", { id, target });
        local++;
      } catch {
        failed++;
      }
    }
    if (queued) toast.success(`已记录 ${queued} 封服务器移动任务`);
    if (local)
      toast.success(`已将 ${local} 封邮件调整到本机「${targetLabel}」`);
    if (failed) toast.error(`${failed} 封邮件无法移动`);
    void refresh();
  }
  // 批量与阅读器共用的移动目标：跟随选中账号（服务器目录或本机归档目录），顺序与账号内一致
  function moveTargets(mails: Mail[]): {
    accountId: string;
    accountName: string;
    server: boolean;
    targets: MoveTarget[];
  } | null {
    const accountIds = new Set(mails.map((m) => m.accountId));
    if (!mails.length || accountIds.size !== 1) return null;
    const accountId = mails[0].accountId;
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) return null;
    const server = account.enabled && account.protocol === "imap";
    const roles = (name: string) =>
      serverFolders.find((f) => f.accountId === accountId && f.name === name)
        ?.roles;
    const targets = server
      ? serverFolders
          .filter(
            (f) => f.accountId === accountId && f.selectable && !f.syncError,
          )
          .sort(compareFolders)
          .map((f) => ({ name: f.name, label: f.displayName }))
      : (archiveTree.find((g) => g.accountId === accountId)?.folders ?? [])
          .filter((f) => f.count > 0)
          .sort((a, b) =>
            compareFolders(
              {
                name: a.name,
                displayName: a.displayName || a.name,
                roles: roles(a.name),
              },
              {
                name: b.name,
                displayName: b.displayName || b.name,
                roles: roles(b.name),
              },
            ),
          )
          .map((f) => ({ name: f.name, label: f.displayName || f.name }));
    return { accountId, accountName: account.name, server, targets };
  }
  // 自己账号发出的邮件（含服务器已发送副本与本机 SMTP 存档）
  const own = (m: Mail) =>
    parseAddresses(m.sender).some(
      (a) =>
        a.email.toLowerCase() === m.accountEmail.toLowerCase() ||
        data.accounts.some(
          (account) => account.email.toLowerCase() === a.email.toLowerCase(),
        ),
    );
  // 重新编辑已发送邮件：生成新草稿进写信窗口，原邮件不动
  async function reeditSent(m: Mail) {
    if (demo) {
      toast.info("演示模式不重新编辑已发送邮件");
      return;
    }
    if (!native) {
      toast.info("请在桌面客户端中重新编辑已发送邮件");
      return;
    }
    try {
      // 原样载入已发送邮件的正文（含问候语/落款/引用），保持原状态；
      // 不再单独抽签名再追加，否则签名会被挪到引用之后、正文顺序错乱。
      setDraft(await call<Compose>("reedit_sent_mail", { id: m.id }));
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function exportMail(m: Mail) {
    if (!native || demo) {
      toast.info("真实邮件可在桌面客户端中导出为 EML");
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `${m.subject.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.eml`,
      filters: [{ name: "原始邮件", extensions: ["eml"] }],
    });
    if (path)
      try {
        await call("export_mail", { id: m.id, path });
        toast.success("完整邮件已导出");
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function attachment(index: number, name: string, mail = detail?.mail) {
    if (!mail || !native || demo) {
      toast.info("请在桌面客户端中下载真实附件");
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name.replace(/[\\/]/g, "-") });
    if (path)
      try {
        await call("save_attachment", { id: mail.id, index, path });
        toast.success("附件已保存");
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function backup(restore = false) {
    if (!native || demo) {
      toast.info("请在桌面客户端中备份真实存档");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      directory: true,
      multiple: false,
      title: restore ? "选择雁信备份文件夹" : "选择备份保存位置",
    });
    if (path)
      try {
        const result = await call<string | number>(
          restore ? "restore_archive" : "backup_archive",
          { path },
        );
        toast.success(
          restore ? `已恢复 ${result} 封邮件` : `备份已保存至 ${result}`,
          { duration: 7000 },
        );
        void refresh();
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function changeDataDir() {
    if (isDemo()) {
      toast.error("演示模式不支持更改存档位置");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: dataDir?.path,
        title: "选择存档位置",
      });
      if (!picked || typeof picked !== "string") return;
      const check = await call<DataDirCheck>("check_data_dir", {
        path: picked,
      });
      if (check.error) {
        toast.error(check.error);
        return;
      }
      if (!check.writable) {
        toast.error("所选目录不可写，请检查权限或更换位置");
        return;
      }
      if (check.isCurrent) {
        toast("这就是当前位置");
        return;
      }
      // 目标已有数据：直接切换（不迁移）
      if (check.hasData) {
        const ok = await askConfirmation({
          title: "切换到已有数据目录",
          description:
            "该目录已包含邮件数据，将直接切换过去（不迁移、不删除任何数据）。重启后生效。",
          action: "切换",
        });
        if (!ok) return;
        const info = await call<DataDirInfo>("set_data_dir", { path: picked });
        setDataDir(info);
        toast.success("已切换，重启邮件后生效");
        return;
      }
      // 空目录：先问是否迁移
      const size = formatSize(check.migrationBytes);
      const migrate = await askConfirmation({
        title: "迁移现有数据？",
        description: `该目录没有现有数据。迁移会把当前账号、规则与 ${check.migrationFiles} 封完整存档（${size}）移动到新位置；不迁移则直接使用空目录，账号需重新添加、邮件从服务器重新收取。`,
        action: "迁移",
      });
      if (!migrate) {
        const info = await call<DataDirInfo>("set_data_dir", { path: picked });
        setDataDir(info);
        toast.success("已切换到空目录，重启后账号需重新添加");
        return;
      }
      // 迁移后再问是否清理旧数据
      const removeSource = await askConfirmation({
        title: "删除原位置数据？",
        description:
          "迁移完成后是否删除原位置的旧数据？删除后将只有新位置一份；建议先重启验证正常，再回来删除。",
        action: "删除",
        destructive: true,
      });
      const info = await call<DataDirInfo>("migrate_data_dir", {
        path: picked,
        removeSource,
      });
      setDataDir(info);
      toast.success(
        removeSource
          ? "已迁移并清理旧数据，重启后生效"
          : "已迁移（旧数据保留），重启后生效",
      );
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function resetDataDir() {
    try {
      const info = await call<DataDirInfo>("reset_data_dir");
      setDataDir(info);
      toast.success("已恢复默认位置，重启邮件后生效");
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function restartNow() {
    try {
      await call("restart_app");
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function loadFolders(id: string) {
    if (folderLoading.includes(id)) return;
    setFolderLoading((ids) => [...ids, id]);
    setFolderErrors((errors) => ({ ...errors, [id]: "" }));
    try {
      const folders = await call<RemoteFolder[]>("account_folders", { id });
      setServerFolders((all) => [
        ...all.filter((f) => f.accountId !== id),
        ...folders,
      ]);
    } catch (e) {
      setFolderErrors((errors) => ({ ...errors, [id]: String(e) }));
    } finally {
      setFolderLoading((ids) => ids.filter((value) => value !== id));
    }
  }
  async function openRemoteFolder(accountId: string, folder: string) {
    navigate("remote", accountId, "", folder);
    // 草稿只存在本机：账号内草稿文件夹直接列本地草稿，不去同步服务器目录
    if (folderRoles(accountId, folder).includes("drafts")) {
      await loadDrafts();
      return;
    }
    if (
      demo ||
      serverFolders.find(
        (item) => item.accountId === accountId && item.name === folder,
      )?.syncError
    )
      return;
    try {
      await call("sync_remote_folder", { id: accountId, folder });
      await refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }
  const folderRoles = (accountId: string, folder: string) =>
    serverFolders.find((f) => f.accountId === accountId && f.name === folder)
      ?.roles ?? [];
  const activeAccount = data.accounts.find((a) => a.id === query.accountId),
    title = query.remoteFolder
      ? (() => {
          const folder = serverFolders.find(
            (f) =>
              f.accountId === query.accountId && f.name === query.remoteFolder,
          );
          return folder ? remoteFolderLabel(folder) : query.remoteFolder;
        })()
      : query.folder || activeAccount?.name || viewNames[query.view];
  // 账号内「草稿」文件夹：显示该账号的本地草稿（雁信草稿只存本机）
  const draftsFolderView =
    page === "mail" &&
    query.view === "remote" &&
    !!query.remoteFolder &&
    folderRoles(query.accountId, query.remoteFolder).includes("drafts");
  const unreadTotal = (data.folderUnread ?? []).filter(
    (f) => !query.accountId || f.accountId === query.accountId,
  );
  // 标签数量跟随当前范围：文件夹内只算该文件夹，收件箱上下文算全部
  const scopedUnread = unreadTotal.filter(
    (f) => !query.remoteFolder || f.folder === query.remoteFolder,
  );
  // 「全部/未读」按每账号生效的收件箱范围计数：未配置的账号只算 INBOX
  const inboxScope = new Map(
    (data.accounts ?? []).map((a) => [
      a.id,
      new Set(
        (a.inboxFolders?.length ? a.inboxFolders : ["INBOX"]).map((folder) =>
          folder.toUpperCase(),
        ),
      ),
    ]),
  );
  const inInboxScope = (f: { accountId: string; folder: string }) =>
    inboxScope.get(f.accountId)?.has(f.folder.toUpperCase()) ?? false;
  const scopedTotals = (data.folderTotals ?? []).filter(
    (f) =>
      (!query.accountId || f.accountId === query.accountId) &&
      (!query.remoteFolder || f.folder === query.remoteFolder),
  );
  const unreadBadge = query.remoteFolder
    ? (scopedUnread[0]?.count ?? 0)
    : query.view === "all" || query.view === "unread"
      ? scopedUnread.filter(inInboxScope).reduce((sum, f) => sum + f.count, 0)
      : 0;
  // 已发送与草稿没有「未读」概念：这三处入口都不显示「未读」标签，
  // 分别是邮件功能区的「已发送」视图、账号内对应服务器文件夹、本地存档对应文件夹。
  const sentOrDraftsView =
    query.view === "sent" ||
    (!!query.remoteFolder &&
      serverFolders
        .find(
          (f) =>
            f.accountId === query.accountId && f.name === query.remoteFolder,
        )
        ?.roles?.some((role) => role === "sent" || role === "drafts"));
  const totalBadge = query.remoteFolder
    ? (scopedTotals[0]?.count ?? 0)
    : query.view === "all" || query.view === "unread"
      ? scopedTotals.filter(inInboxScope).reduce((sum, f) => sum + f.count, 0)
      : 0;
  const inboxTotal = (data.folderTotals ?? [])
    .filter(inInboxScope)
    .reduce((sum, f) => sum + f.count, 0);
  const allUnread = unreadTotal
    .filter(inInboxScope)
    .reduce((sum, f) => sum + f.count, 0);
  const nav = (
    view: string,
    Icon: typeof Inbox,
    total?: number,
    unread?: number,
  ) => (
    <Button
      variant="ghost"
      className={`nav-item ${page === "mail" && query.view === view && !query.accountId && !query.folder ? "active" : ""}`}
      onClick={() => navigate(view)}
      key={view}
    >
      <Icon size={17} />
      <span>{viewNames[view]}</span>
      {!!total && <em>{total}</em>}
      {!!unread && <em className="unread">{unread}</em>}
    </Button>
  );
  const visibleMessages = data.messages.filter(
    (m) => !pendingDeletes.current.has(m.id),
  );
  // 批量工具栏按当前列表上下文收窄：回复类动作不适合多选，只保留批量适用的项
  const batchMenuKind = mailMenuKind({
    view: query.view,
    roles: query.remoteFolder
      ? folderRoles(query.accountId, query.remoteFolder)
      : [],
  });
  const batchMove = moveTargets(
    checked
      .map(
        (id) =>
          data.messages.find((x) => x.id === id) ??
          (detail?.mail.id === id ? detail.mail : null),
      )
      .filter((x): x is Mail => x !== null),
  );
  return (
    <SidebarProvider
      className={`app-shell ${readerExpanded ? "reader-expanded" : ""}`}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      <div className="desktop-titlebar" data-tauri-drag-region />
      <Toaster
        position="bottom-center"
        theme={dark ? "dark" : "light"}
        richColors
        closeButton
      />
      <div className="top-actions app-actions">
        <EmlViewer />
        <UpdateIndicator updates={updates} />
        {demo && (
          <Button variant="ghost" className="demo-badge" onClick={demoMode}>
            演示模式 · 退出
          </Button>
        )}
        <span className="connection">
          <i className={syncing || syncText ? "pulse" : ""} />
          {syncText ||
            (demo
              ? "示例数据"
              : syncing
                ? "正在收取"
                : data.accounts.length
                  ? "本地优先"
                  : "尚未连接邮箱")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={dark ? "浅色模式" : "深色模式"}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>
      <NavigationLayout
        open={sidebarOpen}
        expanded={readerExpanded}
        sidebar={
          <Sidebar variant="inset" collapsible="none" className="mail-sidebar">
            <SidebarHeader className="mail-sidebar-header">
              <div className="brand">
                <img src="/app-icon.png" alt="雁信应用图标" />
                <div>
                  <strong>
                    雁信<span>邮件，自在有序</span>
                  </strong>
                </div>
                <Badge variant="outline" className="brand-version">
                  α
                </Badge>
              </div>
              <Button className="compose-button" onClick={() => compose()}>
                <SquarePen size={17} />
                写邮件<kbd>⌘ N</kbd>
              </Button>
            </SidebarHeader>
            <SidebarContent className="sidebar sb-host">
              <ScrollPane>
                <Button
                  type="button"
                  variant="ghost"
                  className="nav-collapse"
                  aria-expanded={!navCollapsed}
                  aria-controls="primary-nav"
                  onClick={() => {
                    const next = !navCollapsed;
                    setNavCollapsed(next);
                    try {
                      localStorage.setItem("mail-nav-collapsed", String(next));
                    } catch {
                      /* 隐私模式下忽略持久化 */
                    }
                  }}
                >
                  <ChevronDown
                    size={14}
                    className={navCollapsed ? "collapse-chevron" : ""}
                  />
                  邮件
                </Button>
                <nav
                  className="primary-nav"
                  id="primary-nav"
                  hidden={navCollapsed}
                >
                  {nav("all", Inbox, inboxTotal, allUnread)}
                  {nav("starred", Star)}
                  {nav("sent", Send)}
                  <Button
                    variant="ghost"
                    className={`nav-item ${page === "drafts" ? "active" : ""}`}
                    onClick={() => void showDrafts()}
                  >
                    <FileText size={17} />
                    <span>草稿箱</span>
                  </Button>
                  <Button
                    variant="ghost"
                    className={`nav-item ${page === "outbox" ? "active" : ""}`}
                    onClick={() => setPage("outbox")}
                  >
                    <History size={17} />
                    <span>发送记录</span>
                  </Button>
                </nav>
                <div className="nav-section-heading">
                  <span>我的账号</span>
                  <Button
                    variant="ghost"
                    title="添加邮箱账号"
                    onClick={() => setAccountDialog(true)}
                  >
                    <Plus size={15} />
                  </Button>
                </div>
                <div className="account-nav">
                  {data.accounts.map((a, i) => (
                    <Collapsible
                      key={a.id}
                      open={expandedAccounts.includes(a.id)}
                      onOpenChange={(open) => {
                        setExpandedAccounts((ids) =>
                          open
                            ? [...ids, a.id]
                            : ids.filter((id) => id !== a.id),
                        );
                        if (open) void loadFolders(a.id);
                      }}
                    >
                      <div
                        className={`account-navigation ${page === "mail" && query.accountId === a.id ? "active" : ""}`}
                      >
                        <Button
                          variant="ghost"
                          className="nav-item account-item"
                          onClick={() => {
                            // 点击账号名即折叠/展开（与右侧箭头一致）
                            const open = !expandedAccounts.includes(a.id);
                            setExpandedAccounts((ids) =>
                              open
                                ? [...ids, a.id]
                                : ids.filter((id) => id !== a.id),
                            );
                            if (open) void loadFolders(a.id);
                          }}
                        >
                          <span
                            className={`account-dot ${
                              a.error || !a.enabled ? "offline" : "online"
                            }`}
                          />
                          <span>
                            {a.name}
                            <small>{a.email}</small>
                          </span>
                          {!a.enabled && <span className="paused-dot" />}
                        </Button>
                        {a.error && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`${a.name} 收取异常`}
                              >
                                <AlertCircle
                                  size={14}
                                  className="text-destructive"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="max-w-80 break-words"
                            >
                              <p>{a.email}</p>
                              <p>{friendlyError(a.error)}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`展开 ${a.name} 的服务器文件夹`}
                            title="服务器文件夹"
                          >
                            <ChevronRight
                              size={13}
                              className={
                                expandedAccounts.includes(a.id)
                                  ? "rotate-90"
                                  : ""
                              }
                            />
                          </Button>
                        </CollapsibleTrigger>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`在 ${a.name} 新建文件夹`}
                          title="新建服务器文件夹"
                          onClick={() => {
                            setFolderDialog({
                              accountId: a.id,
                              mode: "create",
                            });
                            setFolderName("");
                          }}
                        >
                          <FolderPlus size={13} />
                        </Button>
                      </div>
                      <CollapsibleContent className="remote-folder-list">
                        {folderLoading.includes(a.id) &&
                          !serverFolders.some((f) => f.accountId === a.id) && (
                            <div
                              role="status"
                              aria-label="正在加载服务器文件夹"
                            >
                              <Skeleton className="h-6 mb-2" />
                              <Skeleton className="h-6" />
                            </div>
                          )}
                        {folderErrors[a.id] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void loadFolders(a.id)}
                          >
                            加载失败，重试
                          </Button>
                        )}
                        <RemoteFolderList
                          folders={serverFolders.filter(
                            (f) => f.accountId === a.id,
                          )}
                          selected={
                            query.accountId === a.id
                              ? query.remoteFolder || ""
                              : ""
                          }
                          onSelect={(name) => void openRemoteFolder(a.id, name)}
                          onDelete={(name) =>
                            setFolderDialog({
                              accountId: a.id,
                              mode: "delete",
                              name,
                            })
                          }
                          // 已发送与草稿没有「未读」概念，侧栏不显示未读徽标
                          unreadCounts={Object.fromEntries(
                            (data.folderUnread ?? [])
                              .filter(
                                (u) =>
                                  u.accountId === a.id &&
                                  !serverFolders.some(
                                    (f) =>
                                      f.accountId === a.id &&
                                      f.name === u.folder &&
                                      f.roles?.some((role) =>
                                        ["sent", "drafts"].includes(role),
                                      ),
                                  ),
                              )
                              .map((u) => [u.folder, u.count]),
                          )}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                  {!data.accounts.length && (
                    <Button
                      variant="ghost"
                      className="add-account-dashed"
                      onClick={() => setAccountDialog(true)}
                    >
                      <Plus size={14} />
                      连接你的第一个邮箱
                    </Button>
                  )}
                </div>
                <div className="nav-section-heading">
                  <span>保存在这台 Mac</span>
                  <HardDrive size={13} />
                </div>
                <Button
                  variant="ghost"
                  className={`nav-item ${
                    page === "mail" &&
                    query.view === "local" &&
                    !query.accountId &&
                    !query.folder
                      ? "active"
                      : ""
                  }`}
                  onClick={() => {
                    navigate("local");
                    // 整体隐藏/显示账号组；各账号内文件夹的展开状态保持不变
                    setArchiveTreeHidden((v) => !v);
                  }}
                >
                  <Archive size={17} />
                  <span>本地存档</span>
                  {!!data.stats.saved && <em>{data.stats.saved}</em>}
                </Button>
                {!archiveTreeHidden &&
                  archiveTree.map((group) => (
                    <Collapsible
                      key={group.accountId}
                      open={!!archiveOpen[group.accountId]}
                      onOpenChange={(open) =>
                        setArchiveOpen((o) => ({
                          ...o,
                          [group.accountId]: open,
                        }))
                      }
                    >
                      <CollapsibleTrigger className="nav-item folder-item">
                        <MailIcon size={16} />
                        <span>{group.accountEmail || group.accountId}</span>
                        <ChevronDown size={14} />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {(() => {
                          // 本地存档账号组：有本地存档的服务器文件夹 + 草稿箱
                          // （草稿只存本机），统一按账号树顺序（角色 + 中文拼音）排列。
                          const roles = (name: string) =>
                            serverFolders.find(
                              (x) =>
                                x.accountId === group.accountId &&
                                x.name === name,
                            )?.roles;
                          const rows = group.folders
                            .filter((f) => f.count > 0)
                            .map((f) => ({
                              name: f.name,
                              displayName: f.displayName || f.name,
                              count: f.count,
                              roles: roles(f.name),
                              drafts: false,
                            }));
                          const draftsFolder = serverFolders.find(
                            (x) =>
                              x.accountId === group.accountId &&
                              x.roles?.includes("drafts"),
                          );
                          if (
                            draftsFolder &&
                            !rows.some((r) => r.name === draftsFolder.name)
                          )
                            rows.push({
                              name: draftsFolder.name,
                              displayName:
                                draftsFolder.displayName || draftsFolder.name,
                              count: drafts.filter(
                                (d) => d.accountId === group.accountId,
                              ).length,
                              roles: draftsFolder.roles,
                              drafts: true,
                            });
                          rows.sort((a, b) => compareFolders(a, b));
                          return rows.map((f) => {
                            const active = f.drafts
                              ? query.view === "remote" &&
                                query.accountId === group.accountId &&
                                query.remoteFolder === f.name
                              : query.view === "local" &&
                                query.accountId === group.accountId &&
                                query.remoteFolder === f.name;
                            return (
                              <Button
                                variant="ghost"
                                key={f.name}
                                className={`nav-item folder-item nested ${active ? "active" : ""}`}
                                onClick={() =>
                                  f.drafts
                                    ? void openRemoteFolder(
                                        group.accountId,
                                        f.name,
                                      )
                                    : navigate(
                                        "local",
                                        group.accountId,
                                        "",
                                        f.name,
                                      )
                                }
                              >
                                {f.drafts ? (
                                  <FileText size={15} />
                                ) : (
                                  <Folder size={15} />
                                )}
                                <span>{f.displayName}</span>
                                {!!f.count && <em>{f.count}</em>}
                              </Button>
                            );
                          });
                        })()}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                {data.folders.map((f) => (
                  <div className="local-folder-row" key={f}>
                    <Button
                      variant="ghost"
                      className={`nav-item folder-item ${query.folder === f && page === "mail" ? "active" : ""}`}
                      onClick={() => navigate("local", "", f)}
                    >
                      <Folder size={16} />
                      <span>{f}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="folder-delete-btn text-destructive"
                      aria-label={`删除本地文件夹 ${f}`}
                      title="删除本地文件夹（邮件移回「全部存档」）"
                      onClick={() => void removeLocalFolder(f)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
                {nav("trash", Trash2)}
              </ScrollPane>
            </SidebarContent>
            <SidebarFooter className="mail-sidebar-footer">
              <div className="sidebar-bottom">
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "contacts" ? "active" : ""}`}
                  onClick={() => {
                    setContactSeed(null);
                    setPage("contacts");
                  }}
                >
                  <UsersRound size={17} />
                  <span>通讯录</span>
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "rules" ? "active" : ""}`}
                  onClick={() => setPage("rules")}
                >
                  <SlidersHorizontal size={17} />
                  <span>过滤规则</span>
                  {data.rules.length > 0 && <small>{data.rules.length}</small>}
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "settings" ? "active" : ""}`}
                  onClick={() => setPage("settings")}
                >
                  <Settings size={17} />
                  <span>设置与账号</span>
                </Button>
              </div>
            </SidebarFooter>
          </Sidebar>
        }
      >
        <SidebarInset
          className={`main-area ${page === "mail" ? "mail-layout" : ""}`}
        >
          {page === "contacts" ? (
            <ContactsPanel
              initial={contactSeed}
              onCompose={(address) => {
                const account = data.accounts.find((a) => a.enabled);
                if (!account) {
                  setAccountDialog(true);
                  return;
                }
                setDraft({
                  ...newDraft(account.id),
                  to: formatAddress(address),
                });
              }}
            />
          ) : page === "outbox" ? (
            <OutboxPanel onDraft={setDraft} />
          ) : page === "rules" ? (
            <RulesPanel
              data={data}
              onChange={() => void refresh()}
              onShowTasks={() => setPage("settings")}
            />
          ) : page === "settings" || page === "storage" ? (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    {page === "settings"
                      ? "MAKE YOURSELF AT HOME"
                      : "YOURS TO KEEP"}
                  </span>
                  <div className="page-title-row">
                    <SidebarTrigger
                      title="切换侧边栏"
                      aria-label="切换侧边栏"
                    />
                    <h1>
                      {page === "settings" ? "设置与账号" : "本地存档管理"}
                    </h1>
                  </div>
                  <p>
                    {page === "settings"
                      ? "连接你的邮箱，在一个地方照顾好工作与生活。"
                      : "服务器的保留期限，不再决定你的邮件能保存多久。"}
                  </p>
                </div>
                {page === "settings" && (
                  <Button onClick={() => setAccountDialog(true)}>
                    <Plus size={16} />
                    添加账号
                  </Button>
                )}
              </div>
              {page === "settings" && (
                <>
                  <div className="settings-accounts">
                    {data.accounts.map((a, i) => (
                      <article className="account-card" key={a.id}>
                        <span className={`account-avatar color-${i % 4}`}>
                          {a.name[0]}
                        </span>
                        <div>
                          <h3>
                            {a.name}
                            <Badge variant="secondary">
                              {a.protocol.toUpperCase()}
                            </Badge>
                          </h3>
                          <p>
                            {a.email}{" "}
                            <Badge variant="outline">
                              默认：
                              {a.saveLocally === false
                                ? "在线阅读"
                                : "本地留存"}
                            </Badge>
                          </p>
                          <small>
                            {a.error
                              ? friendlyError(a.error)
                              : !a.enabled
                                ? "账号已暂停"
                                : a.lastSync
                                  ? `最近收取：${new Date(a.lastSync).toLocaleString("zh-CN")}`
                                  : "已连接，等待首次收取"}
                          </small>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="账号操作"
                            >
                              <MoreHorizontal size={18} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingAccount(a);
                                  setAccountDialog(true);
                                }}
                              >
                                编辑账号配置
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRetentionIntro(false);
                                  setRetentionAccount(a);
                                }}
                              >
                                {a.protocol === "imap"
                                  ? "文件夹保存范围"
                                  : "本地保存设置"}
                              </DropdownMenuItem>
                              {a.protocol === "imap" && (
                                <DropdownMenuItem
                                  onClick={() => setMappingAccount(a)}
                                >
                                  特殊文件夹
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() =>
                                  void call("account_action", {
                                    id: a.id,
                                    remove: false,
                                  })
                                    .then(refresh)
                                    .catch((e) => toast.error(String(e)))
                                }
                              >
                                {a.enabled ? "暂停收取" : "启用收取"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setRemovingAccount(a)}
                              >
                                移除账号…
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </article>
                    ))}
                  </div>
                  {!data.accounts.length && (
                    <div className="panel-empty">
                      <MailIcon size={36} />
                      <h3>从连接一个邮箱开始</h3>
                      <p>支持 Gmail、Outlook、QQ、网易与自定义服务器。</p>
                    </div>
                  )}
                  {!!data.accounts.length && (
                    <>
                      <MailSignatures accounts={data.accounts} />
                      <InboxScope
                        accounts={data.accounts}
                        folders={data.remoteFolders ?? []}
                        onSaved={() => void refresh()}
                      />
                    </>
                  )}
                </>
              )}
              <Card className="storage-card">
                <div className="storage-card-header">
                  <span>
                    <ShieldCheck size={25} />
                  </span>
                  <div>
                    <h3>完整保存，独立留存</h3>
                    <p>
                      开启本地保存的账号留存完整正文与附件，已有存档不会随账号移除。
                    </p>
                  </div>
                  <Badge variant="secondary">按账号设置</Badge>
                </div>
                <div className="storage-summary">
                  <div className="storage-metrics">
                    <div>
                      <strong>
                        {data.stats.saved}
                        <small> 封</small>
                      </strong>
                      <span>完整本地存档</span>
                    </div>
                    <div>
                      <strong>{formatSize(data.stats.bytes)}</strong>
                      <span>原始邮件大小</span>
                    </div>
                  </div>
                  <div className="storage-actions">
                    <Button variant="outline" onClick={() => void backup()}>
                      <ArrowDownToLine size={15} />
                      备份存档
                    </Button>
                    <Button variant="outline" onClick={() => void backup(true)}>
                      <Archive size={15} />
                      恢复备份
                    </Button>
                    <DeleteArchiveDialog
                      onDeleted={() => {
                        setSelected("");
                        setDetail(null);
                        void refresh();
                      }}
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void call("open_data_folder").catch((e) =>
                          toast.error(String(e)),
                        )
                      }
                    >
                      <FolderOpen size={15} />
                      打开存储位置
                    </Button>
                  </div>
                </div>
                <p className="storage-path">{data.dataDir}</p>
                <div className="storage-actions">
                  <Button
                    variant="outline"
                    onClick={() => void changeDataDir()}
                  >
                    <FolderOpen size={15} />
                    更改存档位置…
                  </Button>
                  {dataDir && dataDir.source !== "default" && (
                    <Button variant="ghost" onClick={() => void resetDataDir()}>
                      恢复默认位置
                    </Button>
                  )}
                  {dataDir && dataDir.source === "file" && (
                    <Button variant="outline" onClick={() => void restartNow()}>
                      立即重启生效
                    </Button>
                  )}
                </div>
                {dataDir && (
                  <p className="storage-hint">
                    当前位置来源：
                    {dataDir.source === "env"
                      ? "环境变量"
                      : dataDir.source === "file"
                        ? "配置文件"
                        : "默认位置"}
                    {dataDir.overridden &&
                      "（环境变量覆盖中，界面设置暂不生效）"}
                    {dataDir.source === "file" && "，更改后需重启邮件生效"}
                  </p>
                )}
              </Card>
              <StorageTools logs={data.logs} onRefresh={() => void refresh()} />
              <div className="info-strip">
                <Info size={17} />
                <span>
                  关闭窗口后继续收取；退出
                  App、睡眠或断网时暂停。邮件须在服务器删除前完整下载。
                </span>
              </div>
              {page === "settings" && <UpdateSettings updates={updates} />}
              <div className="dev-note">
                <span>
                  雁信 {updates.version} ·{" "}
                  {updates.preview ? "开发预览" : "Alpha"}
                </span>
                <Button
                  variant="ghost"
                  className="text-link"
                  onClick={demoMode}
                >
                  {demo ? "退出演示" : "体验示例邮箱"}
                  <ArrowRight size={14} />
                </Button>
              </div>
            </section>
          ) : draftsFolderView ? (
            <DraftsPanel
              drafts={drafts.filter((d) => d.accountId === query.accountId)}
              title={`${activeAccount?.name || "账号"}草稿箱`}
              description="雁信的草稿只存在本机，账号内草稿文件夹显示该账号的本地草稿。"
              onOpen={setDraft}
              onDeleted={() => void loadDrafts()}
              onCompose={() =>
                compose(undefined, false, false, undefined, query.accountId)
              }
              onClearAll={() =>
                void clearDrafts(
                  drafts.filter((d) => d.accountId === query.accountId),
                )
              }
              clearing={clearingDrafts}
            />
          ) : page === "drafts" ? (
            <DraftsPanel
              drafts={drafts}
              title="草稿箱"
              description="草稿自动保存到本机，随时继续。"
              onOpen={setDraft}
              onDeleted={() => void showDrafts()}
              onCompose={() => compose()}
              onClearAll={() => void clearDrafts(drafts)}
              clearing={clearingDrafts}
            />
          ) : (
            <MailLayout
              expanded={readerExpanded}
              list={
                <section className="message-list">
                  <div className="list-heading">
                    <div>
                      <SidebarTrigger
                        title="切换侧边栏"
                        aria-label="切换侧边栏"
                      />
                      <h1>{title}</h1>
                      <span>
                        {visibleMessages.length} {grouped ? "个对话" : "封邮件"}
                      </span>
                    </div>
                    <div className="list-heading-actions">
                      {query.view === "trash" && visibleMessages.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          title="清空本地废纸篓（含服务器副本）"
                          aria-label="清空本地废纸篓"
                          onClick={() => void clearTrash()}
                        >
                          <Trash2 size={16} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={syncing || !data.accounts.length}
                        title="收取邮件"
                        onClick={() => void sync()}
                      >
                        <RefreshCw
                          size={16}
                          className={syncing ? "animate-spin" : ""}
                        />
                      </Button>
                    </div>
                  </div>
                  {serverFolders.find(
                    (f) =>
                      f.accountId === query.accountId &&
                      f.name === query.remoteFolder,
                  )?.syncError && (
                    <Alert className="mx-4 w-auto">
                      <AlertCircle />
                      <AlertTitle>目录来源已隔离</AlertTitle>
                      <AlertDescription>
                        此目录的服务器响应不可靠。旧来源已暂停使用，本地存档仍可在“本地存档”中查看。请到设置与账号重新核查。
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="mail-search-row">
                    <div className="search-box">
                      <Search size={16} />
                      <Input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索当前范围的邮件…"
                        aria-label="搜索邮件"
                      />
                      {search ? (
                        <Button
                          variant="ghost"
                          onClick={() => setSearch("")}
                          title="清除搜索"
                        >
                          <X size={14} />
                        </Button>
                      ) : (
                        <kbd>⌘ K</kbd>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant={
                            query.starredOnly ||
                            query.attachmentsOnly ||
                            query.searchField
                              ? "secondary"
                              : "ghost"
                          }
                          size="icon-lg"
                          aria-label="筛选邮件"
                          title={
                            query.starredOnly ||
                            query.attachmentsOnly ||
                            query.searchField
                              ? "筛选邮件（已启用）"
                              : "筛选邮件"
                          }
                        >
                          <SlidersHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>邮件筛选</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={!!query.starredOnly}
                          onCheckedChange={(checked) =>
                            setQuery((q) => ({
                              ...q,
                              starredOnly: checked,
                              limit: 200,
                            }))
                          }
                        >
                          <Star size={14} />
                          星标邮件
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={!!query.attachmentsOnly}
                          onCheckedChange={(checked) =>
                            setQuery((q) => ({
                              ...q,
                              attachmentsOnly: checked,
                              limit: 200,
                            }))
                          }
                        >
                          <Paperclip size={14} />
                          有附件
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>搜索字段</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={query.searchField || ""}
                          onValueChange={(value) =>
                            setQuery((q) => ({
                              ...q,
                              searchField: value,
                              limit: 200,
                            }))
                          }
                        >
                          {[
                            ["", "全部字段"],
                            ["subject", "主题"],
                            ["sender", "发件人"],
                            ["recipients", "收件人"],
                            ["body", "正文"],
                          ].map(([value, label]) => (
                            <DropdownMenuRadioItem value={value} key={value}>
                              {label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                    <MailDateFilter
                      dateFrom={query.dateFrom}
                      dateBefore={query.dateBefore}
                      onChange={(range) =>
                        setQuery((q) => ({ ...q, ...range, limit: 200 }))
                      }
                    />
                    {query.search &&
                      (!query.searchField || query.searchField === "body") && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="正文搜索范围"
                            >
                              <Info data-icon="inline-start" />
                              正文范围
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">
                            <p>
                              正文只检索本机已有内容，搜索不会自动下载。当前范围完整{" "}
                              {data.bodyCoverage.known} 封，未完整{" "}
                              {data.bodyCoverage.unknown}{" "}
                              封；需要纳入完整正文搜索时，可选择完整保存。
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                  </div>
                  <div className="list-filters">
                    <Tabs
                      value={
                        query.view === "unread" || query.unreadOnly
                          ? "unread"
                          : "all"
                      }
                      onValueChange={(value) =>
                        setQuery((q) =>
                          (q.view === "all" && !q.accountId) ||
                          q.view === "unread"
                            ? {
                                ...q,
                                view: value,
                                unreadOnly: false,
                                folder: "",
                                remoteFolder: "",
                              }
                            : { ...q, unreadOnly: value === "unread" },
                        )
                      }
                    >
                      <TabsList>
                        <TabsTrigger value="all">
                          全部
                          {!!totalBadge && (
                            <em className="tab-count">{totalBadge}</em>
                          )}
                        </TabsTrigger>
                        {!sentOrDraftsView && (
                          <TabsTrigger value="unread">
                            未读
                            {!!unreadBadge && (
                              <em className="tab-count">{unreadBadge}</em>
                            )}
                          </TabsTrigger>
                        )}
                      </TabsList>
                    </Tabs>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="邮件显示方式"
                        >
                          {grouped ? (
                            <MessagesSquare data-icon="inline-start" />
                          ) : (
                            <List data-icon="inline-start" />
                          )}
                          {grouped ? "按对话" : "逐封邮件"}
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup
                          value={query.listMode || "conversations"}
                          onValueChange={(value) => {
                            if (
                              value !== "conversations" &&
                              value !== "messages"
                            )
                              return;
                            setChecked([]);
                            readingNeighbors.current = null;
                            setQuery((q) => ({
                              ...q,
                              listMode: value,
                              limit: 200,
                            }));
                          }}
                        >
                          <DropdownMenuRadioItem value="conversations">
                            按对话分组
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="messages">
                            逐封邮件
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {checked.length > 0 && (
                    <div className="batch-toolbar">
                      <span>
                        已选 {checked.length} {grouped ? "个对话" : "封邮件"}
                      </span>
                      {batchMenuKind === "trash" ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="从本地废纸篓恢复"
                            onClick={() =>
                              void mutate(checked, "trash", "false", grouped)
                            }
                          >
                            <Undo2 size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            title="彻底删除（含服务器副本）"
                            onClick={() =>
                              void mutate(checked, "delete", "true", grouped)
                            }
                          >
                            <Trash2 size={15} />
                          </Button>
                        </>
                      ) : (
                        <>
                          {batchMenuKind === "received" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="完整保存到本地"
                                disabled={archiving}
                                onClick={() =>
                                  void queueArchives(checked, grouped)
                                }
                              >
                                <HardDriveDownload />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="标记为已读"
                                onClick={() =>
                                  void mutate(checked, "read", "true", grouped)
                                }
                              >
                                <CheckCheck size={15} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="标记为未读"
                                onClick={() =>
                                  void mutate(checked, "read", "false", grouped)
                                }
                              >
                                <MailOpen size={15} />
                              </Button>
                            </>
                          )}
                          <MoveToFolderMenu
                            accountName={batchMove?.accountName}
                            server={batchMove?.server ?? false}
                            targets={batchMove?.targets ?? []}
                            reason={
                              !batchMove
                                ? "请选择同一账号的邮件"
                                : batchMove.targets.length
                                  ? undefined
                                  : batchMove.server
                                    ? "没有可用的服务器文件夹"
                                    : "该账号暂无本地归档目录"
                            }
                            onSelect={(target) =>
                              batchMove &&
                              void moveToFolder(
                                checked,
                                batchMove.accountId,
                                target.name,
                                target.label,
                                batchMove.server,
                              )
                            }
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="移动到文件夹"
                            >
                              <Folder size={15} />
                            </Button>
                          </MoveToFolderMenu>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="移到本地废纸篓"
                            onClick={() =>
                              void mutate(checked, "trash", "true", grouped)
                            }
                          >
                            <Trash2 size={15} />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mail-rows sb-host">
                    <ScrollPane>
                      {loading ? (
                        <MailListSkeleton />
                      ) : visibleMessages.length ? (
                        visibleMessages.map((m, rowIndex) => {
                          const menuKind = mailMenuKind({
                            view: query.view,
                            roles: folderRoles(
                              m.accountId,
                              query.remoteFolder ?? "",
                            ),
                          });
                          const menuIds = checked.includes(m.id)
                            ? checked
                            : [m.id];
                          const menuMails = menuIds
                            .map(
                              (id) =>
                                data.messages.find((x) => x.id === id) ??
                                (detail?.mail.id === id ? detail.mail : null),
                            )
                            .filter((x): x is Mail => x !== null);
                          const allStarred =
                            menuMails.length > 0 &&
                            menuMails.every((x) => x.starred);
                          const allRead =
                            menuMails.length > 0 &&
                            menuMails.every((x) => x.isRead);
                          const anyTrashed = menuMails.some((x) => x.trashed);
                          const move = moveTargets(menuMails);
                          return (
                            <ContextMenu key={m.id}>
                              <ContextMenuTrigger asChild>
                                <div
                                  className={`mail-row ${selected === m.id || (grouped && !!m.conversationId && m.conversationId === detail?.mail.conversationId) ? "selected" : ""} ${!m.isRead ? "unread" : ""}`}
                                  onContextMenu={() => {
                                    if (!(
                                      checked.includes(m.id) &&
                                      checked.length > 1
                                    ))
                                      setChecked([m.id]);
                                  }}
                                >
                                  <div className="row-check">
                                    <Checkbox
                                      aria-label={`选择 ${m.subject}`}
                                      checked={checked.includes(m.id)}
                                      onCheckedChange={(v) => {
                                        lastRowIndex.current = rowIndex;
                                        setChecked((ids) =>
                                          v
                                            ? [...ids, m.id]
                                            : ids.filter((id) => id !== m.id),
                                        );
                                      }}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      className="row-quick"
                                      aria-label={
                                        m.starred ? "取消星标" : "星标"
                                      }
                                      title={m.starred ? "取消星标" : "星标"}
                                      onClick={() =>
                                        void mutate(
                                          [m.id],
                                          "star",
                                          String(!m.starred),
                                          grouped,
                                        )
                                      }
                                    >
                                      <Star
                                        size={13}
                                        className={m.starred ? "star-on" : ""}
                                      />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      className="row-quick"
                                      aria-label={
                                        m.isRead ? "标记未读" : "标记已读"
                                      }
                                      title={m.isRead ? "标记未读" : "标记已读"}
                                      onClick={() =>
                                        void mutate(
                                          [m.id],
                                          "read",
                                          String(!m.isRead),
                                          grouped,
                                        )
                                      }
                                    >
                                      <MailOpen size={13} />
                                    </Button>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    className="mail-row-main"
                                    onClick={(event) => {
                                      // Shift+点击：从上次行到本行范围勾选
                                      if (
                                        event.shiftKey &&
                                        lastRowIndex.current >= 0 &&
                                        lastRowIndex.current !== rowIndex
                                      ) {
                                        const from = Math.min(
                                          lastRowIndex.current,
                                          rowIndex,
                                        );
                                        const to = Math.max(
                                          lastRowIndex.current,
                                          rowIndex,
                                        );
                                        const range = visibleMessages
                                          .slice(from, to + 1)
                                          .map((item) => item.id);
                                        setChecked((ids) =>
                                          Array.from(
                                            new Set([...ids, ...range]),
                                          ),
                                        );
                                        return;
                                      }
                                      lastRowIndex.current = rowIndex;
                                      void openMail(m);
                                    }}
                                  >
                                    <div className="row-top">
                                      <span className="sender-name">
                                        {senderName(m.sender)}
                                      </span>
                                      <time dateTime={m.date}>
                                        {time(m.date)}
                                      </time>
                                    </div>
                                    <div className="row-subject">
                                      {!m.isRead && (
                                        <i aria-label="未读" title="未读" />
                                      )}
                                      <span className="row-subject-text">
                                        {m.subject}
                                      </span>
                                      {grouped &&
                                        (m.conversationCount || 0) > 1 && (
                                          <Badge
                                            variant="secondary"
                                            className="conversation-count"
                                          >
                                            {m.conversationCount}
                                          </Badge>
                                        )}
                                    </div>
                                    <p>{m.preview}</p>
                                    <div className="row-meta">
                                      <span
                                        className={`mini-dot color-${data.accounts.findIndex((a) => a.id === m.accountId) % 4}`}
                                        aria-hidden="true"
                                        title="邮箱颜色标识"
                                      />
                                      <span>
                                        {data.accounts.find(
                                          (a) => a.id === m.accountId,
                                        )?.name || "已移除账号"}
                                      </span>
                                      {m.localFolder !== "全部存档" && (
                                        <small>{m.localFolder}</small>
                                      )}
                                      {m.hasAttachments && (
                                        <Paperclip size={12} />
                                      )}
                                      <span className="row-spacer" />
                                      {m.starred && (
                                        <Star size={13} className="star-on" />
                                      )}
                                    </div>
                                  </Button>
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-56">
                                {menuKind === "trash" ? (
                                  <>
                                    {anyTrashed && (
                                      <ContextMenuItem
                                        onSelect={() =>
                                          void mutate(
                                            menuIds,
                                            "trash",
                                            "false",
                                            grouped,
                                          )
                                        }
                                      >
                                        <Undo2 />
                                        从废纸篓恢复
                                      </ContextMenuItem>
                                    )}
                                    <ContextMenuItem
                                      variant="destructive"
                                      onSelect={() =>
                                        void mutate(
                                          menuIds,
                                          "delete",
                                          "true",
                                          grouped,
                                        )
                                      }
                                    >
                                      <Trash2 />
                                      彻底删除（含服务器）
                                    </ContextMenuItem>
                                  </>
                                ) : (
                                  <>
                                    {menuKind === "received" ? (
                                      <>
                                        <ContextMenuItem
                                          onSelect={() => compose(m)}
                                        >
                                          <Reply />
                                          回复
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.reply}
                                          </ContextMenuShortcut>
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onSelect={() =>
                                            compose(m, false, true)
                                          }
                                        >
                                          <ReplyAll />
                                          回复全部
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.replyAll}
                                          </ContextMenuShortcut>
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onSelect={() => compose(m, true)}
                                        >
                                          <Forward />
                                          转发
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.forward}
                                          </ContextMenuShortcut>
                                        </ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuCheckboxItem
                                          checked={allStarred}
                                          onSelect={() =>
                                            void mutate(
                                              menuIds,
                                              "star",
                                              String(!allStarred),
                                              grouped,
                                            )
                                          }
                                        >
                                          星标
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.star}
                                          </ContextMenuShortcut>
                                        </ContextMenuCheckboxItem>
                                        <ContextMenuCheckboxItem
                                          checked={allRead}
                                          onSelect={() =>
                                            void mutate(
                                              menuIds,
                                              "read",
                                              String(!allRead),
                                              grouped,
                                            )
                                          }
                                        >
                                          已读
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.read}
                                          </ContextMenuShortcut>
                                        </ContextMenuCheckboxItem>
                                      </>
                                    ) : (
                                      <>
                                        <ContextMenuItem
                                          onSelect={() => void reeditSent(m)}
                                        >
                                          <SquarePen />
                                          重新编辑
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onSelect={() => compose(m, true)}
                                        >
                                          <Forward />
                                          转发
                                          <ContextMenuShortcut>
                                            {mailShortcutKeys.forward}
                                          </ContextMenuShortcut>
                                        </ContextMenuItem>
                                      </>
                                    )}
                                    <ContextMenuSeparator />
                                    <ContextMenuSub>
                                      <ContextMenuSubTrigger>
                                        <FolderInput />
                                        移动到文件夹
                                      </ContextMenuSubTrigger>
                                      <ContextMenuSubContent className="w-56">
                                        {!move ? (
                                          <ContextMenuItem disabled>
                                            请选择同一账号的邮件
                                          </ContextMenuItem>
                                        ) : move.targets.length ? (
                                          <>
                                            <ContextMenuLabel>
                                              {move.server
                                                ? "服务器文件夹"
                                                : "本机归档目录"}{" "}
                                              · {move.accountName}
                                            </ContextMenuLabel>
                                            {move.targets.map((target) => (
                                              <ContextMenuItem
                                                key={target.name}
                                                onSelect={() =>
                                                  void moveToFolder(
                                                    menuIds,
                                                    move.accountId,
                                                    target.name,
                                                    target.label,
                                                    move.server,
                                                  )
                                                }
                                              >
                                                <Folder />
                                                {target.label}
                                              </ContextMenuItem>
                                            ))}
                                          </>
                                        ) : (
                                          <ContextMenuItem disabled>
                                            {move.server
                                              ? "没有可用的服务器文件夹"
                                              : "该账号暂无本地归档目录"}
                                          </ContextMenuItem>
                                        )}
                                      </ContextMenuSubContent>
                                    </ContextMenuSub>
                                    {menuKind === "received" && (
                                      <ContextMenuItem
                                        onSelect={() =>
                                          void queueArchives(menuIds, grouped)
                                        }
                                      >
                                        <HardDriveDownload />
                                        完整保存到本地
                                      </ContextMenuItem>
                                    )}
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      onSelect={() =>
                                        void mutate(
                                          menuIds,
                                          "trash",
                                          "true",
                                          grouped,
                                        )
                                      }
                                    >
                                      <Trash2 />
                                      移到本地废纸篓
                                    </ContextMenuItem>
                                  </>
                                )}
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })
                      ) : (
                        <div className="list-empty">
                          <Inbox size={30} />
                          <h3>
                            {search
                              ? "没有找到邮件"
                              : data.accounts.length
                                ? "这里很安静"
                                : "收件箱准备好了"}
                          </h3>
                          <p>
                            {search
                              ? "试试其他关键词。"
                              : data.accounts.length
                                ? "点击上方刷新，收取新的邮件。"
                                : "连接邮箱后，邮件会出现在这里。"}
                          </p>
                        </div>
                      )}
                      {data.nextCursor && (
                        <Button
                          variant="ghost"
                          className="load-more"
                          onClick={() => void loadNextPage()}
                          disabled={pageLoading}
                          aria-busy={pageLoading}
                        >
                          {pageLoading
                            ? "正在加载…"
                            : `加载更多（${data.messages.length} / ${data.matched}）`}
                        </Button>
                      )}
                    </ScrollPane>
                  </div>
                </section>
              }
            >
              <section className="reader">
                {detail ? (
                  <>
                    <div className="message-heading">
                      <div className="sender-line">
                        <div className="sender-block">
                          <span className="sender-avatar">
                            {senderName(detail.mail.sender).slice(0, 1)}
                          </span>
                          <div>
                            <strong>{senderName(detail.mail.sender)}</strong>
                            <span>{senderAddress(detail.mail.sender)}</span>
                          </div>
                        </div>
                        <div className="reader-toolbar">
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="上一封邮件"
                                  aria-busy={navigationLoading}
                                  disabled={
                                    navigationLoading ||
                                    !canNavigate("previous")
                                  }
                                  onClick={() =>
                                    void navigateReading("previous")
                                  }
                                >
                                  <ArrowLeft size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {navigationLoading
                                  ? "正在查找相邻邮件…"
                                  : "上一封邮件（⌥↑）"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="下一封邮件"
                                  aria-busy={navigationLoading}
                                  disabled={
                                    navigationLoading || !canNavigate("next")
                                  }
                                  onClick={() => void navigateReading("next")}
                                >
                                  <ArrowRight size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {navigationLoading
                                  ? "正在查找相邻邮件…"
                                  : "下一封邮件（⌥↓）"}
                              </TooltipContent>
                              {navigationLoading && (
                                <span className="sr-only" role="status">
                                  正在查找相邻邮件…
                                </span>
                              )}
                            </Tooltip>
                            <span className="toolbar-divider" />
                            {(() => {
                              const move = moveTargets([detail.mail]);
                              return (
                                <MoveToFolderMenu
                                  accountName={move?.accountName}
                                  server={move?.server ?? false}
                                  targets={move?.targets ?? []}
                                  reason={
                                    !move
                                      ? "无法移动这封邮件"
                                      : move.targets.length
                                        ? undefined
                                        : move.server
                                          ? "没有可用的服务器文件夹"
                                          : "该账号暂无本地归档目录"
                                  }
                                  onSelect={(target) =>
                                    move &&
                                    void moveToFolder(
                                      [detail.mail.id],
                                      move.accountId,
                                      target.name,
                                      target.label,
                                      move.server,
                                    )
                                  }
                                >
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title="移动到文件夹"
                                  >
                                    <Folder size={17} />
                                  </Button>
                                </MoveToFolderMenu>
                              );
                            })()}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="导出完整原始邮件"
                              onClick={() => void exportMail(detail.mail)}
                            >
                              <ArrowDownToLine size={17} />
                            </Button>
                            <span className="toolbar-divider" />
                            <MailActionTooltip
                              action="read"
                              label={
                                detail.mail.isRead ? "标记未读" : "标记已读"
                              }
                            >
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title={
                                  detail.mail.isRead ? "标记未读" : "标记已读"
                                }
                                aria-keyshortcuts="Meta+Shift+U Control+Shift+U"
                                onClick={() =>
                                  void mutate(
                                    [detail.mail.id],
                                    "read",
                                    String(!detail.mail.isRead),
                                  )
                                }
                              >
                                <MailOpen size={17} />
                              </Button>
                            </MailActionTooltip>
                            <MailActionTooltip action="star" label="星标">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="星标"
                                aria-keyshortcuts="Meta+Shift+L Control+Shift+L"
                                onClick={() =>
                                  void mutate(
                                    [detail.mail.id],
                                    "star",
                                    String(!detail.mail.starred),
                                  )
                                }
                              >
                                <Star
                                  size={17}
                                  className={
                                    detail.mail.starred ? "star-on" : ""
                                  }
                                />
                              </Button>
                            </MailActionTooltip>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="打印这封邮件"
                              aria-label="打印这封邮件"
                              onClick={() =>
                                void printMail(detail).catch((error) =>
                                  toast.error(`打印失败：${String(error)}`),
                                )
                              }
                            >
                              <Printer size={17} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={
                                detail.mail.trashed
                                  ? "恢复本地邮件"
                                  : "移到本地废纸篓"
                              }
                              onClick={() =>
                                void mutate(
                                  [detail.mail.id],
                                  "trash",
                                  String(!detail.mail.trashed),
                                )
                              }
                            >
                              {detail.mail.trashed ? (
                                <Undo2 size={17} />
                              ) : (
                                <Trash2 size={17} />
                              )}
                            </Button>
                          </div>
                          <div className="reader-actions">
                            <MailActionTooltip action="reply" label="回复">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="回复"
                                title="回复"
                                aria-keyshortcuts="Meta+R Control+R"
                                onClick={() => compose(detail.mail)}
                              >
                                <Reply size={15} />
                                <span className="action-label">回复</span>
                              </Button>
                            </MailActionTooltip>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title="更多回复操作"
                                  aria-label="更多回复操作"
                                >
                                  <ChevronDown size={12} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
                                    onClick={() =>
                                      compose(detail.mail, false, true)
                                    }
                                  >
                                    <ReplyAll size={15} />
                                    全部回复
                                    <DropdownMenuShortcut>
                                      {mailShortcutKeys.replyAll}
                                    </DropdownMenuShortcut>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      const address = parseAddresses(
                                        detail.mail.sender,
                                      )[0];
                                      if (!address) {
                                        toast.error("无法识别发件人邮箱地址");
                                        return;
                                      }
                                      setContactSeed(address);
                                      setPage("contacts");
                                    }}
                                  >
                                    <UsersRound size={15} />
                                    添加发件人为联系人
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <MailActionTooltip action="forward" label="转发">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="转发"
                                title="转发"
                                aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
                                onClick={() => compose(detail.mail, true)}
                              >
                                <ArrowRight size={15} />
                                <span className="action-label">转发</span>
                              </Button>
                            </MailActionTooltip>
                            {own(detail.mail) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="重新编辑"
                                title="修改这封已发送邮件的内容，作为新邮件再次发送"
                                onClick={() => void reeditSent(detail.mail)}
                              >
                                <SquarePen size={15} />
                                <span className="action-label">重新编辑</span>
                              </Button>
                            )}
                            {(["copy", "move"] as const).map((kind) => (
                              <ServerDirectoryMenu
                                key={kind}
                                mail={detail.mail}
                                kind={kind}
                                view={query.view}
                                remoteFolder={query.remoteFolder}
                                disabled={
                                  !data.accounts.some(
                                    (a) =>
                                      a.id === detail.mail.accountId &&
                                      a.enabled &&
                                      a.protocol === "imap",
                                  )
                                }
                              />
                            ))}
                          </div>
                          <span className="toolbar-divider" />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="reader-expand-button"
                            aria-label={
                              readerExpanded ? "还原阅读区域" : "最大化阅读区域"
                            }
                            title={
                              readerExpanded
                                ? "还原阅读区域（Esc）"
                                : "最大化阅读区域"
                            }
                            aria-pressed={readerExpanded}
                            aria-controls="mail-reader-content"
                            onClick={() => setReaderExpanded((value) => !value)}
                          >
                            {readerExpanded ? (
                              <Minimize2 size={16} />
                            ) : (
                              <Maximize2 size={16} />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="recipient-line">
                        {detail.mail.recipients.trim() && (
                          <span
                            className="recipient-address"
                            title={detail.mail.recipients}
                          >
                            收件人：{detail.mail.recipients}
                          </span>
                        )}
                        <div className="message-metadata">
                          <time dateTime={detail.mail.date}>
                            {time(detail.mail.date)}
                          </time>
                          <span className="saved-chip">
                            <ShieldCheck size={13} />
                            {demo
                              ? "演示存档"
                              : detail.mail.savedLocally === false
                                ? "服务器邮件"
                                : "完整已保存"}
                          </span>
                          {detail.mail.savedLocally === false && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={archiving}
                              onClick={() =>
                                void queueArchives([detail.mail.id])
                              }
                            >
                              <HardDriveDownload />
                              完整保存到本地
                            </Button>
                          )}
                        </div>
                      </div>
                      <h1>{detail.mail.subject}</h1>
                    </div>
                    <ConversationReader
                      key={`${selected}:${query.listMode}`}
                      selected={detail}
                      singleMessage={!grouped}
                      revision={data.messages}
                      accounts={data.accounts}
                      demo={demo}
                      scrollRef={readerRef}
                      editorOpen={!!draft}
                      onReply={(source, forward = false, all = false) =>
                        compose(source.mail, forward, all, source)
                      }
                      onEdit={setDraft}
                      onSent={() => void refresh()}
                      onExport={(mail) => void exportMail(mail)}
                      onAttachment={(mail, index, name) =>
                        attachment(index, name, mail)
                      }
                      onAction={(mail, action, value) =>
                        action === "save"
                          ? void queueArchives([mail.id])
                          : void mutate([mail.id], action, value, false, [mail])
                      }
                      onLink={(href) =>
                        void openMailLink(href).catch((e) =>
                          toast.error(String(e)),
                        )
                      }
                    />
                  </>
                ) : selected ? (
                  <div
                    className={`reader-loading ${detailError?.id === selected ? "" : "reader-loading-skeleton"}`}
                    role="status"
                    aria-live="polite"
                  >
                    {detailError?.id === selected ? (
                      <>
                        <AlertCircle size={24} />
                        <span>邮件加载失败</span>
                        <p>{detailError.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailRetry((value) => value + 1)}
                        >
                          重新加载
                        </Button>
                      </>
                    ) : (
                      <>
                        <MailReaderSkeleton />
                      </>
                    )}
                  </div>
                ) : (
                  <div className="reader-welcome">
                    <div className="welcome-art">
                      <img src="/app-icon.png" alt="雁信" />
                      <span className="orbit one" />
                      <span className="orbit two" />
                      <span className="art-dot dot-one" />
                      <span className="art-dot dot-two" />
                    </div>
                    <span className="eyebrow">
                      A CALMER PLACE FOR YOUR MAIL
                    </span>
                    <h1>
                      {data.accounts.length
                        ? "留一点空间，给重要的事"
                        : "邮件，自在有序。"}
                    </h1>
                    <p>
                      {data.accounts.length
                        ? "选择一封邮件，开始阅读。\n你的往来，都在这里妥善留存。"
                        : "把不同的邮箱放在一起。\n让每一封重要的邮件，都有一个长久的归处。"}
                    </p>
                    {!data.accounts.length && (
                      <div className="welcome-actions">
                        <Button onClick={() => setAccountDialog(true)}>
                          <Plus size={16} />
                          连接我的邮箱
                        </Button>
                        <Button variant="ghost" onClick={demoMode}>
                          先体验一下
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    )}
                    <div className="welcome-features">
                      <span>
                        <Inbox size={17} />
                        多账号管理
                      </span>
                      <span>
                        <SlidersHorizontal size={17} />
                        自动归类
                      </span>
                      <span>
                        <ShieldCheck size={17} />
                        本地留存
                      </span>
                    </div>
                    {!native && (
                      <small className="browser-note">
                        浏览器预览 · 真实收发请使用 macOS 桌面客户端
                      </small>
                    )}
                  </div>
                )}
              </section>
            </MailLayout>
          )}
        </SidebarInset>
      </NavigationLayout>
      <FolderMappingDialog
        account={mappingAccount}
        onClose={() => setMappingAccount(null)}
        onSaved={() => void refresh()}
      />
      <RetentionDialog
        account={retentionAccount}
        onboarding={retentionIntro}
        onClose={() => setRetentionAccount(null)}
        onSaved={() => void refresh()}
      />
      <RemoveAccountDialog
        account={removingAccount}
        open={!!removingAccount}
        onOpenChange={(open) => {
          if (!open) setRemovingAccount(null);
        }}
        onRemoved={() => {
          setSelected("");
          setDetail(null);
          void refresh();
        }}
      />
      <AccountDialog
        open={accountDialog}
        editing={editingAccount}
        onOpenChange={(open) => {
          setAccountDialog(open);
          if (!open) setEditingAccount(null);
        }}
        onDone={(connected) => {
          void refresh();
          void sync();
          if (connected) {
            setRetentionIntro(true);
            setRetentionAccount(connected);
          }
        }}
      />
      <ComposeDialog
        draft={draft}
        onClose={() => setDraft(null)}
        accounts={data.accounts}
        onSent={() => void refresh()}
        onBackground={(queued, seconds) => {
          setDraft(null);
          setPendingSend({ draft: queued, seconds });
        }}
      />
      {pendingSend && (
        <PendingSend
          draft={pendingSend.draft}
          seconds={pendingSend.seconds}
          onDone={() => {
            setPendingSend(null);
            void refresh();
            if (page === "drafts") void showDrafts();
          }}
          onCancel={() => {
            // 撤回只放弃这次发送；邮件已在点发送时存为草稿，从草稿箱继续
            setPendingSend(null);
            setDraft(pendingSend.draft);
          }}
        />
      )}
      {confirmationDialog}
      {folderDialog && (
        <Dialog open onOpenChange={(open) => !open && setFolderDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {folderDialog.mode === "create"
                  ? "新建服务器文件夹"
                  : "删除文件夹"}
              </DialogTitle>
              <DialogDescription>
                {folderDialog.mode === "create"
                  ? "将直接在 IMAP 服务器上创建，所有设备可见。"
                  : `将在服务器上永久删除「${folderDialog.name}」，此操作不可恢复。`}
              </DialogDescription>
            </DialogHeader>
            {folderDialog.mode === "create" && (
              <div className="space-y-2">
                <Label htmlFor="new-folder-name">文件夹名称</Label>
                <Input
                  id="new-folder-name"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="例如：项目归档"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFolderDialog(null)}>
                取消
              </Button>
              <Button
                variant={
                  folderDialog.mode === "delete" ? "destructive" : "default"
                }
                disabled={folderDialog.mode === "create" && !folderName.trim()}
                onClick={() => {
                  const d = folderDialog;
                  void (async () => {
                    try {
                      await call(
                        d.mode === "create" ? "create_folder" : "delete_folder",
                        d.mode === "create"
                          ? { id: d.accountId, name: folderName.trim() }
                          : { id: d.accountId, name: d.name ?? "" },
                      );
                      await refresh();
                      toast.success(
                        d.mode === "create" ? "文件夹已创建" : "文件夹已删除",
                      );
                    } catch (e) {
                      toast.error(String(e));
                    }
                  })();
                  setFolderDialog(null);
                }}
              >
                {folderDialog.mode === "create" ? "创建" : "删除"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <UpdateDialog updates={updates} blocked={!!draft} />
    </SidebarProvider>
  );
}
