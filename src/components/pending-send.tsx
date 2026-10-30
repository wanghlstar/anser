import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { prepareCompose } from "@/lib/compose-format";
import type { Compose } from "@/lib/types";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

// 发送倒计时：写信窗口收起后仍在后台走完，期间可以操作其他功能。
// 撤回只丢弃这次发送，邮件仍以草稿保留，可从草稿箱继续编辑。
export function PendingSend({
  draft,
  seconds,
  onDone,
  onCancel,
}: {
  draft: Compose;
  seconds: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds),
    [sending, setSending] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const started = useRef(false);
  async function deliver() {
    if (started.current) return;
    started.current = true;
    setSending(true);
    try {
      toast.success(
        await call<string>("send_mail", { draft: prepareCompose(draft) }),
      );
      onDone();
    } catch (e) {
      setFailed(true);
      started.current = false;
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  useEffect(() => {
    if (remaining > 0) {
      const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (!started.current) void deliver();
    // attempt 让「重新发送」在 remaining 仍为 0 时也能再次触发 deliver
  }, [remaining, attempt]);
  const subject = draft.subject || "（无主题）";
  return (
    <div className="pending-send" role="status" aria-live="polite">
      <div className="pending-send-body">
        <strong>
          {sending
            ? "正在发送…"
            : failed
              ? "发送失败，可以重试"
              : `「${subject}」将在 ${remaining} 秒后发送`}
        </strong>
        <Progress
          value={
            sending || failed ? 100 : ((seconds - remaining) / seconds) * 100
          }
          aria-label="发送倒计时进度"
        />
      </div>
      <div className="pending-send-actions">
        {failed ? (
          <Button
            size="sm"
            disabled={sending}
            onClick={() => {
              started.current = false;
              setFailed(false);
              setRemaining(0);
              setAttempt((n) => n + 1);
            }}
          >
            <Send size={14} />
            重新发送
          </Button>
        ) : (
          <Button size="sm" disabled={sending} onClick={() => setRemaining(0)}>
            {sending ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : (
              <Send size={14} />
            )}
            立即发送
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={sending}
          onClick={onCancel}
        >
          <Undo2 size={14} />
          撤回
        </Button>
      </div>
    </div>
  );
}
