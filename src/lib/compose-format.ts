import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Compose } from "./types";
import { FONT_DEFAULT, SIZE_DEFAULT } from "./fonts";

export type ComposeFormat = NonNullable<Compose["format"]>;
export function composeFormat(draft: Compose): ComposeFormat {
  return !draft.format || draft.format === "plain" ? "rich" : draft.format;
}

export function hasDraftContent(draft: Compose): boolean {
  if (
    [draft.to, draft.cc, draft.bcc, draft.subject, draft.source].some(
      (text) => !!text?.trim(),
    ) ||
    draft.attachments.length ||
    draft.quote ||
    draft.replyAnchorId ||
    draft.inReplyTo
  )
    return true;
  // 问候语作为正文第一行写进草稿后，只配了问候语没打字就关闭的邮件等同空白邮件，
  // 不自动保存、关闭时直接丢弃（下次打开会重新插入问候语）。
  if (onlyGreeting(draft)) return false;
  if (draft.body.trim()) return true;
  if (!draft.html) return false;
  if (htmlToText(draft.html).trim()) return true;
  const doc = new DOMParser().parseFromString(draft.html, "text/html");
  return !!doc.body.querySelector(MEDIA);
}

const MEDIA = "img,video,audio,svg,canvas,object,embed,iframe,hr";

function onlyGreeting(draft: Compose) {
  const greeting = draft.signature?.greeting?.trim() ?? "";
  if (draft.body.trim() !== greeting) return false;
  if (!draft.html) return true;
  const doc = new DOMParser().parseFromString(draft.html, "text/html");
  if (doc.body.querySelector(MEDIA)) return false;
  // 去掉问候语段与空段落后没有文字，才算正文只剩问候语
  doc.querySelectorAll("[data-yanxin-greeting]").forEach((e) => e.remove());
  doc
    .querySelectorAll("p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6")
    .forEach((e) => {
      if (!e.textContent?.trim()) e.remove();
    });
  const rest = doc.body.textContent?.trim() ?? "";
  return !rest || rest === greeting;
}

export function sanitizeComposeHtml(source: string) {
  return DOMPurify.sanitize(source, {
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
    FORBID_ATTR: ["action", "formaction"],
  });
}
export function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,template,head").forEach((e) => e.remove());
  doc.querySelectorAll("br").forEach((e) => e.replaceWith("\n"));
  doc.querySelectorAll("tr").forEach((row) => {
    const cells = [...row.querySelectorAll("td,th")].map((cell) =>
      (cell.textContent || "").replace(/\s+/g, " ").trim(),
    );
    if (cells.length) row.replaceChildren(doc.createTextNode(cells.join("\t")));
  });
  doc
    .querySelectorAll("img[alt]")
    .forEach((e) => e.replaceWith(e.getAttribute("alt") || ""));
  doc
    .querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote")
    .forEach((e) => e.append("\n"));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
export function compileSource(source: string, format: "markdown" | "html") {
  const markup =
    format === "markdown"
      ? marked.parse(source, { async: false, gfm: true, breaks: true })
      : source;
  let html = sanitizeComposeHtml(markup);
  if (format === "markdown") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.body.style.cssText =
      "font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;font-size:14px;line-height:1.7;color:#242424";
    doc
      .querySelectorAll("table")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border-collapse:collapse;max-width:100%;margin:12px 0",
        ),
      );
    doc
      .querySelectorAll("th,td")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border:1px solid #ddd;padding:8px 12px;text-align:left",
        ),
      );
    doc
      .querySelectorAll("pre")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "padding:12px;background:#f5f5f5;white-space:pre-wrap",
        ),
      );
    doc
      .querySelectorAll("blockquote")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border-left:3px solid #ddd;margin-left:0;padding-left:12px;color:#666",
        ),
      );
    html = doc.documentElement.outerHTML;
  }
  return { html, body: htmlToText(html) };
}
export function prepareEditorCompose(draft: Compose): Compose {
  const format = composeFormat(draft);
  if (format === "markdown" || format === "html")
    return { ...draft, ...compileSource(draft.source ?? "", format) };
  return draft;
}

