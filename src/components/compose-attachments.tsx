import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { call, native } from "../lib/api";
import type { ForwardFile } from "../lib/types";

/// 写信附件条：单击选中，⌘/⇧ 多选，双击或空格用系统默认应用打开，
/// ⌘C 把选中的文件写进剪贴板（text/uri-list），可直接粘到 Finder/邮件正文。
export function ComposeAttachments({
  paths,
  onRemove,
}: {
  paths: string[];
  onRemove: (index: number) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const anchor = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setSelected([]);
    anchor.current = null;
  }, [paths.length]);
  async function openAttachment(index: number) {
    const path = paths[index];
    if (!path) return;
    if (!native) {
      toast.info("请在桌面客户端中打开附件");
      return;
    }
    try {
      await call("open_attachment_path", { path });
    } catch (error) {
      toast.error(String(error));
    }
  }
  async function copySelected() {
    if (!selected.length) return;
    if (!native) {
      toast.info("请在桌面客户端中复制附件");
      return;
    }
    try {
      await call("copy_attachment_paths", {
        paths: selected.map((index) => paths[index]).filter(Boolean),
      });
      toast.success(
        selected.length > 1 ? `已复制 ${selected.length} 个附件` : "已复制附件",
      );
    } catch (error) {
      toast.error(String(error));
    }
  }
  function select(event: React.MouseEvent, index: number) {
    setSelected((prev) => {
      let next: number[];
      if (event.shiftKey && anchor.current !== null) {
        const from = anchor.current;
        const [head, tail] = [Math.min(from, index), Math.max(from, index)];
        next = Array.from({ length: tail - head + 1 }, (_, i) => head + i);
      } else if (event.metaKey || event.ctrlKey) {
        next = prev.includes(index)
          ? prev.filter((item) => item !== index)
          : [...prev, index];
      } else {
        next = [index];
      }
      anchor.current =
        event.metaKey || event.ctrlKey
          ? anchor.current
          : next.length
            ? index
            : null;
      return next;
    });
  }
  return (
    <div
      className="compose-attachments"
      role="listbox"
      aria-label="邮件附件"
      aria-multiselectable
      onKeyDown={(event) => {
        if (!selected.length) return;
        if (event.key === " " || event.key === "Enter") {
          if (event.repeat) return;
          event.preventDefault();
          void openAttachment(selected[selected.length - 1]);
        } else if (
          (event.metaKey || event.ctrlKey) &&
          (event.key === "Backspace" || event.key === "Delete")
        ) {
          // 从后往前删，避免下标位移漏删。
          event.preventDefault();
          for (const index of [...selected].sort((a, b) => b - a))
            onRemove(index);
          setSelected([]);
          anchor.current = null;
        } else if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "c"
        ) {
          event.preventDefault();
          void copySelected();
        }
      }}
      onBlur={(event) => {
        // 焦点离开附件条就取消选中，不用记 Esc。
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setSelected([]);
          anchor.current = null;
        }
      }}
    >
      {paths.map((path, index) => (
        <span
          key={path + index}
          role="option"
          aria-selected={selected.includes(index)}
          tabIndex={0}
          className="compose-attachment"
          data-selected={selected.includes(index)}
          onClick={(event) => select(event, index)}
          onDoubleClick={() => void openAttachment(index)}
          onContextMenu={(event) => {
            // 右键未选中项时先选中它，再弹删除菜单（可删单个或多个）。
            event.preventDefault();
            if (!selected.includes(index)) {
              anchor.current = index;
              setSelected([index]);
            }
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              void openAttachment(index);
            }
          }}
        >
          <Paperclip size={13} />
          <span className="compose-attachment-name" title={path}>
            {path.split("/").pop()}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            title="移除附件"
            aria-label={`移除附件 ${path.split("/").pop()}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(index);
            }}
          >
            <X size={13} />
          </Button>
        </span>
      ))}
      <DropdownMenu
        open={!!menu}
        onOpenChange={(open) => !open && setMenu(null)}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            data-slot="compose-attachment-menu-anchor"
            style={{
              position: "fixed",
              left: menu?.x ?? -1,
              top: menu?.y ?? -1,
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
            onSelect={() => {
              const targets = selected.length ? selected : [];
              for (const index of [...targets].sort((a, b) => b - a))
                onRemove(index);
              setSelected([]);
              anchor.current = null;
            }}
          >
            <Trash2 />
            {selected.length > 1
              ? `删除 ${selected.length} 个附件`
              : "删除附件"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ForwardAttachments({
  files,
  onOpen,
  onRemove,
  disabled = false,
}: {
  files: ForwardFile[];
  onOpen: (file: ForwardFile) => void;
  onRemove: (file: ForwardFile) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected && !files.some((file) => file.id === selected))
      setSelected(null);
  }, [files, selected]);
  if (!files.length) return null;
  return (
    <div
      className="compose-attachments"
      role="listbox"
      aria-label="原邮件附件"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setSelected(null);
      }}
    >
      {files.map((file) => (
        <span
          key={file.id}
          role="option"
          aria-selected={selected === file.id}
          tabIndex={0}
          className="compose-attachment"
          data-selected={selected === file.id}
          title={`${file.name} · ${file.size} 字节`}
          onClick={() => setSelected(file.id)}
          onDoubleClick={() => !disabled && onOpen(file)}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              if (!disabled) onOpen(file);
            }
          }}
        >
          <Paperclip size={13} />
          <span className="compose-attachment-name" title={file.name}>
            {file.name}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            title="移除附件"
            aria-label={`移除附件 ${file.name}`}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(file);
            }}
          >
            <X size={13} />
          </Button>
        </span>
      ))}
    </div>
  );
}
