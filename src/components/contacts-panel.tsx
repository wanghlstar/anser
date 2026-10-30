import { useConfirmation } from "@/hooks/use-confirmation";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  UserRound,
  UsersRound,
  Pencil,
  Trash2,
  Mail,
} from "lucide-react";
import { call } from "@/lib/api";
import type { Address, Contact } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarTrigger } from "./ui/sidebar";
import { toast } from "sonner";
import { ContactDialog } from "./contact-dialog";
import { ContactHistoryDialog } from "./contact-history-dialog";

export function ContactsPanel({
  initial,
  onCompose,
  onChanged,
}: {
  initial: Address | null;
  onCompose: (address: Address) => void;
  onChanged?: () => void;
}) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [contacts, setContacts] = useState<Contact[]>([]),
    [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contact | null>(
    initial ? { ...initial, id: crypto.randomUUID() } : null,
  );
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  async function refresh() {
    try {
      setContacts(await call<Contact[]>("list_contacts"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const visible = contacts.filter((c) =>
    `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <div className="page-title-row">
            <SidebarTrigger />
            <h1>通讯录</h1>
          </div>
          <p>{contacts.length} 位本地联系人</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <UsersRound size={16} />
            从历史邮件导入
          </Button>
          <Button
            onClick={() =>
              setEditing({ id: crypto.randomUUID(), name: "", email: "" })
            }
          >
            <Plus size={16} />
            添加联系人
          </Button>
        </div>
      </div>
      <div className="contact-search">
        <Search size={16} />
        <Input
          aria-label="搜索联系人"
          placeholder="搜索姓名或邮箱…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="contact-list">
        {visible.map((c) => (
          <article className="contact-card" key={c.id}>
            <span className="contact-avatar">
              <UserRound size={19} />
            </span>
            <div>
              <strong>{c.name || c.email}</strong>
              <p>{c.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title="撰写邮件"
              onClick={() => onCompose(c)}
            >
              <Mail size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="编辑联系人"
              onClick={() => setEditing(c)}
            >
              <Pencil size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="删除联系人"
              onClick={async () => {
                if (
                  await askConfirmation({
                    title: "删除联系人？",
                    description: `删除 ${c.name || c.email} 的本地联系人记录。邮件及历史往来不受影响。`,
                    action: "删除联系人",
                    destructive: true,
                  })
                )
                  void call("delete_contact", { id: c.id })
                    .then(() => {
                      onChanged?.();
                      return refresh();
                    })
                    .catch((e) => toast.error(String(e)));
              }}
            >
              <Trash2 size={15} />
            </Button>
          </article>
        ))}
        {!visible.length && (
          <div className="panel-empty">
            <UserRound size={32} />
            <h3>
              {loading
                ? "正在读取联系人…"
                : search
                  ? "没有匹配的联系人"
                  : "保存常用联系人"}
            </h3>
            <p>也可以从邮件发件人菜单中添加。</p>
          </div>
        )}
      </div>
      <ContactDialog
        contact={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          void refresh();
          onChanged?.();
        }}
      />
      <ContactHistoryDialog
        open={historyOpen}
        contacts={contacts}
        onClose={() => setHistoryOpen(false)}
        onImported={() => {
          void refresh();
          onChanged?.();
        }}
      />
      {confirmationDialog}
    </section>
  );
}
