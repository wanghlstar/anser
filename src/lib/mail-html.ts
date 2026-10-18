import DOMPurify from "dompurify";
import { normalizeMailSpacers } from "./mail-image-decorations";
/** 预览主题色：iframe 是独立文档，解析不到外层的 CSS 变量，必须传字面量。 */
export type PreviewTheme = { foreground: string; background: string };
export function safeMailHtml(
  html: string,
  documentId = "yanxin-mail",
  nativeNavigation = false,
  /** 预览场景跟随外层明暗主题；真实邮件正文保持原样（邮件自身样式优先）。 */
  theme?: PreviewTheme,
) {
  const content = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "svg",
      "math",
      "base",
      "meta",
      "link",
    ],
    FORBID_ATTR: ["action", "formaction", "data-mail-href"],
  });
  const doc = new DOMParser().parseFromString(content, "text/html");
  // Legacy mail often embeds HTTP image/font URLs. Upgrade resource references
  // before WKWebView evaluates ATS; keep navigation links exactly as authored.
  for (const element of doc.querySelectorAll(
    "[src], [srcset], [background], [style]",
  )) {
    for (const attr of ["src", "srcset", "background", "style"]) {
      const value = element.getAttribute(attr);
      if (value) {
        let resource = secureResources(value);
        if (attr === "src" || attr === "background")
          resource = resource.replace(/^\/\//, "https://");
        if (attr === "srcset")
          resource = resource.replace(/(^|[\s,])\/\//g, "$1https://");
        element.setAttribute(attr, resource);
      }
    }
  }
  for (const style of doc.querySelectorAll("style")) {
    style.textContent = secureResources(style.textContent || "");
  }
  normalizeMailSpacers(doc);
  // 正文帧现在带 allow-scripts（只为让 WebKit 派发帧内监听器），帧内点击会
  // 拦下导航并把原始 URL 交回应用；原生路由留给导航代理兜底，浏览器端则先把
  // href 换成占位符，免得监听器接管之前就跳走。
  for (const anchor of doc.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") || "";
    anchor.removeAttribute("target");
    anchor.removeAttribute("download");
    if (href.startsWith("#")) continue;
    const url = mailLink(href);
    if (url) {
      anchor.setAttribute("data-mail-href", href);
      anchor.setAttribute(
        "href",
        nativeNavigation
          ? `https://yanxin-mail-link.invalid/open?url=${encodeURIComponent(url.href)}`
          : "#",
      );
      anchor.setAttribute("rel", "noopener noreferrer");
    } else anchor.removeAttribute("href");
  }
  const marker = doc.createElement("meta");
  marker.name = "yanxin-mail-document";
  marker.content = documentId;
  doc.head.prepend(marker);
  // break-word wraps long prose/URLs without reducing table cells' min-content
  // width to one character (anywhere squeezes narrow status/header columns).
  // Keep original head styles and body classes; insert our policy before them.
  // A body-only sanitizer otherwise drops leading styles in HTML email fragments.
  // 预览场景用主题变量跟随明暗；真实邮件正文保持白底深字，邮件样式优先。
  const colors = theme
    ? `color:${theme.foreground};background:${theme.background}`
    : "color:#242424;background:#fff";
  doc.head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:; upgrade-insecure-requests; base-uri 'none'; form-action 'none'"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;${colors};margin:0;padding:0;overflow-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`,
  );
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

function secureResources(value: string) {
  return value
    .replace(/\bhttp:\/\//gi, "https://")
    .replace(/(url\(\s*["']?)\/\//gi, "$1https://");
}

export function mailLink(href: string): URL | null {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function isMailDocument(
  doc: Document | null | undefined,
  documentId: string,
) {
  return (
    doc
      ?.querySelector('meta[name="yanxin-mail-document"]')
      ?.getAttribute("content") === documentId
  );
}

/// iframe 里的元素来自另一个 realm：`instanceof Element` / `instanceof
/// HTMLImageElement` 对它们一律是 false（跨 realm 原型不同）。只能用
/// nodeType/tagName 这类跨 realm 安全的判断，否则帧内所有图片交互都会静默失效。
export function frameImageTarget(
  node: EventTarget | null,
): HTMLImageElement | null {
  const element = node as Node | null;
  if (!element || element.nodeType !== 1) return null;
  const image = (element as Element).closest("img");
  return image && image.tagName === "IMG" ? (image as HTMLImageElement) : null;
}
export function interceptMailLinks(
  doc: Document,
  onOpen: (href: string) => void,
) {
  const clicked = (event: MouseEvent) => {
    const node = event.target as Node | null;
    const target =
      node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    const anchor = target?.closest("a");
    if (!anchor) return;
    const href =
      anchor.getAttribute("data-mail-href") ||
      anchor.getAttribute("href") ||
      "";
    if (href.startsWith("#")) return;
    event.preventDefault();
    if (event.button > 1) return;
    const url = mailLink(href);
    if (url) onOpen(url.href);
  };
  doc.addEventListener("click", clicked, true);
  doc.addEventListener("auxclick", clicked, true);
  return () => {
    doc.removeEventListener("click", clicked, true);
    doc.removeEventListener("auxclick", clicked, true);
  };
}
