import { FileText, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation";
import { call } from "@/lib/api";
import type { Compose } from "@/lib/types";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";

function preview(draft: Compose) {
  return draft.body.trim().slice(0, 120) || "空白草稿";
}

// 草稿箱：顶部「草稿箱」与账号内草稿文件夹共用；紧凑两行、宽度自适应。
export function DraftsPanel({
  drafts,
  title,
  description,
  onOpen,
  onDeleted,
  onCompose,
}: {
  drafts: Compose[];
  title: string;
  description: string;
  onOpen: (draft: Compose) => void;
  onDeleted: () => void;
  onCompose?: () => void;
}) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  async function remove(draft: Compose) {
    if (
      !(await askConfirmation({
        title: "删除草稿？",
        description: "这份草稿删除后无法恢复。",
        action: "删除草稿",
        destructive: true,
      }))
    )
      return;
    try {
      await call("delete_draft", { id: draft.id });
      onDeleted();
    } catch (e) {
      toast.error(String(e));
    }
  }
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <div className="page-title-row">
            <SidebarTrigger title="切换侧边栏" aria-label="切换侧边栏" />
            <h1>{title}</h1>
          </div>
          <p>{description}</p>
        </div>
        {onCompose && (
          <Button onClick={onCompose}>
            <SquarePen size={16} />
            写邮件
          </Button>
        )}
      </div>
      {drafts.length ? (
        <div className="draft-list">
          {drafts.map((d) => (
            <article className="draft-row" key={d.id}>
              <Button
                variant="ghost"
                className="draft-row-main"
                onClick={() => onOpen(d)}
              >
                <span className="draft-row-head">
                  <strong className="draft-subject">
                    {d.subject || "（无主题）"}
                  </strong>
                  <small className="draft-recipient">
                    {d.to || "尚未填写收件人"}
                  </small>
                </span>
                <span className="draft-preview">{preview(d)}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="删除草稿"
                aria-label={`删除草稿 ${d.subject || ""}`}
                onClick={() => void remove(d)}
              >
                <Trash2 size={15} />
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          <FileText size={36} />
          <h3>暂时没有草稿</h3>
          <p>每一封没写完的邮件，都会在这里等你。</p>
        </div>
      )}
      {confirmationDialog}
    </section>
  );
}
