import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { FieldGroup, Field, FieldLabel, FieldError } from "./ui/field";
import { Input } from "./ui/input";
import {
  useEffect,
  useState,
  useRef,
  useImperativeHandle,
  type ReactNode,
  type Ref,
} from "react";
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { richExtensions } from "@/lib/rich-extensions";
import { RichToolbar } from "./rich-toolbar";
import { RichImageControls } from "./rich-image-controls";
import { RichImageZoom } from "./rich-image-zoom";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import DOMPurify from "dompurify";
import { Button } from "./ui/button";
import { textToHtml } from "@/lib/compose-format";
import { native, isDemo } from "@/lib/api";
import { toast } from "sonner";
import { TooltipProvider } from "./ui/tooltip";
import { attachmentPathsFromClipboard } from "@/lib/compose-attachments";
import type { GreetingSpec } from "@/lib/signatures";
import {
  readBodyImage,
  inlineImageBytes,
  isImagePath,
  type BodyImage,
} from "@/lib/rich-body";

export type RichEditorHandle = {
  insertPaths: (paths: string[], point: { x: number; y: number }) => boolean;
};

// 空正文判定：textToHtml("") 出来的 `<p><br></p>` 里硬换行是 leaf 节点，editor.isEmpty 会判成非空。
function blankBody(editor: Editor) {
  const doc = editor.state.doc;
  return (
    !doc.textContent &&
    [...doc.content.content].every(
      (block) =>
        block.isTextblock &&
        [...block.content.content].every(
          (inline) => inline.type.name === "hardBreak",
        ),
    )
  );
}