export function textToHtml(text: string) {
  return text
    .split("\n")
    .map(
      (line) =>
        `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") || "<br>"}</p>`,
    )
    .join("");
}

const hexColor = (value: string) => {
  const match =
    /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(
      value.trim(),
    );
  if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return value;
  return `#${match
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
};

// ProseMirror renders inline styles through CSSOM, so editor colors come back
// as rgb(). Store hex instead; desktop mail clients prefer it.
export function hexColorStyles(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll("[style]")) {
    const style = element.getAttribute("style") || "";
    element.setAttribute(
      "style",
      style.replace(/rgba?\([^)]+\)/g, (value) => hexColor(value)),
    );
  }
  return doc.body.innerHTML;
}

function quoteHeader(draft: Compose) {
  const quote = draft.quote!;
  return [
    `--------- ${quote.kind === "forward" ? "转发邮件" : "原始邮件"} ---------`,
    `发件人：${quote.sender}`,
    ...(quote.recipients ? [`收件人：${quote.recipients}`] : []),
    `时间：${new Date(quote.date).toLocaleString("zh-CN", { hour12: false })}`,
    `主题：${quote.subject}`,
  ].join("\n");
}

function signaturePart(
  doc: Document,
  html: string,
  marker: "data-yanxin-greeting" | "data-yanxin-signature",
  margin: "marginBottom" | "marginTop",
) {
  const part = doc.createElement("div");
  const content = new DOMParser().parseFromString(
    sanitizeComposeHtml(html),
    "text/html",
  );
  for (const attribute of content.body.attributes)
    part.setAttribute(attribute.name, attribute.value);
  for (const style of content.head.querySelectorAll("style"))
    doc.head.append(doc.importNode(style, true));
  part.setAttribute(marker, "true");
  part.style[margin] = "24px";
  const children = [...content.body.childNodes].map((n) =>
    doc.importNode(n, true),
  );
  // 签名 HTML 首尾的换行在浏览器里会渲染成空格，看起来像首行缩进。
  // 首尾的纯空白文本节点直接丢；块级元素内部的前导/尾部空白文本也要清，
  // 否则 <div ...>\n内容 的换行会留在第一个子节点里。
  while (children.length) {
    const edge = children[0];
    if (edge.nodeType === Node.TEXT_NODE && !edge.textContent?.trim())
      children.shift();
    else break;
  }
  const first = children[0];
  if (first && first.nodeType === Node.ELEMENT_NODE) {
    const element = first as Element;
    // 换行常和正文在同一个文本节点里（"\n祝您工作顺利"），
    // 不能整节点删，只切掉前导的空白字符。
    const text = element.firstChild;
    if (text && text.nodeType === Node.TEXT_NODE) {
      const leading = /^\s+/.exec(text.textContent ?? "");
      if (leading) {
        const rest = (text.textContent ?? "").slice(leading[0].length);
        if (rest) text.textContent = rest;
        else element.removeChild(text);
      }
    }
  }
  // 结尾的换行会被解析成空段落，搬过去会让写信预览和收件方多出一块空白
  while (children.length) {
    const last = children[children.length - 1];
    if (last.nodeType === Node.TEXT_NODE) {
      if (last.textContent?.trim()) break;
    } else if (last.nodeType === Node.ELEMENT_NODE) {
      const element = last as Element;
      if (element.querySelector("img")) break;
      if (element.getAttribute("src")) break;
      if (element.textContent?.trim()) break;
    } else break;
    children.pop();
  }
  part.replaceChildren(...children);
  return part;
}

// 收件方客户端只认内联样式：用带默认字体的 div 把正文包起来再发，
// 没手动设过字体/样式的文字也按仿宋 14pt 渲染（与正文编辑器默认一致）。
// 不用 body style 是因为 Outlook（Word 引擎）对 body 级 CSS 支持差，
// div 内联样式兼容性最好；问候语/落款/引用原文自带 inline 样式，优先级更高不受影响。
function withDefaultFont(doc: Document) {
  const wrapper = doc.createElement("div");
  wrapper.style.fontFamily = FONT_DEFAULT;
  wrapper.style.fontSize = SIZE_DEFAULT;
  wrapper.replaceChildren(...doc.body.childNodes);
  doc.body.append(wrapper);
  // 顶格：正文首个段落会带上浏览器默认上边距，让问候语看起来比写信窗口低。
  const first = wrapper.firstElementChild;
  if (first instanceof HTMLElement) first.style.marginTop = "0";
}

function withSignature(editor: Compose) {
  if (!editor.signature?.included) {
    if (!editor.html) return { body: editor.body, html: "" };
    const doc = new DOMParser().parseFromString(editor.html, "text/html");
    withDefaultFont(doc);
    return {
      body: editor.body,
      html: sanitizeComposeHtml(doc.documentElement.outerHTML),
    };
  }
  const signature = editor.signature;
  // 富文本模式下问候语已作为正文第一行写进草稿，发送时不再拼一次。
  const alreadyGreeted =
    !!signature.greeting?.trim() &&
    editor.body.trimStart().startsWith(signature.greeting.trim());
  const body = [
    alreadyGreeted ? "" : signature.greeting,
    editor.body,
    signature.body,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!editor.html && !signature.html && !signature.greetingHtml)
    return { body, html: "" };
  const doc = new DOMParser().parseFromString(
    sanitizeComposeHtml(editor.html || textToHtml(editor.body)),
    "text/html",
  );
  if (signature.greetingHtml && !alreadyGreeted)
    doc.body.prepend(
      signaturePart(
        doc,
        signature.greetingHtml,
        "data-yanxin-greeting",
        "marginBottom",
      ),
    );
  if (signature.html || signature.body)
    doc.body.append(
      signaturePart(
        doc,
        signature.html || textToHtml(signature.body),
        "data-yanxin-signature",
        "marginTop",
      ),
    );
  withDefaultFont(doc);
  return { body, html: sanitizeComposeHtml(doc.documentElement.outerHTML) };
}

// Preserve the editable text separately; scheduling/cancellation must not quote twice.
export function prepareCompose(draft: Compose): Compose {
  const editor = prepareEditorCompose(draft);
  const signed = withSignature(editor);
  const ownHtml = signed.html ? sanitizeComposeHtml(signed.html) : "";
  if (!draft.quote?.included)
    return { ...editor, deliveryBody: signed.body, deliveryHtml: ownHtml };
  const quote = draft.quote;
  const header = quoteHeader(draft);
  const deliveryBody = [
    signed.body,
    header,
    quote.body || htmlToText(quote.html),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!quote.html && !ownHtml)
    return { ...editor, deliveryBody, deliveryHtml: "" };
  const parser = new DOMParser();
  const original = parser.parseFromString(
    sanitizeComposeHtml(quote.html || textToHtml(quote.body)),
    "text/html",
  );
  const authored = parser.parseFromString(
    ownHtml || textToHtml(signed.body),
    "text/html",
  );
  const content = original.createElement("div");
  content.setAttribute("data-yanxin-authored", "true");
  for (const attribute of authored.body.attributes)
    content.setAttribute(attribute.name, attribute.value);
  content.style.fontFamily ||=
    "-apple-system,BlinkMacSystemFont,Arial,sans-serif";
  content.style.fontSize ||= "14px";
  content.style.lineHeight ||= "1.7";
  content.style.color ||= "#242424";
  content.style.marginBottom = "24px";
  content.append(
    ...[...authored.body.childNodes].map((node) =>
      original.importNode(node, true),
    ),
  );
  for (const style of authored.head.querySelectorAll("style"))
    original.head.append(original.importNode(style, true));
  const heading = original.createElement("div");
  heading.setAttribute("data-yanxin-quote-header", "true");
  heading.style.cssText =
    "white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#666;border-top:1px solid #ddd;padding-top:12px;margin-bottom:16px";
  heading.textContent = header;
  original.body.prepend(content, heading);
  return {
    ...editor,
    deliveryBody,
    deliveryHtml: sanitizeComposeHtml(original.documentElement.outerHTML),
  };
}
