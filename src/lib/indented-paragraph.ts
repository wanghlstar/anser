import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** 中文首行缩进 2 个汉字宽：全角空格 1 个 = 1 个汉字宽 */
const INDENT = "　　";
const indentKey = new PluginKey("yanxinBodyIndent");

/**
 * 正文段落首行缩进：用真实全角空格，不用 CSS text-indent。
 *
 * 为什么必须真实字符：
 * 1. 回格/删除键可以改成顶格；
 * 2. 会随邮件发给收件方——CSS text-indent 只影响本地渲染，
 *    发出去的 HTML 没有缩进，收件人看到的是顶格。
 *
 * 实现要点：Enter 交给 Tiptap 默认的 splitBlock 正常分裂段落，
 * 这里用 appendTransaction 观察「本次输入新建出来的空段落」补缩进。
 * 不能在 Enter 的 chain 里读 tr.selection——splitBlock 之后链里的
 * 选区还是分裂前的，会把缩进插到上一段段尾（已出现的 bug）。
 *
 * 问候语段落顶格，不参与；已带 indented 标记的段落不重复补。
 */
export const BodyIndent = Extension.create({
  name: "bodyIndent",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: indentKey,
        view: () => ({
          // 编辑器首次挂载：把旧草稿里没有缩进的正文段补齐。
          // 旧版用 CSS text-indent，HTML 里没有真实空格，直接发出去
          // 收件人看到的是顶格；这里统一补成可编辑、可发送的真实空格。
          update: (view, prevState) => {
            if (prevState) return;
            const tr = view.state.tr;
            let changed = false;
            view.state.doc.forEach((node, offset, index) => {
              if (node.type.name !== "paragraph") return;
              if (node.attrs.greeting || node.attrs.indented) return;
              if (node.textContent.trim().length === 0) return;
              tr.insertText("　　", offset + 1);
              tr.setNodeMarkup(offset, undefined, {
                ...node.attrs,
                indented: "true",
              });
              changed = true;
            });
            if (changed) view.dispatch(tr);
          },
        }),
        appendTransaction(transactions, oldState, newState) {
          // 只跟随真实的输入/删除，刷新和程序化写入不触发
          const edited = transactions.some(
            (t) =>
              t.docChanged &&
              (t.getMeta("uiEvent") === "input" ||
                t.getMeta("uiEvent") === "delete"),
          );
          if (!edited) return null;
          const tr = newState.tr;
          let changed = false;
          // 逐段定位：newState.doc.child(i) 只给节点，位置要自己累加
          let offset = 0;
          for (let i = 0; i < newState.doc.childCount; i += 1) {
            const node = newState.doc.child(i);
            const size = node.nodeSize;
            if (node.type.name === "paragraph") {
              if (
                !node.attrs.greeting &&
                !node.attrs.indented &&
                node.textContent.length === 0 &&
                i >= oldState.doc.childCount
              ) {
                tr.insertText(INDENT, offset + 1);
                tr.setNodeMarkup(offset, undefined, {
                  ...node.attrs,
                  indented: "true",
                });
                changed = true;
              }
            }
            offset += size;
          }
          return changed ? tr : null;
        },
      }),
    ];
  },
});