export function RichEditor({
  body,
  html,
  disabled,
  onChange,
  onBusy,
  readImages,
  ref,
  dark = false,
  onToggleTheme,
  greeting,
  onAttachFiles,
  toolbarExtras,
}: {
  body: string;
  html: string;
  disabled: boolean;
  onChange: (body: string, html: string) => void;
  onBusy: (busy: boolean) => void;
  readImages: (paths: string[]) => Promise<BodyImage[]>;
  ref?: Ref<RichEditorHandle>;
  dark?: boolean;
  onToggleTheme?: () => void;
  greeting?: GreetingSpec | null;
  /** 粘贴（⌘V）复制的文件时，把文件路径交给写信窗口登记为附件。 */
  onAttachFiles?: (paths: string[]) => void;
  toolbarExtras?: ReactNode;
}) {
  const [imageBusy, setImageBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const latest = useRef({ disabled, onBusy, readImages, onAttachFiles });
  latest.current = { disabled, onBusy, readImages, onAttachFiles };
  const busy = useRef(false);
  const alive = useRef(true);
  const instance = useRef<Editor | null>(null);
  const [linkDialog, setLinkDialog] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    extensions: richExtensions(),
    content: html || textToHtml(body),
    editorProps: {
      attributes: {
        class: "rich-body",
        role: "textbox",
        "aria-label": "邮件正文",
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "f" &&
          !event.altKey &&
          !event.shiftKey &&
          !event.isComposing &&
          !latest.current.disabled
        ) {
          event.preventDefault();
          setSearchOpen(true);
          return true;
        }
        return false;
      },
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      // 点图片即选中（Foxmail 同款）：随后出现 − % + 缩放浮条。
      handleClickOn: (view, _pos, node, nodePos) => {
        if (node.type.name !== "image") return false;
        view.dispatch(
          view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, nodePos),
          ),
        );
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) {
          // 粘贴的是复制的文件（非图片）时登记为附件，而不是插入正文。
          const paths = attachmentPathsFromClipboard(
            event.clipboardData ?? null,
          );
          if (paths.length && latest.current.onAttachFiles) {
            event.preventDefault();
            latest.current.onAttachFiles(paths);
            return true;
          }
          return false;
        }
        if (
          files.length > 20 ||
          files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024
        ) {
          toast.error("每次最多插入20张图片，总大小不能超过50 MB");
          return true;
        }
        void insertImages(() => Promise.all(files.map(readBodyImage)));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files || [])].filter(
          (file) => file.type.startsWith("image/") || isImagePath(file.name),
        );
        if (moved || !files.length) return false;
        if (
          files.length > 20 ||
          files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024
        ) {
          toast.error("每次最多插入20张图片，总大小不能超过50 MB");
          return true;
        }
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void insertImages(() => Promise.all(files.map(readBodyImage)), pos);
        return true;
      },
    },
    onUpdate: ({ editor }) =>
      onChange(
        editor.getText({ blockSeparator: "\n" }),
        DOMPurify.sanitize(editor.getHTML()),
      ),
  });
  instance.current = editor;
  const greetingInserted = useRef("");
  // 问候语作为正文第一行插入：空文档才插，插过一次或草稿里已有正文都不再动。
  useEffect(() => {
    if (!editor || !greeting?.text) return;
    if (greetingInserted.current === greeting.text || !blankBody(editor))
      return;
    const attrs: Record<string, string> = {};
    if (greeting.fontFamily) attrs.fontFamily = greeting.fontFamily;
    if (greeting.fontSize) attrs.fontSize = greeting.fontSize;
    const marks = Object.keys(attrs).length
      ? [{ type: "textStyle", attrs }]
      : [];
    editor
      .chain()
      .insertContentAt({ from: 0, to: editor.state.doc.content.size }, [
        // 称呼顶格：靠段落标记让 CSS 去掉首行缩进
        {
          type: "paragraph",
          attrs: { greeting: "true" },
          content: [{ type: "text", text: greeting.text, marks }],
        },
        // 问候语下方第一段正文：带 indented 标记 + 真实全角空格，
        // 所见即所得（CSS text-indent 不会随邮件发出）
        {
          type: "paragraph",
          attrs: { indented: "true" },
          content: [{ type: "text", text: "　　" }],
        },
      ])
      .run();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    greetingInserted.current = greeting.text;
  }, [editor, greeting]);
  async function insertImages(load: () => Promise<BodyImage[]>, pos?: number) {
    const editor = instance.current;
    if (!native || isDemo()) {
      toast.info("请在桌面客户端中插入正文图片");
      return;
    }
    if (
      !editor ||
      editor.isDestroyed ||
      latest.current.disabled ||
      busy.current
    )
      return;
    busy.current = true;
    setImageBusy(true);
    latest.current.onBusy(true);
    let bookmark = editor.state.selection.getBookmark();
    if (pos !== undefined) {
      editor.commands.setTextSelection(pos);
      bookmark = editor.state.selection.getBookmark();
    }
    const map = ({ transaction }: { transaction: Transaction }) => {
      bookmark = bookmark.map(transaction.mapping);
    };
    editor.on("transaction", map);
    try {
      const images = await load();
      if (
        !images.length ||
        !alive.current ||
        editor.isDestroyed ||
        latest.current.disabled
      )
        return;
      inlineImageBytes(editor.getHTML(), images);
      const selection = bookmark.resolve(editor.state.doc);
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setSelection(selection);
          return true;
        })
        .insertContent(
          images.map((image) => ({
            type: "image",
            attrs: { src: image.src, alt: image.name },
          })),
        )
        .run();
    } catch (error) {
      if (alive.current && !editor.isDestroyed)
        toast.error(`正文图片未插入：${String(error)}`);
    } finally {
      editor.off("transaction", map);
      busy.current = false;
      if (alive.current) {
        setImageBusy(false);
        latest.current.onBusy(false);
      }
    }
  }
  useImperativeHandle(ref, () => ({
    insertPaths(paths, point) {
      const rect = editor?.view.dom.getBoundingClientRect();
      if (
        !rect ||
        point.x < rect.left ||
        point.x > rect.right ||
        point.y < rect.top ||
        point.y > rect.bottom
      )
        return false;
      const pos = editor?.view.posAtCoords({
        left: point.x,
        top: point.y,
      })?.pos;
      void insertImages(() => latest.current.readImages(paths), pos);
      return true;
    },
  }));
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      latest.current.onBusy(false);
    };
  }, []);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  if (!editor) return null;
  return (
    <TooltipProvider>
      <div className="rich-editor">
        <RichToolbar
          dark={dark}
          onToggleTheme={onToggleTheme}
          editor={editor}
          disabled={disabled}
          imageBusy={imageBusy}
          searchOpen={searchOpen}
          onSearchOpen={setSearchOpen}
          onLink={() => {
            setHref(editor.getAttributes("link").href || "https://");
            setLinkError("");
            setLinkDialog({
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            });
          }}
          onImage={() =>
            void insertImages(async () => {
              const { open } = await import("@tauri-apps/plugin-dialog");
              const selected = await open({
                multiple: true,
                filters: [
                  {
                    name: "正文图片",
                    extensions: ["png", "jpg", "jpeg", "gif", "webp"],
                  },
                ],
              });
              if (!selected) return [];
              return latest.current.readImages(
                Array.isArray(selected) ? selected : [selected],
              );
            })
          }
          extras={toolbarExtras}
        />
        <RichImageControls editor={editor} disabled={disabled || imageBusy} />
        <RichImageZoom editor={editor} disabled={disabled || imageBusy} />
        <Dialog
          open={!!linkDialog}
          onOpenChange={(open) => {
            if (!open) setLinkDialog(null);
          }}
        >
          <DialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              editor.commands.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>插入链接</DialogTitle>
              <DialogDescription>
                支持网页和邮箱地址。留空可移除当前链接。
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const url = href.trim();
                if (url) {
                  try {
                    if (
                      !["http:", "https:", "mailto:"].includes(
                        new URL(url).protocol,
                      )
                    )
                      throw new Error();
                  } catch {
                    setLinkError("请输入有效的 http、https 或 mailto 链接");
                    return;
                  }
                }
                if (!linkDialog || disabled) return;
                const chain = editor
                  .chain()
                  .focus()
                  .setTextSelection(linkDialog)
                  .extendMarkRange("link");
                if (url) chain.setLink({ href: url }).run();
                else chain.unsetLink().run();
                setLinkDialog(null);
              }}
            >
              <FieldGroup>
                <Field data-invalid={!!linkError}>
                  <FieldLabel htmlFor="rich-link-url">链接地址</FieldLabel>
                  <Input
                    id="rich-link-url"
                    autoFocus
                    value={href}
                    aria-invalid={!!linkError}
                    disabled={disabled}
                    onChange={(e) => {
                      setHref(e.target.value);
                      setLinkError("");
                    }}
                  />
                  {linkError && <FieldError>{linkError}</FieldError>}
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLinkDialog(null)}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={disabled}>
                    保存链接
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
