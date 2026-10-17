import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { Minus, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { imageDimension } from "@/lib/rich-image-size";

type Target = {
  from: number;
  node: Node;
  image: HTMLImageElement;
  rect: DOMRect;
};

// 参考 Foxmail 的图片缩放：点选图片后出现 − % + 浮条，
// 步进 5%/25%，范围 5%–200%，按原图比例同时改宽高。
export function RichImageZoom({
  editor,
  disabled,
}: {
  editor: Editor;
  disabled: boolean;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => {
      const { selection } = editor.state;
      if (
        !(selection instanceof NodeSelection) ||
        selection.node.type.name !== "image"
      ) {
        setTarget(null);
        return;
      }
      const dom = editor.view.nodeDOM(selection.from);
      if (!(dom instanceof HTMLImageElement)) {
        setTarget(null);
        return;
      }
      setTarget({
        from: selection.from,
        node: selection.node,
        image: dom,
        rect: dom.getBoundingClientRect(),
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);
  // 滚动或窗口尺寸变化时，浮条跟随图片。
  useEffect(() => {
    if (!target) return;
    const follow = () => setTick((n) => n + 1);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [target]);
  if (!target || target.image.isConnected === false) return null;
  const rect = target.image.getBoundingClientRect();
  const naturalWidth = target.image.naturalWidth || 0;
  const naturalHeight = target.image.naturalHeight || 0;
  const shownWidth =
    imageDimension(target.node.attrs.width) || target.image.clientWidth || 0;
  const percent = naturalWidth
    ? Math.max(5, Math.min(200, Math.round((shownWidth / naturalWidth) * 100)))
    : 100;
  const step = percent >= 25 ? 25 : 5;
  function zoom(delta: number) {
    if (!target || disabled) return;
    const next = Math.max(5, Math.min(200, percent + delta));
    if (next === percent || !naturalWidth || !naturalHeight) return;
    const width = Math.round((naturalWidth * next) / 100);
    const height = Math.round((naturalHeight * next) / 100);
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(target.from, undefined, {
          ...target.node.attrs,
          width,
          height,
        });
        tr.setSelection(NodeSelection.create(tr.doc, target.from));
        return true;
      })
      .run();
  }
  return createPortal(
    <div
      className="rich-image-zoom"
      role="toolbar"
      aria-label="图片缩放"
      style={{
        left: Math.max(8, rect.left),
        top: Math.max(8, rect.top - 42),
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="缩小图片"
        disabled={disabled || percent <= 5}
        onClick={() => zoom(-step)}
      >
        <Minus size={14} />
      </Button>
      <span className="rich-image-zoom-percent">{percent}%</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="放大图片"
        disabled={disabled || percent >= 200}
        onClick={() => zoom(step)}
      >
        <Plus size={14} />
      </Button>
    </div>,
    document.body,
  );
}
