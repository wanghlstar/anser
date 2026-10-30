import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MailBodySkeleton } from "./mail-skeleton";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { call } from "../lib/api";
import { disableNativeContextMenu } from "../lib/context-menu";
import { watchMailImages, type MailImageStatus } from "../lib/mail-images";
import {
  frameImageTarget,
  interceptMailLinks,
  isMailDocument,
  safeMailHtml,
  type PreviewTheme,
} from "../lib/mail-html";
import { mailDocumentHeight } from "../lib/mail-layout";

/// iframe 是独立文档，拿不到外层 CSS 变量，只能读计算后的字面量色值。
function previewTheme(): PreviewTheme | undefined {
  if (typeof window === "undefined") return undefined;
  const style = getComputedStyle(document.documentElement);
  const foreground = style.getPropertyValue("--foreground").trim();
  const background = style.getPropertyValue("--background").trim();
  if (!foreground || !background) return undefined;
  return { foreground, background };
}

const HIGHLIGHT_MARK = "yanxin-search-hit";

/// iframe 内只操作文本节点，保留邮件原有 HTML；切换搜索词时先还原再重新标记。
export function applySearchHighlight(doc: Document, query: string) {
  if (!doc.body) return;
  for (const mark of doc.querySelectorAll(`mark[data-${HIGHLIGHT_MARK}]`)) {
    mark.replaceWith(doc.createTextNode(mark.textContent || ""));
  }
  const term = query.trim();
  if (!term || term.length > 200) {
    doc.body.normalize();
    return;
  }
  const needle = term.toLocaleLowerCase();
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (
      !node.data.trim() ||
      node.parentElement?.closest("script,style,noscript,textarea,mark")
    )
      continue;
    if (node.data.toLocaleLowerCase().includes(needle)) nodes.push(node);
  }
  let marks = 0;
  for (const node of nodes) {
    if (marks >= 500) break;
    const text = node.data;
    const lower = text.toLocaleLowerCase();
    const fragment = doc.createDocumentFragment();
    let start = 0;
    while (marks < 500) {
      const index = lower.indexOf(needle, start);
      if (index < 0) break;
      if (index > start)
        fragment.append(doc.createTextNode(text.slice(start, index)));
      const mark = doc.createElement("mark");
      mark.className = "search-hit";
      mark.setAttribute(`data-${HIGHLIGHT_MARK}`, "1");
      mark.textContent = text.slice(index, index + term.length);
      mark.style.background = "#ffe58f";
      mark.style.color = "#3b2f00";
      mark.style.padding = "0 1px";
      mark.style.borderRadius = "2px";
      fragment.append(mark);
      start = index + term.length;
      marks += 1;
    }
    if (start < text.length)
      fragment.append(doc.createTextNode(text.slice(start)));
    node.replaceWith(fragment);
  }
  doc.body.normalize();
}

