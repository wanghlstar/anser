import { useEffect, useMemo, useState } from "react";
import { Ban, Pencil, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type {
  Contact,
  ContactCandidate,
  ContactImportResult,
} from "@/lib/types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ContactHistoryDialog({
  open,
  contacts,
  onClose,
  onImported,
}: {
  open: boolean;
  contacts: Contact[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<string[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ContactCandidate | null>(null);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setSearch("");
    setCandidates([]);
    setSelected(new Set());
    setBlocked([]);
    setShowBlocked(false);
    void Promise.all([
      call<ContactCandidate[]>("contact_history"),
      call<string[]>("contact_blacklist"),
    ])
      .then(([list, ignored]) => {
        if (!live) return;
        setCandidates(list);
        setBlocked(ignored);
        const existing = new Set(
          contacts.map((contact) => contact.email.toLowerCase()),
        );
        setSelected(
          new Set(
            list
              .filter(
                (candidate) =>
                  candidate.count >= 2 &&
                  !existing.has(candidate.email.toLowerCase()),
              )
              .map((candidate) => candidate.email.toLowerCase()),
          ),
        );
      })
      .catch((error) => {
        if (live) toast.error(String(error));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open]);

  const existing = useMemo(
    () => new Set(contacts.map((contact) => contact.email.toLowerCase())),
    [contacts],
  );
  const blockedSet = useMemo(
    () => new Set(blocked.map((email) => email.toLowerCase())),
    [blocked],
  );
  const visible = candidates.filter(
    (candidate) =>
      !blockedSet.has(candidate.email.toLowerCase()) &&
      `${candidate.name} ${candidate.email}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectable = visible.filter(
    (candidate) => !existing.has(candidate.email.toLowerCase()),
  );
  const allSelected =
    selectable.length > 0 &&
    selectable.every((candidate) =>
      selected.has(candidate.email.toLowerCase()),
    );

  function toggle(email: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(email.toLowerCase());
      else next.delete(email.toLowerCase());
      return next;
    });
  }

  async function blockCandidate(candidate: ContactCandidate) {
    const email = candidate.email.toLowerCase();
    try {
      await call("set_contact_ignored", { email, ignored: true });
      setBlocked((current) =>
        [...new Set([...current, email])].sort((a, b) => a.localeCompare(b)),
      );
      setCandidates((current) =>
        current.filter((item) => item.email.toLowerCase() !== email),
      );
      setSelected((current) => {
        const next = new Set(current);
        next.delete(email);
        return next;
      });
      toast.success(`已屏蔽 ${email}`, {
        action: {
          label: "撤销",
          onClick: () => void unblockCandidate(email),
        },
      });
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function unblockCandidate(email: string) {
    try {
      await call("set_contact_ignored", { email, ignored: false });
      setBlocked((current) =>
        current.filter((item) => item.toLowerCase() !== email.toLowerCase()),
      );
      const list = await call<ContactCandidate[]>("contact_history");
      setCandidates(list);
      toast.success(`已解除屏蔽 ${email}`);
    } catch (error) {
      toast.error(String(error));
    }
  }

  function saveCandidateName() {
    if (!editing) return;
    const email = editing.email.toLowerCase();
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.email.toLowerCase() === email
          ? { ...candidate, name: draftName.trim() }
          : candidate,
      ),
    );
    setEditing(null);
  }

  async function importSelected() {
    const chosen = candidates.filter(
      (candidate) =>
        selected.has(candidate.email.toLowerCase()) &&
        !existing.has(candidate.email.toLowerCase()),
    );
    if (!chosen.length) return;
    setBusy(true);
    try {
      const result = await call<ContactImportResult>("import_contacts", {
        candidates: chosen,
      });
      toast.success(
        `已导入 ${result.imported} 位联系人` +
          (result.skipped ? `，跳过 ${result.skipped} 位已有联系人` : ""),
      );
      onImported();
      onClose();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>从历史邮件导入联系人</DialogTitle>
          <DialogDescription>
            从本地邮件中收集往来地址，已排除自己的账号和系统地址。告警、通知类地址可点右侧屏蔽，之后不再出现在候选和写信补全中；导入后可在通讯录中修改姓名。
          </DialogDescription>
        </DialogHeader>
        <div className="contact-history-search">
          <Search size={16} />
          <Input
            aria-label="搜索历史联系人"
            placeholder="搜索姓名或邮箱…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="contact-history-toolbar">
          <span>
            {loading
              ? "正在扫描历史邮件…"
              : `${selectable.length} 位可导入，已选 ${selected.size} 位`}
          </span>
          <div className="flex items-center gap-1">
            {blocked.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowBlocked((value) => !value)}
              >
                {showBlocked ? "返回候选" : `已屏蔽 ${blocked.length}`}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading || !selectable.length}
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(
                        selectable.map((candidate) =>
                          candidate.email.toLowerCase(),
                        ),
                      ),
                )
              }
            >
              {allSelected ? "清空" : "全选"}
            </Button>
          </div>
        </div>
        {showBlocked && blocked.length > 0 && (
          <div className="contact-history-blocked">
            <div className="contact-history-blocked-head">
              已屏蔽的地址不会出现在候选和写信补全中
            </div>
            {blocked.map((email) => (
              <div className="contact-history-blocked-row" key={email}>
                <span>{email}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void unblockCandidate(email)}
                >
                  解除
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="contact-history-list">
          {visible.map((candidate) => {
            const email = candidate.email.toLowerCase();
            const known = existing.has(email);
            return (
              <div
                className={`contact-history-row ${known ? "known" : ""}`}
                key={email}
              >
                <Checkbox
                  id={`contact-history-${email}`}
                  checked={known || selected.has(email)}
                  disabled={known}
                  onCheckedChange={(value) => toggle(email, value === true)}
                />
                <span className="contact-history-avatar">
                  <UsersRound size={16} />
                </span>
                <Label
                  className="contact-history-main"
                  htmlFor={`contact-history-${email}`}
                >
                  <strong>{candidate.name || candidate.email}</strong>
                  {candidate.name && <small>{candidate.email}</small>}
                </Label>
                <span className="contact-history-meta">
                  {known ? "已在通讯录" : `${candidate.count} 封往来`}
                  {candidate.lastSeen && (
                    <small>{candidate.lastSeen.slice(0, 10)}</small>
                  )}
                </span>
                {!known && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="contact-history-edit"
                    title={`编辑 ${candidate.email} 的姓名`}
                    aria-label={`编辑 ${candidate.email} 的姓名`}
                    onClick={() => {
                      setEditing(candidate);
                      setDraftName(candidate.name);
                    }}
                  >
                    <Pencil size={13} />
                  </Button>
                )}
                {!known && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="contact-history-block"
                    title={`屏蔽 ${candidate.email}`}
                    aria-label={`屏蔽 ${candidate.email}`}
                    onClick={() => void blockCandidate(candidate)}
                  >
                    <Ban size={14} />
                  </Button>
                )}
              </div>
            );
          })}
          {!loading && !visible.length && (
            <div className="panel-empty contact-history-empty">
              <UsersRound size={28} />
              <h3>{search ? "没有匹配的地址" : "没有可导入的地址"}</h3>
              <p>历史邮件中的往来地址会显示在这里。</p>
            </div>
          )}
        </div>
        <div className="contact-history-footer">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy || !selected.size}
            onClick={() => void importSelected()}
          >
            {busy ? "正在导入…" : `导入 ${selected.size} 位联系人`}
          </Button>
        </div>
        <Dialog
          open={!!editing}
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
        >
          <DialogContent className="sm:max-w-[380px]">
            <DialogHeader>
              <DialogTitle>修改导入姓名</DialogTitle>
              <DialogDescription>
                {editing?.email}；只影响本次导入，可在通讯录里继续修改。
              </DialogDescription>
            </DialogHeader>
            <form
              className="contact-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveCandidateName();
              }}
            >
              <div className="field">
                <Label htmlFor="contact-history-name">姓名</Label>
                <Input
                  id="contact-history-name"
                  autoFocus
                  value={draftName}
                  placeholder={editing?.email}
                  onChange={(event) => setDraftName(event.target.value)}
                />
              </div>
              <div className="contact-history-footer">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button type="submit">保存姓名</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
