import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { call, isDemo, native } from "@/lib/api";
import { decodeImapFolderName } from "@/lib/remote-folders";
import type {
  ArchiveGroup,
  ExportResult,
  LocalArchiveGroup,
  Snapshot,
  TierInfo,
} from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  SelectField,
  SelectGroup,
  SelectLabel,
  SelectOption,
} from "./ui/select-field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import { toast } from "sonner";

type ImportItem = {
  ordinal: number;
  filename: string;
  status: string;
  error: string;
  warnings: number;
  mailId: string;
};
type ImportJob = {
  id: string;
  accountId: string;
  folder: string;
  status: string;
  total: number;
  bytes: number;
  processed: number;
  added: number;
  upgraded: number;
  duplicate: number;
  failed: number;
  warnings: number;
  error: string;
  items: ImportItem[];
};
type Outcome = { title: string; summary: string; errors: string[] };

type ImportAccount = {
  id: string;
  name: string;
  email: string;
};

const importActive = (job: ImportJob | null) =>
  !!job && ["queued", "running"].includes(job.status);
function importState(job: ImportJob) {
  if (job.status === "completed") return "已完成";
  if (job.status === "cancelled") return "已取消";
  if (job.status === "interrupted") return "已中断";
  if (job.status === "queued") return "排队中";
  return "导入中";
}

