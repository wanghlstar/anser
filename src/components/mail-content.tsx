import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { MailBodySkeleton } from "./mail-skeleton";
import { disableNativeContextMenu } from "../lib/context-menu";
import {
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

export function MailContent({
  html,
  onOpenLink,
  title = "邮件正文",
  flush,
  themed = false,
}: {
  html: string;
  onOpenLink: (href: string) => void;
  title?: string;
  flush?: boolean;
  themed?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const initialized = useRef<Document | null>(null);
  const flushPreview = useRef(flush);
  flushPreview.current = flush;
  const [ready, setReady] = useState(false);
  const [pendingImages, setPendingImages] = useState(0);
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
    setPendingImages(0);
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
    const scheduleResize = () => {
      setPendingImages(
        [...doc.images].filter((image) => !image.complete).length,
      );
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
    doc.addEventListener("load", scheduleResize, true);
    doc.addEventListener("error", scheduleResize, true);
    resize();
    setPendingImages([...doc.images].filter((image) => !image.complete).length);
    setReady(true);
    cleanup.current = () => {
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      mutations.disconnect();
      restoreContextMenu();
      restoreLinks();
      doc.removeEventListener("load", scheduleResize, true);
      doc.removeEventListener("error", scheduleResize, true);
    };
  }
  return (
    <div
      className="mail-html-container"
      aria-busy={!ready || pendingImages > 0}
    >
      {(!ready || pendingImages > 0) && <MailBodySkeleton images={ready} />}
      <iframe
        ref={frame}
        className={cn("mail-html", themed && "mail-html-themed")}
        title={title}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={loaded}
      />
    </div>
  );
}
