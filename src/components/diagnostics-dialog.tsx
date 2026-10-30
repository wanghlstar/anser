import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  RefreshCw,
  Wrench,
  XCircle,
} from "lucide-react";
import { call } from "@/lib/api";
import type { Account } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Status = "pass" | "warn" | "fail" | "info";
type DiagnosticItem = { label: string; status: Status; detail: string };
type Report = { generatedAt: string; items: DiagnosticItem[] };

const labels: Record<Status, string> = {
  pass: "正常",
  warn: "注意",
  fail: "失败",
  info: "信息",
};
const variants: Record<
  Status,
  "secondary" | "outline" | "destructive" | "default"
> = {
  pass: "secondary",
  warn: "outline",
  fail: "destructive",
  info: "outline",
};
function Icon({ status }: { status: Status }) {
  if (status === "pass") return <CheckCircle2 size={16} />;
  if (status === "warn") return <AlertTriangle size={16} />;
  if (status === "fail") return <XCircle size={16} />;
  return <Info size={16} />;
}
function mask(text: string) {
  return text.replace(
    /([\w.!#$%&'*+/=?^_`{|}~-]+)@([\w.-]+\.[A-Za-z]{2,})/g,
    "***@$2",
  );
}
export function DiagnosticsDialog({
  open,
  account,
  onOpenChange,
  onRepaired,
}: {
  open: boolean;
  account: Account | null;
  onOpenChange: (open: boolean) => void;
  onRepaired?: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setReport(
        await call<Report>("run_diagnostics", {
          accountId: account?.id ?? null,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setError("");
  }, [open, account?.id]);

  async function repair(command: string, label: string) {
    setRepairing(command);
    try {
      const count = await call<number>(command);
      toast.success(
        count > 0 ? `${label}完成，处理 ${count} 项` : `${label}完成，无需处理`,
      );
      onRepaired?.();
      await run();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRepairing(null);
    }
  }

  async function copy() {
    if (!report) return;
    const text = report.items
      .map((item) => `[${labels[item.status]}] ${item.label}：${item.detail}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(
        `雁信诊断报告 ${report.generatedAt}\n${mask(text)}`,
      );
      toast.success("诊断报告已复制（邮箱已脱敏）");
    } catch {
      toast.error("无法写入剪贴板");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            诊断{account ? `：${account.name}` : "与支持"}
          </DialogTitle>
          <DialogDescription>
            {account
              ? `${account.email} · 只读检查，不会发送邮件或修改服务器状态。`
              : "检查数据库、存档、索引与后台任务。"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[58vh] overflow-y-auto">
          {busy && (
            <div className="flex items-center gap-2 py-6 text-sm">
              <LoaderCircle className="animate-spin" size={16} />
              正在检查服务器连接与本地数据…
            </div>
          )}
          {error && (
            <p className="py-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {!busy && !report && !error && (
            <p className="py-6 text-sm text-muted-foreground">
              点击下方「开始检查」生成诊断报告。
            </p>
          )}
          {report && (
            <div className="flex flex-col">
              {report.items.map((item) => (
                <div
                  key={`${item.label}-${item.detail}`}
                  className="flex items-start gap-3 border-b border-border/60 py-3 last:border-0"
                >
                  <span className="mt-0.5 text-muted-foreground">
                    <Icon status={item.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-medium">
                        {item.label}
                      </strong>
                      <Badge variant={variants[item.status]}>
                        {labels[item.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
              <div className="mt-2 border-t border-border pt-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wrench size={15} />
                  安全修复
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!repairing}
                    onClick={() =>
                      void repair("repair_archive_layout", "重试存档迁移")
                    }
                  >
                    {repairing === "repair_archive_layout" && (
                      <LoaderCircle className="animate-spin" size={14} />
                    )}
                    重试存档迁移
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!repairing}
                    onClick={() =>
                      void repair("normalize_archive_paths", "规范存档目录")
                    }
                  >
                    {repairing === "normalize_archive_paths" && (
                      <LoaderCircle className="animate-spin" size={14} />
                    )}
                    规范存档目录
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!repairing}
                    onClick={() =>
                      void repair("rebuild_search_index", "重建搜索索引")
                    }
                  >
                    {repairing === "rebuild_search_index" && (
                      <LoaderCircle className="animate-spin" size={14} />
                    )}
                    重建搜索索引
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  只处理存档路径和派生索引，不删除邮件、不改服务器状态。
                </p>
              </div>
              <p className="pt-3 text-xs text-muted-foreground">
                生成于{" "}
                {new Date(report.generatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run()}
          >
            <RefreshCw size={14} />
            {report ? "重新检查" : "开始检查"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!report}
            onClick={() => void copy()}
          >
            复制报告
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