export function ArchiveIo({
  onChanged,
}: {
  onChanged?: () => void;
} = {}) {
  const [exporting, setExporting] = useState(false);
  const [exportFlat, setExportFlat] = useState(false);
  const [starting, setStarting] = useState(false);
  const [importPaths, setImportPaths] = useState<string[] | null>(null);
  const [mboxPath, setMboxPath] = useState<string | null>(null);
  const [importTreePath, setImportTreePath] = useState<string | null>(null);
  const [importAccount, setImportAccount] = useState("");
  const [importFolder, setImportFolder] = useState("");
  const [importGroupName, setImportGroupName] = useState("");
  const [newGroupMode, setNewGroupMode] = useState<"custom" | "auto">("custom");
  const [job, setJob] = useState<ImportJob | null>(null);
  const [recentJob, setRecentJob] = useState<ImportJob | null>(null);
  const finalized = useRef(new Set<string>());
  const importing = starting || importActive(job);
  const [folderOptions, setFolderOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [importAccounts, setImportAccounts] = useState<ImportAccount[]>([]);
  const [tier, setTier] = useState<TierInfo | null>(null);
  const importDialogOpen =
    importPaths !== null || mboxPath !== null || importTreePath !== null;

  async function exportAll() {
    if (isDemo()) {
      toast.error("演示模式不支持导出");
      return;
    }
    if (!native) {
      toast.error("真实邮件可在桌面客户端中导出为 EML");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        title: "选择导出目录",
      });
      if (!picked || typeof picked !== "string") return;
      setExporting(true);
      toast.loading("正在后台导出全部邮件…", { id: "archive-export" });
      const result = await call<ExportResult>("export_all_mails", {
        folders: !exportFlat,
        directory: picked,
      });
      if (result.errors.length) {
        setOutcome({
          title: "导出完成，部分邮件失败",
          summary: `已导出 ${result.exported} 封，跳过 ${result.skipped} 封，${result.errors.length} 封失败。`,
          errors: result.errors,
        });
        toast.warning(
          `已导出 ${result.exported} 封，${result.errors.length} 封失败`,
          { id: "archive-export" },
        );
      } else {
        toast.success(
          `已导出 ${result.exported} 封邮件` +
            (result.skipped ? `，跳过 ${result.skipped} 封重复` : ""),
          { id: "archive-export" },
        );
      }
    } catch (e) {
      toast.error(String(e), { id: "archive-export" });
    } finally {
      setExporting(false);
    }
  }

  async function startImport(paths: string[], tree: string | null = null) {
    if (!importAccount) return;
    if (!tree && !importFolder.trim()) {
      toast.error("请选择或输入目标文件夹");
      return;
    }
    setStarting(true);
    try {
      let accountId = importAccount;
      let prefix = importFolder.trim();
      if (tree && accountId === "new-group") {
        const folderName =
          newGroupMode === "auto"
            ? tree.split(/[\/]/).filter(Boolean).pop()?.trim() || ""
            : importGroupName.trim();
        if (!folderName) {
          toast.error("请输入新组名称");
          setStarting(false);
          return;
        }
        const groups = await call<ArchiveGroup[]>("archive_groups").catch(
          () => [],
        );
        const existing = groups.find((group) => group.name === folderName);
        const group =
          existing ??
          (await call<ArchiveGroup>("create_archive_group", {
            name: folderName,
          }));
        accountId = group.id;
        prefix = "";
      }
      const prepared = tree
        ? await call<ImportJob>("prepare_eml_import_tree", {
            root: tree,
            accountId,
            folder: prefix,
          })
        : await call<ImportJob>("prepare_eml_import", {
            paths,
            accountId,
            folder: importFolder.trim(),
          });
      await call("eml_import_action", { id: prepared.id, action: "start" });
      const queued = await call<ImportJob>("eml_import_job", {
        id: prepared.id,
      });
      setJob(queued);
      setRecentJob(queued);
    } catch (e) {
      toast.error(String(e), { id: "archive-import" });
    } finally {
      setStarting(false);
    }
  }

  async function cancelImport() {
    if (!job) return;
    try {
      await call("eml_import_action", { id: job.id, action: "cancel" });
      setJob(await call<ImportJob>("eml_import_job", { id: job.id }));
    } catch (e) {
      toast.error(String(e), { id: "archive-import" });
    }
  }

  useEffect(() => {
    if (!native || isDemo()) return;
    let live = true;
    void call<ImportJob[]>("eml_import_jobs")
      .then((jobs) => {
        if (!live) return;
        const active = jobs.find((item) => importActive(item));
        if (active) {
          setJob(active);
          setRecentJob(active);
        } else if (jobs[0]) setRecentJob(jobs[0]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!job || !importActive(job)) return;
    let live = true;
    const tick = async () => {
      try {
        const next = await call<ImportJob>("eml_import_job", { id: job.id });
        if (live) {
          setJob(next);
          setRecentJob(next);
        }
      } catch {
        // 任务可能刚被取消；下一次刷新会得到终态。
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!importDialogOpen || !native || isDemo()) return;
    let live = true;
    void call<TierInfo>("archive_tier_info")
      .then((value) => {
        if (live) setTier(value);
      })
      .catch(() => {
        if (live) setTier(null);
      });
    return () => {
      live = false;
    };
  }, [importDialogOpen]);
  useEffect(() => {
    if (!job || importActive(job) || finalized.current.has(job.id)) return;
    finalized.current.add(job.id);
    setRecentJob(job);
    const errors = job.items
      .filter((item) => item.status === "failed")
      .map((item) => `${item.filename}：${item.error || "导入失败"}`);
    if (job.added + job.upgraded > 0) onChanged?.();
    if (errors.length || job.status !== "completed") {
      setOutcome({
        title:
          job.status === "completed"
            ? "导入完成，部分邮件失败"
            : `导入${importState(job)}`,
        summary: `新增 ${job.added} 封，补全 ${job.upgraded} 封，重复 ${job.duplicate} 封，失败 ${job.failed} 封。`,
        errors,
      });
      toast.warning(`导入${importState(job)}，${job.failed} 封失败`, {
        id: "archive-import",
      });
    } else {
      toast.success(
        `已导入 ${job.added} 封邮件` +
          (job.upgraded ? `，补全 ${job.upgraded} 封` : "") +
          (job.duplicate ? `，跳过 ${job.duplicate} 封重复` : ""),
        { id: "archive-import" },
      );
    }
    setImportPaths(null);
    setMboxPath(null);
    setImportTreePath(null);
  }, [job, onChanged]);

  async function loadImportFolders(accountId: string) {
    if (accountId === "new-group") {
      setFolderOptions([]);
      return;
    }
    const options: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    const add = (value: string, label: string) => {
      if (!value || value === "本地导入" || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };
    try {
      const tree = await call<LocalArchiveGroup[]>("local_archive_tree");
      for (const folder of tree.find((g) => g.accountId === accountId)
        ?.folders ?? []) {
        add(
          folder.name,
          folder.displayName || decodeImapFolderName(folder.name),
        );
      }
    } catch {
      // 本地目录读取失败时仍可手工输入目标文件夹
    }
    setFolderOptions(options);
  }

  async function pickImportAccount(
    paths: string[] | null,
    mbox: string | null,
    tree: string | null = null,
  ) {
    const snapshot = await call<Snapshot>("snapshot", {
      query: {
        view: "local",
        accountId: "",
        search: "",
        folder: "",
        limit: 1,
        unreadOnly: false,
      },
    });
    const groups = await call<ArchiveGroup[]>("archive_groups").catch(() => []);
    const accounts: ImportAccount[] = [
      ...(snapshot.accounts ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email,
      })),
      ...groups.map((group) => ({
        id: group.id,
        name: group.name,
        email: "本地归档",
      })),
      ...(tree
        ? [{ id: "new-group", name: "本地归档 · 新建组", email: "" }]
        : []),
    ];
    if (!accounts.length) {
      toast.error("请先添加邮箱账号或归档组");
      return;
    }
    setImportAccounts(accounts);
    const initial = tree ? "new-group" : accounts[0].id;
    setImportAccount(initial);
    setImportFolder("");
    setImportGroupName("");
    setNewGroupMode("custom");
    setFolderOptions([]);
    if (!importActive(job)) setJob(null);
    void loadImportFolders(initial);
    setImportPaths(paths);
    setMboxPath(mbox);
    setImportTreePath(tree);
  }

  async function importEmls() {
    if (isDemo()) {
      toast.error("演示模式不支持导入");
      return;
    }
    if (!native) {
      toast.error("真实邮件可在桌面客户端中导入 EML");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [{ name: "邮件", extensions: ["eml", "emlx", "msg"] }],
        title: "选择 EML / EMLX / MSG 文件",
      });
      const paths = picked ?? [];
      if (!paths.length) return;
      await pickImportAccount(paths, null);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function importMbox() {
    if (isDemo()) {
      toast.error("演示模式不支持导入");
      return;
    }
    if (!native) {
      toast.error("真实邮件可在桌面客户端中导入 mbox");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [{ name: "mbox", extensions: ["mbox"] }],
        title: "选择 mbox 文件",
      });
      if (!picked || typeof picked !== "string") return;
      await pickImportAccount(null, picked);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function importDirectory() {
    if (isDemo()) {
      toast.error("演示模式不支持导入");
      return;
    }
    if (!native) {
      toast.error("真实邮件可在桌面客户端中导入");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        title: "选择 Foxmail 导出的邮件文件夹",
      });
      if (!picked || typeof picked !== "string") return;
      await pickImportAccount(null, null, picked);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="archive-export-button"
        disabled={exporting}
        onClick={() => void exportAll()}
      >
        {exporting ? (
          <>
            <LoaderCircle className="animate-spin" size={15} />
            正在导出…
          </>
        ) : (
          "导出全部 EML"
        )}
      </Button>
      <Label
        className="archive-flat-option"
        htmlFor="archive-export-flat"
        title="不按账号和文件夹建立子目录，全部导出到所选目录"
      >
        <Checkbox
          id="archive-export-flat"
          checked={exportFlat}
          disabled={exporting}
          onCheckedChange={(value) => setExportFlat(value === true)}
        />
        平铺
      </Label>
      <Button
        variant="outline"
        disabled={importing}
        onClick={() => void importEmls()}
      >
        {importing && <LoaderCircle className="animate-spin" size={15} />}
        导入邮件
      </Button>
      <Button
        variant="outline"
        disabled={importing}
        onClick={() => void importMbox()}
      >
        导入 mbox
      </Button>
      <Button
        variant="outline"
        disabled={importing}
        onClick={() => void importDirectory()}
      >
        导入文件夹
      </Button>
      {recentJob &&
        importPaths === null &&
        mboxPath === null &&
        importTreePath === null && (
          <div className="archive-import-status">
            <div className="min-w-0">
              <p className="text-sm">
                {importActive(recentJob)
                  ? `导入中 · ${recentJob.folder}`
                  : `最近导入${importState(recentJob)} · ${recentJob.folder}`}
              </p>
              <p className="text-xs text-muted-foreground">
                新增 {recentJob.added}，补全 {recentJob.upgraded}，重复{" "}
                {recentJob.duplicate}，失败 {recentJob.failed}
              </p>
              {importActive(recentJob) && (
                <Progress
                  className="mt-2"
                  value={
                    recentJob.total
                      ? (recentJob.processed / recentJob.total) * 100
                      : 0
                  }
                  aria-label="最近导入进度"
                />
              )}
            </div>
            {importActive(recentJob) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void cancelImport()}
              >
                取消
              </Button>
            )}
          </div>
        )}
      <Dialog
        open={
          importPaths !== null || mboxPath !== null || importTreePath !== null
        }
        onOpenChange={(open) => {
          if (!open) {
            setImportPaths(null);
            setMboxPath(null);
            setImportTreePath(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {importTreePath
                ? "导入邮件文件夹"
                : mboxPath
                  ? "导入 mbox"
                  : "导入 EML / EMLX / MSG"}
            </DialogTitle>
            <DialogDescription>
              {importTreePath
                ? "递归读取文件夹中的 EML/EMLX/MSG/MBOX，并按相对路径保留子文件夹；单批最多 20000 封、合计 8 GiB。导入只写入本地存档，并按 Message-ID 跳过已存在邮件；同主题但不同邮件会保留。"
                : "导入只写入本地存档，不会上传或移动服务器邮件；已有文件夹仅作为本地归类。EMLX/MSG 会转换为 EML 后保存。单批最多 1000 封、合计 1 GiB；按内容 hash 和 Message-ID 跳过已存在邮件。导入会在后台继续，关闭窗口不会中断。"}
            </DialogDescription>
          </DialogHeader>
          {tier && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <p>
                本次保存到：
                <strong>
                  {tier.importLocation === "external" ? "外置存档" : "内置存档"}
                </strong>
              </p>
              {tier.importLocation === "external" && (
                <p
                  className={
                    tier.externalReachable
                      ? "text-xs text-muted-foreground"
                      : "text-xs text-destructive"
                  }
                >
                  {tier.externalDir || "外置目录未设置"}
                  {tier.externalReachable
                    ? " · 可用"
                    : " · 当前不可用，导入会失败"}
                </p>
              )}
            </div>
          )}
          <SelectField
            value={importAccount}
            onValueChange={(value) => {
              setImportAccount(value);
              setImportFolder("");
              setImportGroupName("");
              setNewGroupMode("custom");
              setFolderOptions([]);
              void loadImportFolders(value);
            }}
            disabled={importing}
          >
            {importAccounts.map((account) => (
              <SelectOption key={account.id} value={account.id}>
                {account.email
                  ? `${account.name} · ${account.email}`
                  : account.name}
              </SelectOption>
            ))}
          </SelectField>
          {importTreePath && importAccount === "new-group" && (
            <div className="grid gap-2">
              <Label htmlFor="import-new-group-mode">新建方式</Label>
              <SelectField
                id="import-new-group-mode"
                value={newGroupMode}
                disabled={importing}
                onValueChange={(value) =>
                  setNewGroupMode(value === "auto" ? "auto" : "custom")
                }
              >
                <SelectOption value="custom">自定义名称组</SelectOption>
                <SelectOption value="auto">按目录新建组</SelectOption>
              </SelectField>
              {newGroupMode === "custom" && (
                <>
                  <Label htmlFor="import-group-name">新组名称</Label>
                  <Input
                    id="import-group-name"
                    value={importGroupName}
                    disabled={importing}
                    placeholder="例如：Foxmail2026"
                    onChange={(event) => setImportGroupName(event.target.value)}
                  />
                </>
              )}
            </div>
          )}
          {importTreePath && (
            <p className="text-xs text-muted-foreground">
              组会建在「本地存档」下，所选目录内的子文件夹作为组内文件夹保留。
            </p>
          )}
          {importTreePath && importAccount === "new-group" ? (
            newGroupMode === "auto" ? (
              <p className="text-xs text-muted-foreground">
                将按所选文件夹名新建归档组；组在「本地存档」下，子文件夹在组下。
              </p>
            ) : null
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="import-folder">
                {importTreePath ? "根文件夹前缀（可选）" : "导入到文件夹"}
              </Label>
              <SelectField
                value={
                  folderOptions.some((option) => option.value === importFolder)
                    ? importFolder
                    : "__custom"
                }
                disabled={importing}
                onValueChange={(value) =>
                  setImportFolder(value === "__custom" ? "" : value)
                }
              >
                {folderOptions.map((option) => (
                  <SelectOption key={option.value} value={option.value}>
                    {option.label}
                  </SelectOption>
                ))}
                <SelectOption value="__custom">自定义文件夹…</SelectOption>
              </SelectField>
              {!folderOptions.some(
                (option) => option.value === importFolder,
              ) && (
                <Input
                  id="import-folder"
                  value={importFolder}
                  disabled={importing}
                  placeholder={
                    importTreePath ? "例如：Foxmail2026" : "例如：归档/2026"
                  }
                  onChange={(event) => setImportFolder(event.target.value)}
                />
              )}
            </div>
          )}
          {job && job.total > 0 && (
            <div className="grid gap-2">
              <Progress
                value={(job.processed / job.total) * 100}
                aria-label="导入进度"
              />
              <p className="text-sm text-muted-foreground">
                {importState(job)} · 已处理 {job.processed} / {job.total} 封
                {job.failed > 0 ? ` · ${job.failed} 封失败` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                新增 {job.added}，补全 {job.upgraded}，重复 {job.duplicate}
              </p>
            </div>
          )}
          <DialogFooter>
            {importing ? (
              <Button
                variant="outline"
                size="sm"
                disabled={starting}
                onClick={() => void cancelImport()}
              >
                取消导入
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportPaths(null);
                  setMboxPath(null);
                  setImportTreePath(null);
                }}
              >
                取消
              </Button>
            )}
            <Button
              size="sm"
              disabled={
                importing ||
                !importAccount ||
                (!importTreePath && !importFolder.trim()) ||
                (importTreePath !== null &&
                  importAccount === "new-group" &&
                  newGroupMode === "custom" &&
                  !importGroupName.trim())
              }
              onClick={() => {
                if (importTreePath) {
                  void startImport([], importTreePath);
                  return;
                }
                const paths = importPaths ?? (mboxPath ? [mboxPath] : []);
                if (paths.length) void startImport(paths);
              }}
            >
              {(importing || starting) && (
                <LoaderCircle className="animate-spin" size={14} />
              )}
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={outcome !== null}
        onOpenChange={(open) => !open && setOutcome(null)}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{outcome?.title}</DialogTitle>
            <DialogDescription>{outcome?.summary}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-y-auto">
            {outcome?.errors.map((error, index) => (
              <p
                key={`${index}-${error}`}
                className="border-b border-border/60 px-1 py-2 text-sm text-muted-foreground last:border-0"
              >
                {error}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (outcome?.errors.length)
                  void navigator.clipboard.writeText(outcome.errors.join("\n"));
              }}
            >
              复制失败项
            </Button>
            <Button size="sm" onClick={() => setOutcome(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
