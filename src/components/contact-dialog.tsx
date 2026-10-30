import { useEffect, useState } from "react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Contact } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ContactDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSaved?: (contact: Contact) => void;
}) {
  const [editing, setEditing] = useState<Contact | null>(contact);
  const [busy, setBusy] = useState(false);
  useEffect(() => setEditing(contact), [contact]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await call("save_contact", { contact: editing });
      toast.success("联系人已保存");
      onSaved?.(editing);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!contact}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[430px]">
        <DialogHeader>
          <DialogTitle>联系人信息</DialogTitle>
          <DialogDescription>
            姓名可改，保存后用于阅读显示和写信补全。
          </DialogDescription>
        </DialogHeader>
        {editing && (
          <form
            className="contact-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="field">
              <Label htmlFor="contact-name">姓名</Label>
              <Input
                id="contact-name"
                autoFocus
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </div>
            <div className="field">
              <Label htmlFor="contact-email">邮箱</Label>
              <Input
                id="contact-email"
                type="email"
                required
                value={editing.email}
                onChange={(event) =>
                  setEditing({ ...editing, email: event.target.value })
                }
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "正在保存…" : "保存联系人"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
