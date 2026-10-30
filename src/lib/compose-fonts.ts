import type { Compose } from "./types";

// 富文本编辑器只把行内字体样式识别为 span 上的 TextStyle；存档邮件里的签名
// 常把 font-family/font-size 放在 div 上（如 style="font-family:楷体"）。
// 重新编辑时 ProseMirror 会把 div 重排成段落并丢掉这些属性，签名就退回默认仿宋。
// 在载入编辑器前把块级字体样式下沉到文本节点的 span 上，保留原格式与正文顺序。
const BLOCK_FONT_STYLES = ["font-family", "font-size"] as const;

export function preserveBlockFontStyles(draft: Compose): Compose {
  if (!draft.html) return draft;
  const doc = new DOMParser().parseFromString(draft.html, "text/html");
  const walker = doc.createTreeWalker(doc.body, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.textContent?.trim()) continue;
    if (node.parentElement?.closest("style,script")) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    const styles = new Map<string, string>();
    for (
      let element = node.parentElement;
      element && element !== doc.body;
      element = element.parentElement
    )
      for (const property of BLOCK_FONT_STYLES) {
        const value = element.style.getPropertyValue(property);
        if (value && !styles.has(property)) styles.set(property, value);
      }
    if (!styles.size) continue;
    const span = doc.createElement("span");
    for (const [property, value] of styles)
      span.style.setProperty(property, value);
    node.replaceWith(span);
    span.append(node);
  }
  return { ...draft, html: doc.body.innerHTML };
}