export function MailContent({
  html,
  onOpenLink,
  onInteract,
  title = "邮件正文",
  flush,
  themed = false,
  highlight = "",
}: {
  html: string;
  onOpenLink: (href: string) => void;
  onInteract?: () => void;
  title?: string;
  flush?: boolean;
  themed?: boolean;
  highlight?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const initialized = useRef<Document | null>(null);
  const interact = useRef(onInteract);
  interact.current = onInteract;
  const flushPreview = useRef(flush);
  flushPreview.current = flush;
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState<MailImageStatus>({
    waiting: 0,
    timedOut: 0,
    failed: 0,
  });
  const retryImages = useRef(() => {});
  const [imageMenu, setImageMenu] = useState<string | null>(null);
  const imageMenuAnchor = useRef({ x: -1, y: -1 });
  const selectedImage = useRef<{
    el: HTMLElement;
    outline: string;
    outlineOffset: string;
  } | null>(null);
  function clearImageSelection() {
    const current = selectedImage.current;
    if (!current) return;
    current.el.style.outline = current.outline;
    current.el.style.outlineOffset = current.outlineOffset;
    selectedImage.current = null;
  }
  function selectImage(el: HTMLElement) {
    if (selectedImage.current?.el === el) return;
    clearImageSelection();
    const outline = el.style.outline;
    const outlineOffset = el.style.outlineOffset;
    el.style.outline = "2px solid #3b82f6";
    // 往内画：outline 默认画在边框盒外，图片贴着 iframe 左边时左侧那条会被
    // 帧边界裁掉，用户只看到三面框。
    el.style.outlineOffset = "-2px";
    selectedImage.current = { el, outline, outlineOffset };
  }
  function imageName(src: string) {
    if (src.startsWith("data:")) return "图片.png";
    try {
      return (
        decodeURIComponent(new URL(src).pathname.split("/").pop() || "") ||
        "图片.png"
      );
    } catch {
      return "图片.png";
    }
  }
  async function copyImage(src: string) {
    if (!isTauri()) {
      toast.info("请在桌面客户端中复制图片");
      return;
    }
    try {
      // WKWebView 里 navigator.clipboard.write 会抛 NotAllowedError（用户实测），
      // 复制图片统一走原生 NSPasteboard。
      await call("copy_mail_image", { url: src });
      toast.success("图片已复制");
    } catch (e) {
      toast.error(`复制图片失败：${String(e)}`);
    }
  }
  async function saveImage(src: string) {
    if (!isTauri()) {
      toast.info("请在桌面客户端中保存图片");
      return;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: imageName(src) });
      if (!path) return;
      await call("save_mail_image", { url: src, path });
      toast.success("图片已保存");
    } catch (e) {
      toast.error(`保存图片失败：${String(e)}`);
    }
  }
  async function openImage(src: string) {
    if (!isTauri()) {
      toast.info("请在桌面客户端中打开图片");
      return;
    }
    try {
      await call("save_mail_image", { url: src, path: null });
    } catch (e) {
      toast.error(`打开图片失败：${String(e)}`);
    }
  }
  // 主题切换要重建 srcDoc：iframe 是独立文档，色值只能在生成时注入。
  const [theme, setTheme] = useState(themed ? previewTheme() : undefined);
  useEffect(() => {
    if (!themed) {
      setTheme(undefined);
      return;
    }
    setTheme(previewTheme());
    const observer = new MutationObserver(() => setTheme(previewTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [themed]);
  const content = useMemo(() => {
    const id = crypto.randomUUID();
    return {
      id,
      srcDoc: safeMailHtml(html, id, isTauri(), theme),
    };
  }, [html, theme]);
  const srcDoc = content.srcDoc;
  const open = useRef(onOpenLink);
  open.current = onOpenLink;
  useEffect(() => {
    setReady(false);
    setImages({ waiting: 0, timedOut: 0, failed: 0 });
    retryImages.current = () => {};
    initialized.current = null;
    cleanup.current();
    // DOM can be readable before onLoad, which waits for every remote image.
    let pending = 0;
    const waitForDocument = () => {
      const doc = frame.current?.contentDocument;
      if (
        doc &&
        isMailDocument(doc, content.id) &&
        doc.readyState !== "loading"
      )
        loaded();
      else pending = requestAnimationFrame(waitForDocument);
    };
    pending = requestAnimationFrame(waitForDocument);
    return () => {
      cancelAnimationFrame(pending);
      cleanup.current();
    };
  }, [srcDoc]);
  useEffect(() => {
    if (!ready) return;
    const doc = frame.current?.contentDocument;
    if (doc && isMailDocument(doc, content.id)) {
      try {
        applySearchHighlight(doc, highlight);
      } catch (error) {
        // 高亮失败不能把邮件阅读器一起拖垮；保留原文即可。
        console.error("search highlight failed", error);
      }
    }
  }, [ready, highlight, content.id]);

  function loaded() {
    const iframe = frame.current;
    const doc = iframe?.contentDocument;
    if (
      !iframe ||
      !doc?.body ||
      !isMailDocument(doc, content.id) ||
      initialized.current === doc
    )
      return;
    cleanup.current();
    initialized.current = doc;
    // Email templates often declare html/body height:100%. Force content
    // height so resizing the frame cannot grow its own measurement forever.
    for (const element of [doc.documentElement, doc.body]) {
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("min-height", "0", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
    }
    // The frame is grown to its measured content height. A temporary vertical
    // scrollbar would narrow the body while measuring, change wrapping, then
    // disappear after the frame grows — the lower half could oscillate near a
    // wrap boundary. Keep horizontal overflow scrollable and hide only Y.
    doc.documentElement.style.setProperty("overflow-x", "auto", "important");
    doc.documentElement.style.setProperty("overflow-y", "hidden", "important");
    // Keep the usual block layout, while containing collapsed margins and
    // floats in the measured body. Preserve templates with custom flex/grid.
    if (doc.defaultView?.getComputedStyle(doc.body).display === "block")
      doc.body.style.setProperty("display", "flow-root", "important");
    // 紧贴预览（问候语/签名）：清掉邮件模板自带的 body 边距，测高也不再加进去。
    if (flushPreview.current)
      doc.body.style.setProperty("margin", "0", "important");
    const resize = () => {
      const height = `${mailDocumentHeight(doc)}px`;
      if (iframe.style.height !== height) iframe.style.height = height;
    };
    let pendingResize = 0;
    const nativeFrame = isTauri();
    const imageTracker = watchMailImages(
      doc,
      (status) => {
        setImages(status);
        resize();
      },
      !nativeFrame,
    );
    retryImages.current = imageTracker.retry;
    const scheduleResize = () => {
      imageTracker.refresh();
      cancelAnimationFrame(pendingResize);
      pendingResize = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(doc.body);
    observer.observe(iframe);
    const mutations = new MutationObserver(scheduleResize);
    mutations.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const restoreContextMenu = disableNativeContextMenu(doc);
    const restoreLinks = interceptMailLinks(doc, (href) => open.current(href));
    // 图片交互：右键弹自定义菜单（复制/保存），左键选中带框，⌘C 复制，双击交系统应用打开。
    const onPointer = (event: MouseEvent) => {
      const img = frameImageTarget(event.target);
      // iframe 事件不会冒泡到主文档：点正文时同时清掉外层阅读头的文字选区，
      // 否则从主题拖选到发件人后，点正文不会取消黑色选区。
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      // 点正文就把邮件列表的勾选放开：iframe 里的按键/点击传不到外层，
      // 只能从这里转出去。
      interact.current?.();
      setImageMenu(null);
      if (img) selectImage(img);
      else clearImageSelection();
    };
    const onContext = (event: MouseEvent) => {
      const img = frameImageTarget(event.target);
      if (!img) return;
      event.preventDefault();
      selectImage(img);
      const rect = iframe.getBoundingClientRect();
      imageMenuAnchor.current = {
        x: rect.left + event.clientX,
        y: rect.top + event.clientY,
      };
      setImageMenu(img.getAttribute("src") || img.src);
    };
    const onDoubleClick = (event: MouseEvent) => {
      const img = frameImageTarget(event.target);
      if (!img) return;
      // 和 Foxmail 一致：双击正文图片直接交给系统应用打开。
      event.preventDefault();
      selectImage(img);
      void openImage(img.currentSrc || img.src);
    };
    const onKey = (event: KeyboardEvent) => {
      // 焦点在正文里时 Esc 传不到外层，这里代为取消列表勾选。
      if (event.key === "Escape") {
        interact.current?.();
        return;
      }
      const current = selectedImage.current;
      if (
        !current ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "c"
      )
        return;
      event.preventDefault();
      const image = current.el as HTMLImageElement;
      void copyImage(image.currentSrc || image.src);
    };
    doc.addEventListener("mousedown", onPointer, true);
    doc.addEventListener("dblclick", onDoubleClick, true);
    doc.addEventListener("contextmenu", onContext, true);
    doc.addEventListener("keydown", onKey, true);
    if (!nativeFrame) {
      doc.addEventListener("load", scheduleResize, true);
      doc.addEventListener("error", scheduleResize, true);
    }
    resize();
    setReady(true);
    cleanup.current = () => {
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      mutations.disconnect();
      imageTracker.dispose();
      restoreContextMenu();
      retryImages.current = () => {};
      restoreLinks();
      doc.removeEventListener("mousedown", onPointer, true);
      doc.removeEventListener("dblclick", onDoubleClick, true);
      doc.removeEventListener("contextmenu", onContext, true);
      doc.removeEventListener("keydown", onKey, true);
      clearImageSelection();
      setImageMenu(null);
      if (!nativeFrame) {
        doc.removeEventListener("load", scheduleResize, true);
        doc.removeEventListener("error", scheduleResize, true);
      }
    };
  }
  return (
    <div
      className="mail-html-container"
      aria-busy={!ready || images.waiting > 0}
    >
      {(!ready || images.waiting > 0) && <MailBodySkeleton images={ready} />}
      {ready && images.timedOut + images.failed > 0 && (
        <Alert className="mb-2">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {`有 ${images.failed + images.timedOut} 张正文图片未加载（${[
                images.failed > 0 && `${images.failed} 张失败`,
                images.timedOut > 0 && `${images.timedOut} 张超时`,
              ]
                .filter(Boolean)
                .join("，")}）`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => retryImages.current()}
            >
              重新加载图片
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <iframe
        ref={frame}
        className={cn("mail-html", themed && "mail-html-themed")}
        title={title}
        // allow-scripts 只为了让 WebKit 把 frame 内的事件派发出来：没有它，
        // 沙箱帧里的点击/双击/右键/按键监听器一律静默失效（图片选中、双击
        // 打开、自定义右键菜单全部失灵）。正文已经过 DOMPurify 去掉 script
        // 与 on* 事件属性，再加上注入的 CSP（default-src 'none'）兜底，
        // 帧内没有可执行的脚本。
        sandbox="allow-same-origin allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={loaded}
      />
      <DropdownMenu
        open={!!imageMenu}
        onOpenChange={(open) => {
          if (!open) setImageMenu(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            data-slot="mail-image-menu-anchor"
            style={{
              position: "fixed",
              left: imageMenuAnchor.current.x,
              top: imageMenuAnchor.current.y,
              width: 1,
              height: 1,
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem
            onSelect={() => imageMenu && void copyImage(imageMenu)}
          >
            <Copy />
            复制图片
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => imageMenu && void saveImage(imageMenu)}
          >
            <Download />
            保存图片…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
