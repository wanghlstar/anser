import Paragraph from "@tiptap/extension-paragraph";

/** 标记问候语段落：中文书信称呼顶格，不参与正文首行缩进 */
export const GreetingParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      greeting: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-yanxin-greeting"),
        renderHTML: (attributes) =>
          attributes.greeting
            ? { "data-yanxin-greeting": attributes.greeting }
            : {},
      },
      /** 已插入真实全角空格的段落：不再叠加 CSS text-indent */
      indented: {
        default: null,
        parseHTML: (element) =>
          element.hasAttribute("data-yanxin-indented") ? "true" : null,
        renderHTML: (attributes) =>
          attributes.indented ? { "data-yanxin-indented": "true" } : {},
      },
    };
  },
});
