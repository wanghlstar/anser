import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { compareFolders } from "@/lib/remote-folders";
import type { Account, RemoteFolder } from "@/lib/types";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { TaskPanelHeader } from "./task-panel-header";
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { SelectField, SelectOption } from "./ui/select-field";

const isInbox = (folder: RemoteFolder) => folder.name.toUpperCase() === "INBOX";

export function InboxScope({
  accounts,
  folders,
  onSaved,
}: {
  accounts: Account[];
  folders: RemoteFolder[];
  onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [loadedAccountId, setLoadedAccountId] = useState("");
  // 折叠状态独立于账号选择：默认收起，点箭头才展开勾选区。
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selectedAccount = useRef(accountId);
  selectedAccount.current = accountId;
  useEffect(() => {
    if (!accounts.some((a) => a.id === accountId))
      setAccountId(accounts[0]?.id || "");
  }, [accounts, accountId]);
  // 切换账号即重新加载该账号的配置，未保存的勾选不跨账号残留。
  useEffect(() => {
    setPicked(null);
    setLoadedAccountId("");
    setError("");
  }, [accountId]);
  const accountFolders = folders
    .filter((f) => f.accountId === accountId)
    .sort(compareFolders);
  const configured = accounts.find((a) => a.id === accountId)?.inboxFolders;
  const inboxNames = accountFolders.filter(isInbox).map((f) => f.name);
  const scope = configured?.length ? new Set(configured) : new Set(inboxNames);
  // 收件箱是必选项：旧配置里没有它时也补上，且不允许取消。
  const selected = new Set(
    picked && loadedAccountId === accountId ? picked : scope,
  );
  for (const name of inboxNames) selected.add(name);
  function toggle(name: string, checked: boolean) {
    if (inboxNames.includes(name)) return;
    const next = new Set(selected);
    if (checked) next.add(name);
    else next.delete(name);
    setPicked(next);
    setLoadedAccountId(accountId);
  }
  async function save(folders: string[] | null) {
    if (busy || !accountId || !accountFolders.length) return;
    const id = accountId;
    setBusy(true);
    setError("");
    try {
      await call("save_inbox_folders", { accountId: id, folders });
      if (selectedAccount.current === id) {
        setPicked(
          folders
            ? new Set(folders)
            : new Set(accountFolders.filter(isInbox).map((f) => f.name)),
        );
        setLoadedAccountId(id);
        toast.success(
          folders ? "全部收件箱范围已保存" : "已恢复默认：只含收件箱",
        );
        // 保存成功后自动折叠。
        setExpanded(false);
        onSaved();
      }
    } catch (e) {
      if (selectedAccount.current === id) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="settings-scope-card">
        <TaskPanelHeader
          title="全部收件箱"
          description="收件箱始终计入全部/未读视图；再选择要合并的其他文件夹。"
          controls="inbox-scope-content"
          disabled={!accountId}
          action={
            <div className="flex flex-col items-end gap-1">
              <Field className="w-56 max-w-full">
                <FieldLabel className="sr-only">配置账号</FieldLabel>
                <SelectField
                  aria-label="配置账号"
                  value={accountId}
                  disabled={busy || !accounts.length}
                  onValueChange={setAccountId}
                >
                  {accounts.map((a) => (
                    <SelectOption key={a.id} value={a.id}>
                      {a.name} · {a.email}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
              <span className="text-sm text-muted-foreground">
                {configured?.length
                  ? `已配置 ${configured.length} 个文件夹`
                  : "未配置：只含收件箱"}
              </span>
            </div>
          }
        />
        {error && (
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>范围未保存</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CollapsibleContent id="inbox-scope-content" asChild>
          <CardContent className="flex flex-col gap-4">
            {accountFolders.length ? (
              <FieldGroup className="inbox-scope-grid">
                {accountFolders.map((folder, index) => (
                  <Field key={folder.name} orientation="horizontal">
                    <Checkbox
                      id={`inbox-scope-folder-${index}`}
                      checked={isInbox(folder) || selected.has(folder.name)}
                      disabled={busy || isInbox(folder)}
                      onCheckedChange={(checked) =>
                        toggle(folder.name, checked === true)
                      }
                    />
                    <FieldLabel htmlFor={`inbox-scope-folder-${index}`}>
                      {folder.displayName || folder.name}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无服务器目录，请先到账号菜单展开并同步文件夹。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || !accountId || !accountFolders.length}
                onClick={() =>
                  void save(
                    accountFolders
                      .filter((f) => selected.has(f.name))
                      .map((f) => f.name),
                  )
                }
              >
                保存范围
              </Button>
              {!!configured?.length && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save(null)}
                >
                  恢复默认
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
