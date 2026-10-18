import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Copy,
  FileArchive,
  FileImage,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { call, native } from "../lib/api";
import { formatSize } from "../lib/providers";
import type { Detail } from "../lib/types";

export function MailAttachments({
  mailId,
  demo = false,
  attachments,
  onDownload,
}: {
  mailId: string;
  demo?: boolean;
  attachments: Detail["attachments"];
  onDownload: (index: number, name: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<
    Record<number, "preview" | "download">
  >({});
  // Foxmail 附件栏：单击选中，⌘/⇧ 多选，空格或双击打开，⌘C 复制，⌫ 删除。
  const [selected, setSelected] = useState<number[]>([]);
  const active = useRef<number | null>(null);
  const anchor = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setSelected([]);
    active.current = null;
  }, [mailId]);
  useEffect(() => {
    // 和写信附件条一致：电脑上任何「离开附件条」的动作都取消选中。
    // 正文是 iframe，里面的点击/按键会被 WebKit 吞掉，只能用 window blur
    // 判断焦点是不是进了 iframe。
    const clear = () => {
      setSelected([]);
      active.current = null;
      anchor.current = null;
    };
    const onPointer = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (list.current?.contains(target)) return;
      if (target.closest('[role="menu"]')) return;
      clear();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) clear();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);
  async function act(
    index: number,
    name: string,
    action: "preview" | "download",
  ) {
    if (pending[index]) return;
    if (action === "preview" && (!native || demo)) {
      toast.info("请在桌面客户端中使用本地应用预览真实附件");
      return;
    }
    setPending((p) => ({ ...p, [index]: action }));
    try {
      if (action === "preview")
        await call("preview_attachment", { id: mailId, index });
      else await onDownload(index, name);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[index];
        return next;
      });
    }
  }
  const order = attachments.map((attachment) => attachment.index);
  function select(event: React.MouseEvent, index: number) {
    const at = order.indexOf(index);
    setSelected((prev) => {
      let next: number[];
      // ⇧ 从「上次单选」的锚点扩，⌘ 点选只增删、不挪锚点（Foxmail 同款）。
      if (event.shiftKey && anchor.current !== null) {
        const from = order.indexOf(anchor.current);
        const [head, tail] = [Math.min(from, at), Math.max(from, at)];
        next = order.slice(head, tail + 1);
      } else if (event.metaKey || event.ctrlKey) {
        next = prev.includes(index)
          ? prev.filter((item) => item !== index)
          : [...prev, index];
      } else {
        next = [index];
      }
      active.current = next.length ? index : null;
      anchor.current =
        event.metaKey || event.ctrlKey
          ? anchor.current
          : next.length
            ? index
            : null;
      return next;
    });
  }
  function focusCard(index: number) {
    active.current = index;
    setSelected([index]);
    document
      .querySelector<HTMLElement>(
        `.attachment-list [data-attachment-index="${index}"]`,
      )
      ?.focus();
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".mail-attachment",
    );
    if (!card) return;
    const at = Number(card.dataset.attachmentIndex);
    const attachment = attachments.find((item) => item.index === at);
    if (!attachment) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      focusCard(order[Math.min(Math.max(at + step, 0), order.length - 1)]);
    } else if (event.key === " " || event.key === "Enter") {
      if (attachment.error || pending[at]) return;
      event.preventDefault();
      void act(attachment.index, attachment.name, "preview");
    } else if (event.key === "Escape") {
      setSelected([]);
      active.current = null;
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      setSelected(order);
      active.current = order[order.length - 1] ?? null;
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "c"
    ) {
      if (demo || !native) return;
      const targets = selected.length ? selected : [at];
      event.preventDefault();
      void call("copy_mail_attachments", {
        id: mailId,
        indexes: targets,
      })
        .then(() => toast.success("已复制附件，可粘贴到 Finder"))
        .catch((error) => toast.error(String(error)));
    }
  }
  if (!attachments.length) return null;
  return (
    <div
      className="attachment-list"
      ref={list}
      aria-label="邮件附件"
      onKeyDown={onKeyDown}
    >
      {attachments.map((attachment) => {
        const Icon = attachment.mime.startsWith("image/")
          ? FileImage
          : /zip|compressed|tar/.test(attachment.mime)
            ? FileArchive
            : FileText;
        const busy = pending[attachment.index];
        const disabled = !!attachment.error || !!busy;
        return (
          <Card
            className="mail-attachment"
            key={attachment.index}
            data-attachment-index={attachment.index}
            data-selected={selected.includes(attachment.index)}
            aria-current={active.current === attachment.index || undefined}
            aria-busy={!!busy}
            tabIndex={0}
            onClick={(event) => select(event, attachment.index)}
            onDoubleClick={() =>
              void act(attachment.index, attachment.name, "preview")
            }
            onContextMenu={(event) => {
              // 右键：先选中再弹菜单（保存附件 / 复制）。
              event.preventDefault();
              if (!selected.includes(attachment.index)) {
                active.current = attachment.index;
                setSelected([attachment.index]);
              }
              setMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            <div
              className="attachment-preview"
              title={attachment.error || `双击或按空格打开 ${attachment.name}`}
              aria-busy={!!busy}
              aria-label={`预览附件 ${attachment.name}`}
            >
              <Icon className="attachment-type size-5" />
              <span className="attachment-info">
                <strong>{attachment.name}</strong>
                {busy ? (
                  <span className="attachment-progress" role="status">
                    <Skeleton className="h-2 w-6" />
                    <small>
                      {busy === "preview" ? "正在打开…" : "正在保存…"}
                    </small>
                  </span>
                ) : (
                  <small>
                    {attachment.error
                      ? "附件编码异常"
                      : `${formatSize(attachment.size)} · 双击或空格打开`}
                  </small>
                )}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="attachment-download"
              title={attachment.error || "另存附件"}
              disabled={disabled}
              aria-label={`下载附件 ${attachment.name}`}
              onClick={() =>
                void act(attachment.index, attachment.name, "download")
              }
            >
              <ArrowDownToLine className="size-4" />
            </Button>
          </Card>
        );
      })}
      {selected.length > 0 && (
        <p className="attachment-selection" role="status">
          {`已选 ${selected.length} 个附件 · 空格打开 · ⌘C 复制 · Esc 取消`}
        </p>
      )}
      <DropdownMenu
        open={!!menu}
        onOpenChange={(open) => !open && setMenu(null)}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            data-slot="attachment-menu-anchor"
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
              const target = selected[selected.length - 1];
              const attachment = attachments.find(
                (item) => item.index === target,
              );
              if (attachment)
                void act(attachment.index, attachment.name, "download");
            }}
          >
            <ArrowDownToLine />
            保存附件
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (demo || !native || !selected.length) return;
              void call("copy_mail_attachments", {
                id: mailId,
                indexes: selected,
              })
                .then(() => toast.success("已复制附件，可粘贴到 Finder"))
                .catch((error) => toast.error(String(error)));
            }}
          >
            <Copy />
            复制附件
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
