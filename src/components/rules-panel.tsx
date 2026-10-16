import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import {
  Plus,
  Upload,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  SlidersHorizontal,
  Trash2,
  Play,
  Folder,
  Star,
  MailCheck,
  MoreHorizontal,
  Download,
  ChevronRight,
} from "lucide-react";
import { SidebarTrigger } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import type { Rule, Snapshot, FolderSettings } from "@/lib/types";
import { call, isDemo } from "@/lib/api";
import { toast } from "sonner";
import { SelectGroup } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import {
  ruleActionsDeduped,
  isRemoteRule,
  isMoveAction,
  toggleMergedAction,
  groupRulesByAccount,
} from "@/lib/rule-match";
import { RuleServerFolders } from "./rule-server-folders";
import { RuleExecutions } from "./rule-executions";
import { FolderInput } from "./folder-input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

const fields: { [key: string]: string } = {
  sender: "发件人",
  recipients: "收件人",
  subject: "主题",
  body: "正文",
  attachment: "有附件",
  date: "邮件日期",
};
const actions: { [key: string]: string } = {
  // 用户层只有一个「移动到文件夹」：IMAP 落地为服务器移动，POP3 退化为本地归类。
  // serverCopy 仅用于兼容旧规则展示。
  move: "移动到文件夹",
  folder: "移动到文件夹",
  serverMove: "移动到文件夹",
  read: "标记为已读",
  unread: "标记为未读",
  star: "添加星标",
  trash: "移到本地废纸篓",
  serverCopy: "复制到服务器文件夹",
};
/** 可勾选的动作：合并后的移动动作独占，其余本地动作可叠加。 */
const ALL_ACTIONS: [string, string][] = [
  ["move", "移动到文件夹"],
  ["read", "标记为已读"],
  ["unread", "标记为未读"],
  ["star", "添加星标"],
  ["trash", "移到本地废纸篓"],
];
export function RulesPanel({
  data,
  onChange,
  onShowTasks,
}: {
  data: Snapshot;
  onChange: () => void;
  onShowTasks: () => void;
}) {
  const [editing, setEditing] = useState<Rule | null>(null),
    [busy, setBusy] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [exportAccounts, setExportAccounts] = useState<string[]>([]),
    [exportGlobal, setExportGlobal] = useState(true),
    [preview, setPreview] = useState<string[] | null>(null);
  const [folderNames, setFolderNames] = useState<
    Record<string, Record<string, string>>
  >({});
  const remoteAccounts = [
    ...new Set(data.rules.filter(isRemoteRule).map((r) => r.accountId)),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    let live = true;
    for (const id of remoteAccounts.split(",").filter(Boolean))
      void call<FolderSettings>("folder_settings", { id })
        .then((s) => {
          if (live)
            setFolderNames((names) => ({
              ...names,
              [id]: Object.fromEntries(
                s.folders.map((f) => [f.name, f.displayName]),
              ),
            }));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [remoteAccounts]);
  const folderLabel = (r: Rule, path: string, fallback: string) =>
    // 优先用快照里的服务器目录展示名做转码；加载中再退回 folder_settings
    data.remoteFolders?.find(
      (f) => f.accountId === r.accountId && f.name === path,
    )?.displayName ||
    folderNames[r.accountId]?.[path] ||
    (path === "INBOX" ? "收件箱" : fallback);
  /// 合并动作「移动到文件夹」在哪些账号上走真正的服务器移动：
  /// 已启用的 IMAP 账号（Gmail 标签动作暂不支持，退化为本地归类）。
  const serverMoveCapable = (accountId: string) => {
    const a = data.accounts.find((x) => x.id === accountId);
    return !!a && a.enabled && a.protocol === "imap" && a.provider !== "gmail";
  };
  async function save(rs: Rule[]) {
    try {
      await call("save_rules", { rules: rs });
      onChange();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    }
  }
  async function importRules() {
    if (isDemo()) {
      toast.error("演示模式不支持导入");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [{ name: "规则 JSON", extensions: ["json"] }],
        title: "选择规则文件",
      });
      if (!picked || typeof picked !== "string") return;
      const text = await call<string>("read_text_file", { path: picked });
      const parsed = JSON.parse(text) as Rule[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        toast.error("文件中没有可导入的规则");
        return;
      }
      const added = await call<number>("import_rules", { rules: parsed });
      toast.success(
        added ? `已导入 ${added} 条规则` : "没有新规则（同名已跳过）",
      );
      onChange();
    } catch (e) {
      toast.error(String(e));
    }
  }
  /// 导出：按账号筛选（默认带上全局规则），保持执行顺序写盘。
  async function exportRules() {
    if (isDemo()) {
      toast.error("演示模式不支持导出");
      return;
    }
    const accounts = data.accounts;
    if (!accounts.length) {
      toast.error("没有可导出的账号");
      return;
    }
    setExportAccounts(accounts.map((a) => a.id));
    setExportGlobal(true);
    setExportOpen(true);
  }
  async function confirmExport() {
    if (isDemo()) {
      toast.error("演示模式不支持导出");
      return;
    }
    setExportOpen(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const picked = await save({
        filters: [{ name: "规则 JSON", extensions: ["json"] }],
        defaultPath: `雁信规则-${new Date().toISOString().slice(0, 10)}.json`,
        title: "导出规则到",
      });
      if (!picked) return;
      const rules = await call<Rule[]>("export_rules", {
        accountIds: exportAccounts,
        includeGlobal: exportGlobal,
      });
      if (!rules.length) {
        toast.error("没有符合所选条件的规则");
        return;
      }
      await call("write_text_file", {
        path: picked,
        content: JSON.stringify(rules, null, 2),
      });
      toast.success(`已导出 ${rules.length} 条规则`);
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function run() {
    setBusy(true);
    try {
      const n = await call<number>("run_rules");
      toast.success(`规则已处理，共匹配 ${n} 次；服务器动作结果见执行记录`);
      onChange();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  function move(i: number, d: number) {
    const rs = [...data.rules];
    [rs[i], rs[i + d]] = [rs[i + d], rs[i]];
    void save(rs);
  }
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">A LITTLE ORDER</span>
          <div className="page-title-row">
            <SidebarTrigger title="切换侧边栏" aria-label="切换侧边栏" />
            <h1>让邮件，自动归位</h1>
          </div>
          <p>设置一次规则，把更多时间留给重要的事。</p>
        </div>
        <div className="page-title-actions">
          <Button
            variant="outline"
            onClick={() => void importRules()}
            disabled={busy}
          >
            <Upload size={16} />
            导入…
          </Button>
          <Button
            variant="outline"
            onClick={() => void exportRules()}
            disabled={busy}
          >
            <Download size={16} />
            导出…
          </Button>
          <Button
            onClick={() => {
              setPreview(null);
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                accountId: "",
                enabled: true,
                mode: "all",
                conditions: [
                  { field: "subject", operator: "contains", value: "" },
                ],
                action: "",
                destination: "",
                stop: true,
              });
            }}
          >
            <Plus size={16} />
            新建规则
          </Button>
        </div>
      </div>
      <div className="info-strip">
        <SlidersHorizontal size={17} />
        <span>
          规则按顺序执行。「移动到文件夹」在 IMAP
          账号走服务器移动，其它账号为本地归类。
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={run}
          disabled={busy || !data.rules.length}
        >
          <Play size={14} />
          {busy ? "执行中…" : "对已有邮件执行"}
        </Button>
      </div>
      <div className="rule-list">
        {groupRulesByAccount(data.rules, data.accounts).map((group) => (
          <Collapsible key={group.key} className="rule-group-card">
            <div className="rule-group-heading">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-0">
                  <ChevronRight size={14} className="collapse-chevron" />
                  {group.label}
                  <span className="rule-group-count">
                    {group.rules.length} 条
                  </span>
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="flex flex-col gap-3">
              {group.rules.map(({ rule: r, order }) => (
                <article
                  className={`rule-card ${r.enabled ? "" : "disabled-rule"}`}
                  key={r.id}
                >
                  <div className="rule-number">
                    {String(order + 1).padStart(2, "0")}
                  </div>
                  <div className="rule-body">
                    <div className="rule-title">
                      <h3>{r.name}</h3>
                      {r.stop && <span>命中后停止</span>}
                    </div>
                    <p className="rule-summary">
                      <span className="rule-conditions">
                        {r.conditions
                          .map(
                            (c) =>
                              `${fields[c.field]} ${c.operator === "equals" ? "等于" : c.operator === "notContains" ? "不包含" : c.operator === "before" ? "早于" : c.operator === "after" ? "晚于" : "包含"}「${c.value}」`,
                          )
                          .join(r.mode === "all" ? " 且 " : " 或 ")}
                      </span>
                      <span className="rule-action">
                        <ArrowRight size={13} />
                        {ruleActionsDeduped(r).map((action) => (
                          <span className="rule-action-item" key={action}>
                            {isMoveAction({ action } as Rule) ? (
                              <Folder size={13} />
                            ) : action === "star" ? (
                              <Star size={13} />
                            ) : (
                              <MailCheck size={13} />
                            )}
                            {actions[action]}
                            {isMoveAction({ action } as Rule) &&
                              r.destination && (
                                <strong>
                                  {folderLabel(r, r.destination, r.destination)}
                                </strong>
                              )}
                          </span>
                        ))}
                      </span>
                    </p>
                  </div>
                  <div className="rule-controls">
                    <Switch
                      checked={r.enabled}
                      aria-label={`启用 ${r.name}`}
                      onCheckedChange={(v) =>
                        void save(
                          data.rules.map((x) =>
                            x.id === r.id ? { ...x, enabled: v } : x,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="上移"
                      disabled={order === 0}
                      onClick={() => move(order, -1)}
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="下移"
                      disabled={order === data.rules.length - 1}
                      onClick={() => move(order, 1)}
                    >
                      <ArrowDown size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="编辑规则"
                      onClick={() => {
                        setPreview(null);
                        setEditing(structuredClone(r));
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </Button>
                  </div>
                </article>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
        {!data.rules.length && (
          <div className="panel-empty">
            <SlidersHorizontal size={34} />
            <h3>收件箱有自己的秩序</h3>
            <p>试着把项目往来或账单自动归入一个本地文件夹。</p>
          </div>
        )}
      </div>
      <div className="quiet-note">
        无需保持邮箱网页打开。雁信在这台 Mac 上运行时，会自动处理新收到的邮件。
      </div>
      <RuleExecutions onShowTasks={onShowTasks} />
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[620px] sm:max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑过滤规则</DialogTitle>
            <DialogDescription>
              按账号和条件设置「移动到文件夹」或本地动作，预览后保存。
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="rule-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const rs = data.rules.some((r) => r.id === editing.id)
                  ? data.rules.map((r) => (r.id === editing.id ? editing : r))
                  : [...data.rules, editing];
                if (await save(rs)) {
                  setEditing(null);
                  toast.success("规则已保存");
                }
              }}
            >
              <div className="field">
                <Label>规则名称</Label>
                <Input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="例如：项目邮件自动归类"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <Label>适用账号</Label>
                  <SelectField
                    value={editing.accountId}
                    aria-label="规则适用账号"
                    onValueChange={(value) => {
                      const changed = value !== editing.accountId;
                      // 合并动作跟随账号：换账号后重新决定服务器移动还是本地归类
                      const action =
                        changed && isMoveAction(editing)
                          ? serverMoveCapable(value)
                            ? "serverMove"
                            : "folder"
                          : editing.action;
                      const next = { ...editing, accountId: value, action };
                      setEditing({
                        ...next,
                        ...(isRemoteRule(next) ? {} : { sourceFolder: "" }),
                        ...(changed ? { destination: "" } : {}),
                      });
                    }}
                  >
                    <SelectGroup>
                      <SelectOption value="" disabled={isRemoteRule(editing)}>
                        全部账号
                      </SelectOption>
                      {data.accounts.map((a) => (
                        <SelectOption
                          key={a.id}
                          value={a.id}
                          disabled={
                            isRemoteRule(editing) &&
                            (!a.enabled ||
                              a.protocol !== "imap" ||
                              a.provider === "gmail")
                          }
                        >
                          {a.email}
                        </SelectOption>
                      ))}
                    </SelectGroup>
                  </SelectField>
                </div>
                <div className="field">
                  <Label>匹配方式</Label>
                  <SelectField
                    value={editing.mode}
                    onValueChange={(value) =>
                      setEditing({
                        ...editing,
                        mode: value as "all" | "any",
                      })
                    }
                  >
                    <SelectGroup>
                      <SelectOption value="all">满足全部条件</SelectOption>
                      <SelectOption value="any">满足任一条件</SelectOption>
                    </SelectGroup>
                  </SelectField>
                </div>
              </div>
              <div className="conditions">
                {editing.conditions.map((c, i) => (
                  <div className="condition" key={i}>
                    <SelectField
                      aria-label="条件字段"
                      value={c.field}
                      onValueChange={(value) =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.map((x, j) =>
                            j === i
                              ? {
                                  field: value,
                                  operator:
                                    value === "date"
                                      ? "after"
                                      : value === "attachment"
                                        ? "equals"
                                        : "contains",
                                  value: value === "attachment" ? "true" : "",
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <SelectGroup>
                        {Object.entries(fields).map(([k, v]) => (
                          <SelectOption
                            key={k}
                            value={k}
                            disabled={isRemoteRule(editing) && k === "body"}
                          >
                            {v}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    <SelectField
                      aria-label="条件比较"
                      value={c.operator}
                      onValueChange={(value) =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.map((x, j) =>
                            j === i ? { ...x, operator: value } : x,
                          ),
                        })
                      }
                    >
                      <SelectGroup>
                        {(c.field === "date"
                          ? [
                              ["before", "早于"],
                              ["after", "晚于"],
                            ]
                          : c.field === "attachment"
                            ? [["equals", "等于"]]
                            : [
                                ["contains", "包含"],
                                ["equals", "等于"],
                                ["notContains", "不包含"],
                              ]
                        ).map(([k, v]) => (
                          <SelectOption key={k} value={k}>
                            {v}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    <Input
                      aria-label="条件值"
                      required
                      type={c.field === "date" ? "date" : "text"}
                      placeholder={
                        c.field === "attachment" ? "true / false" : "关键词"
                      }
                      value={c.value}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={editing.conditions.length === 1}
                      title="移除条件"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditing({
                    ...editing,
                    conditions: [
                      ...editing.conditions,
                      { field: "sender", operator: "contains", value: "" },
                    ],
                  })
                }
              >
                <Plus size={14} />
                添加条件
              </Button>
              <div className="field">
                <Label>执行动作</Label>
                <div className="rule-action-picker">
                  {ALL_ACTIONS.map(([k, v]) => {
                    const chosen =
                      k === "move"
                        ? isMoveAction(editing)
                        : ruleActionsDeduped(editing).includes(k);
                    return (
                      <Label
                        key={k}
                        className="rule-action-option"
                        htmlFor={`action-${k}`}
                      >
                        <Checkbox
                          id={`action-${k}`}
                          checked={chosen}
                          onCheckedChange={(next) => {
                            const on = next === true;
                            const action = toggleMergedAction(
                              editing,
                              k,
                              on,
                              serverMoveCapable(editing.accountId),
                            );
                            const updated = { ...editing, action };
                            // 切换移动或勾选废纸篓会改变移动本身：清掉移动的目标与来源
                            const clearingMove =
                              k === "move" || (k === "trash" && on);
                            setEditing({
                              ...updated,
                              ...(isRemoteRule(updated)
                                ? {}
                                : { sourceFolder: "" }),
                              ...(clearingMove ? { destination: "" } : {}),
                            });
                          }}
                        />
                        <span>{v}</span>
                      </Label>
                    );
                  })}
                </div>
                <p className="rule-action-hint">
                  {isMoveAction(editing)
                    ? isRemoteRule(editing)
                      ? "「移动到文件夹」通过服务器移动邮件，可搭配标记已读/未读/星标（本机立即生效）；与废纸篓互斥。"
                      : "本地归类可搭配标记已读/未读/星标；与废纸篓互斥。"
                    : "本地动作可多选叠加，例如「标记为已读 + 添加星标」。"}
                </p>
              </div>
              {isMoveAction(editing) &&
                (isRemoteRule(editing) ? (
                  <RuleServerFolders
                    rule={editing}
                    account={data.accounts.find(
                      (a) => a.id === editing.accountId,
                    )}
                    onChange={setEditing}
                    targetOnly
                  />
                ) : (
                  <div className="field">
                    <Label>移动到本地文件夹</Label>
                    {/* 目标列该账号已有的本地文件夹；也可输入新名称，
                        首次归类时自动创建 */}
                    <FolderInput
                      value={editing.destination}
                      onChange={(value) =>
                        setEditing({ ...editing, destination: value })
                      }
                      folders={data.folders}
                    />
                  </div>
                ))}
              <Label className="switch-label">
                <Switch
                  checked={editing.stop}
                  onCheckedChange={(v) => setEditing({ ...editing, stop: v })}
                />
                命中后停止执行后续规则
              </Label>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    setPreview(
                      await call<string[]>("preview_rule", { rule: editing }),
                    );
                  } catch (e) {
                    toast.error(String(e));
                  }
                }}
              >
                预览匹配，不执行动作
              </Button>
              {preview && (
                <div className="rule-preview">
                  本次预览匹配 {preview.length} 封
                  {preview.slice(0, 3).map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              )}
              <div className="dialog-actions">
                {data.rules.some((r) => r.id === editing.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive mr-auto"
                    onClick={async () => {
                      if (
                        await save(
                          data.rules.filter((r) => r.id !== editing.id),
                        )
                      )
                        setEditing(null);
                    }}
                  >
                    删除规则
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !ruleActionsDeduped(editing).length ||
                    (isMoveAction(editing) && !editing.destination.trim()) ||
                    (isRemoteRule(editing) &&
                      (!editing.accountId ||
                        editing.conditions.some((c) => c.field === "body") ||
                        !serverMoveCapable(editing.accountId)))
                  }
                >
                  保存规则
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>导出规则</DialogTitle>
            <DialogDescription>
              选择要导出的账号；规则按执行顺序导出，可迁移到其他电脑。
            </DialogDescription>
          </DialogHeader>
          <div className="rule-export-list">
            {data.accounts.map((a) => (
              <Label
                key={a.id}
                className="rule-action-option"
                htmlFor={`export-${a.id}`}
              >
                <Checkbox
                  id={`export-${a.id}`}
                  checked={exportAccounts.includes(a.id)}
                  onCheckedChange={(next) =>
                    setExportAccounts((ids) =>
                      next ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <span>{a.email}</span>
              </Label>
            ))}
          </div>
          <Label className="rule-action-option" htmlFor="export-global">
            <Checkbox
              id="export-global"
              checked={exportGlobal}
              onCheckedChange={(next) => setExportGlobal(next === true)}
            />
            <span>包含「全部账号」的通用规则</span>
          </Label>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!exportAccounts.length && !exportGlobal}
              onClick={() => void confirmExport()}
            >
              选择位置并导出
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
