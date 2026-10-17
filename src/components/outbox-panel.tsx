import { useConfirmation } from "@/hooks/use-confirmation";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  Send,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Clock3,
  Trash2,
} from "lucide-react";
import type { Compose, OutboxRecord } from "@/lib/types";
import { call } from "@/lib/api";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { toast } from "sonner";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
import { Badge } from "./ui/badge";

const uploadLabels: Record<string, string> = {
  queued: "等待保存到服务器",
  preparing: "正在核对已发送目录",
  submitted: "上传已提交",
  confirmed: "回执已保存，等待核对",
  verifying: "正在核对服务器副本",
  checking: "等待只读核对",
  completed: "服务器已发送副本已核对",
  blocked: "尚未上传，需要处理",
  uncertain: "保存结果未确认",
};

const labels = {
  sending: "发送中",
  sent: "发送成功 · SMTP 已确认",
  failed: "发送失败",
  uncertain: "结果未确认",
  scheduled: "待定时发送",
  overdue: "已错过时间",
  paused: "计划已暂停",
  cancelled: "计划已取消",
};
export function OutboxPanel({
  onDraft,
}: {
  onDraft: (draft: Compose) => void;
}) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [records, setRecords] = useState<OutboxRecord[]>([]),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState("");
  const [editing, setEditing] = useState(""),
    [time, setTime] = useState(localDateTime);
  async function refresh() {
    try {
      setRecords(await call<OutboxRecord[]>("list_outbox"));
      setFailure("");
    } catch (e) {
      setFailure(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, []);
  async function cancel(r: OutboxRecord) {
    setBusy(r.id);
    try {
      const draft = await call<Compose>("cancel_schedule", { id: r.id });
      await refresh();
      toast.success("计划已取消，正文与附件已恢复为草稿");
      onDraft(draft);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function reschedule(id: string, selectedTime = time) {
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (e) {
      toast.error(String(e));
      return;
    }
    setBusy(id);
    try {
      await call("reschedule_mail", { id, scheduledAt });
      setEditing("");
      await refresh();
      toast.success("发送时间已更新");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function retry(record: OutboxRecord) {
    const uncertain = record.status === "uncertain";
    if (
      uncertain &&
      !(await askConfirmation({
        title: "准备重发结果未确认的邮件？",
        description:
          "此邮件可能已送达。请先检查服务端已发送文件夹；继续会创建一封可编辑草稿，重复发送可能产生重复邮件。",
        action: "创建重发草稿",
      }))
    )
      return;
    setBusy(record.id);
    try {
      onDraft(
        await call<Compose>("retry_outbox", {
          id: record.id,
          confirmDuplicate: uncertain,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function archive(record: OutboxRecord) {
    setBusy(record.id);
    try {
      await call("archive_outbox", { id: record.id });
      await refresh();
      toast.success("已发送邮件的本地存档已恢复");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function upload(record: OutboxRecord, action: string) {
    setBusy(record.id);
    try {
      await call("sent_upload_action", { id: record.id, action });
      await refresh();
      toast.success(
        action === "verify"
          ? "已安排只读核对，不会重复上传或发送"
          : "已安排保存副本，不会重新发送邮件",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  // 已发送记录可以删：本地邮件副本、服务器已发送邮件都不受影响，删的只是这条回执。
  async function remove(record: OutboxRecord) {
    if (
      !(await askConfirmation({
        title: "删除这条发送记录？",
        description: `「${record.draft.subject || "（无主题）"}」的发送回执会从记录中移除，本地和服务器上已保存的邮件副本不受影响。`,
        action: "删除记录",
        destructive: true,
      }))
    )
      return;
    setBusy(record.id);
    try {
      await call("delete_outbox", { id: record.id });
      await refresh();
      toast.success("发送记录已删除");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function clearSent() {
    const sent = records.filter((r) => r.status === "sent");
    if (!sent.length) {
      toast.info("没有发送成功的记录可清空");
      return;
    }
    if (
      !(await askConfirmation({
        title: "清空发送成功的记录？",
        description: `将移除 ${sent.length} 条「发送成功」的回执，本地和服务器上已保存的邮件副本不受影响；失败与结果未确认的记录会保留，仍可编辑重发。`,
        action: "清空",
        destructive: true,
      }))
    )
      return;
    setBusy("all");
    try {
      const deleted = await call<number>("clear_sent_outbox");
      await refresh();
      toast.success(`已清空 ${deleted} 条发送记录`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <div className="page-title-row">
            <SidebarTrigger />
            <h1>发送记录</h1>
          </div>
          <p>查看发送成功、失败和结果未确认的回执</p>
        </div>
        <div className="panel-heading-actions">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void clearSent()}
          >
            <Trash2 size={15} />
            清空
          </Button>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
      </div>
      <div className="outbox-list">
        {records.map((r) => (
          <article key={r.id} className="outbox-card">
            <div className="outbox-main">
              <span className={`outbox-status ${r.status}`}>
                {["scheduled", "overdue", "paused", "cancelled"].includes(
                  r.status,
                ) ? (
                  <Clock3 size={14} />
                ) : r.status === "sent" ? (
                  <CheckCircle2 size={14} />
                ) : r.status === "sending" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <AlertCircle size={14} />
                )}{" "}
                {labels[r.status]}
              </span>
              <h3 title={r.draft.subject}>{r.draft.subject || "（无主题）"}</h3>
              <small className="outbox-time">
                {r.scheduledAt && (
                  <>
                    计划时间：
                    {new Date(r.scheduledAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}{" "}
                    ·{" "}
                  </>
                )}
                {r.updatedAt
                  ? new Date(r.updatedAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })
                  : "此前的发送记录"}
              </small>
            </div>
            <div className="outbox-detail">
              <span className="outbox-recipient">收件人：{r.draft.to}</span>
              {r.status === "uncertain" && (
                <span className="outbox-note">
                  未取得发送确认，可能已送达。先核对服务端已发送邮件。
                </span>
              )}
              {r.status === "sent" && (
                <span className="outbox-note">
                  发送服务器已接受，尚不代表收件人已收到。{" "}
                  {r.archived
                    ? "本地已发送副本已保存"
                    : "本地副本尚未归档，原始邮件仍保存在发送记录中"}
                </span>
              )}
              {r.status === "sent" && r.serverCopy && (
                <>
                  <Badge variant="secondary">
                    {uploadLabels[r.serverCopy.status] || "保存状态待核对"}
                  </Badge>
                  {r.serverCopy.target && (
                    <span className="outbox-note">
                      服务器目录：
                      {r.serverCopy.targetLabel || r.serverCopy.target}
                    </span>
                  )}
                  {r.serverCopy.origin === "existing" && (
                    <span className="outbox-note">
                      服务器已有相同副本，未重复上传。
                    </span>
                  )}
                  {r.serverCopy.origin === "smtpReported" && (
                    <span className="outbox-note">
                      {r.serverCopy.status === "completed"
                        ? "服务器报告 SMTP 已保存，唯一副本已核对；未重复上传。"
                        : ["checking", "verifying"].includes(
                              r.serverCopy.status,
                            )
                          ? "服务器报告 SMTP 已保存，正在核对唯一副本；不会再次上传。"
                          : "服务器报告 SMTP 已保存，结果尚未确认；只能只读核对，不会再次上传。"}
                    </span>
                  )}
                  {r.serverCopy.status === "uncertain" && (
                    <span className="outbox-note">
                      SMTP
                      发送已经成功，副本可能已保存。仅核对结果，不会自动再次上传。
                    </span>
                  )}
                </>
              )}
              {(r.error && r.status !== "sent" && (
                <span className="outbox-note outbox-error">{r.error}</span>
              )) ||
                (r.status === "sent" && r.error && (
                  <span className="outbox-note outbox-error">{r.error}</span>
                ))}
              <div className="outbox-actions">
                {r.status === "sent" &&
                  r.serverCopyAvailable &&
                  !r.serverCopy && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void upload(r, "queue")}
                    >
                      保存到服务器已发送
                    </Button>
                  )}
                {r.status === "sent" &&
                  r.serverCopy?.status === "blocked" &&
                  r.serverCopy.origin !== "smtpReported" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void upload(r, "retry")}
                    >
                      重试保存副本
                    </Button>
                  )}
                {r.status === "sent" &&
                  (["uncertain", "confirmed"].includes(
                    r.serverCopy?.status || "",
                  ) ||
                    (r.serverCopy?.status === "blocked" &&
                      !!r.serverCopy.target &&
                      r.serverCopy.validity > 0)) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void upload(r, "verify")}
                    >
                      只读核对副本
                    </Button>
                  )}
                {["scheduled", "overdue", "paused"].includes(r.status) && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => {
                        setEditing(r.id);
                        setTime(
                          localDateTime(
                            new Date(
                              Math.max(
                                Date.now() + 3600000,
                                new Date(r.scheduledAt || "").getTime() || 0,
                              ),
                            ),
                          ),
                        );
                      }}
                    >
                      修改时间
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void cancel(r)}
                    >
                      取消计划并编辑
                    </Button>
                  </>
                )}
                {(r.status === "failed" || r.status === "uncertain") && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => void retry(r)}
                  >
                    {busy === r.id ? "正在准备…" : "编辑并准备重发"}
                  </Button>
                )}
                {r.status === "sent" && !r.archived && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => void archive(r)}
                  >
                    恢复本地副本
                  </Button>
                )}
                {["sent", "failed", "uncertain", "cancelled"].includes(
                  r.status,
                ) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => void remove(r)}
                  >
                    <Trash2 size={13} />
                    删除记录
                  </Button>
                )}
              </div>
            </div>
            {editing === r.id && (
              <SchedulePicker
                value={time}
                onChange={setTime}
                onConfirm={(time) => void reschedule(r.id, time)}
                onCancel={() => setEditing("")}
                busy={!!busy}
              />
            )}
          </article>
        ))}
        {!records.length && (
          <div className="panel-empty">
            <Send size={32} />
            <h3>
              {loading
                ? "正在读取发送记录…"
                : failure
                  ? "读取失败"
                  : "暂无发送记录"}
            </h3>
            <p>{failure || "从这里查询发送结果，失败邮件可准备重发。"}</p>
          </div>
        )}
      </div>
      {confirmationDialog}
    </section>
  );
}
