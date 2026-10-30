import { useEffect, useState } from "react";
import { format } from "date-fns";
import { zhCN } from "react-day-picker/locale";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Account } from "@/lib/types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Calendar } from "./ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function SegmentDialog({
  account,
  open,
  onOpenChange,
  onDone,
}: {
  account: Account | null;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [since, setSince] = useState<Date>(() => new Date());
  const [freezeSource, setFreezeSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !account) return;
    setName(`${account.name} 新分段`);
    setSourceName(account.name);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSince(today);
    setFreezeSource(!account.readOnly);
    setBusy(false);
    setError("");
  }, [open, account]);
  async function create() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      await call<Account>("create_segment", {
        sourceId: account.id,
        name,
        sourceName: sourceName.trim() || undefined,
        syncSince: format(since, "yyyy-MM-dd"),
        freezeSource: freezeSource && !account.readOnly,
      });
      toast.success(
        freezeSource && !account.readOnly
          ? "已新建分段，原分段已冻结为只读"
          : "已新建分段",
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建同地址分段</DialogTitle>
          <DialogDescription>
            复制 {account?.email}{" "}
            的连接配置，建立独立的本地存档目录。收信起点之前的邮件不再收取。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="segment-name">分段名称</Label>
            <Input
              id="segment-name"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="segment-source-name">当前分段名称</Label>
            <Input
              id="segment-source-name"
              value={sourceName}
              disabled={busy}
              onChange={(event) => setSourceName(event.target.value)}
            />
            <p className="text-muted-foreground text-sm">
              可以顺手把原分段改成“旧分段”等名称，只影响显示，不移动存档。
            </p>
          </div>
          <div className="grid gap-2">
            <Label>收信起点</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  disabled={busy}
                >
                  <CalendarIcon />
                  {format(since, "yyyy-MM-dd")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  locale={zhCN}
                  selected={since}
                  onSelect={(day) => day && setSince(day)}
                />
              </PopoverContent>
            </Popover>
            <p className="text-muted-foreground text-sm">
              服务器上的旧邮件保留；只有该日期及之后的新邮件会进入这个分段。
            </p>
          </div>
          {!account?.readOnly && (
            <Label className="rule-action-option" htmlFor="segment-freeze">
              <Checkbox
                id="segment-freeze"
                checked={freezeSource}
                onCheckedChange={(next) => setFreezeSource(next === true)}
              />
              <span>同时冻结原分段（不再收信、发送或提交服务器操作）</span>
            </Label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? "正在新建…" : "新建分段"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
