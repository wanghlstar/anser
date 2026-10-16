# 规则「移动到文件夹」合并 —— 工作点（2026-10-16）

> ## 新会话引导语（可直接复制到开场白）
>
> 继续「雁信（Anser）」开发。仓库 `/Users/wanghlstar/Mytools/anser`（活跃；旧仓库 `wanghlstar/yanxin` 已废弃）。先读 `AGENTS.md` 和本文件（本文末尾有「邮件列表右键菜单重构建议」）。
>
> **当前基线**：`main`，tag **`v0.1.8`**（0.1.7 之前为 `47c67c8`）。可回滚点：`baseline-2026-10-16`（92c14f3）、`checkpoint-ui-2026-10-16`（4bcbc7a）。
>
> **已完成（0.1.7）**：规则动作合并为单一「移动到文件夹」（IMAP→真正 `serverMove`，来源=该账号收件箱范围 `inboxFolders`/`INBOX`；POP3/无服务器目录→本地；可与已读/未读/星标叠加，本机即时、移动异步；废纸篓与移动互斥）；撤销上一轮错误的「本地目标列服务器文件夹」；规则卡片条件单行省略/目标中文名/按账号树排序；本地存档账号组草稿箱入口；邮件列表勾选圈（圆形加深）+ 悬停星标/未读快捷动作；设置页重构（顶部「系统通知/后台检查」等高，下方「外观+活动与诊断」｜「存档校验」，「活动与诊断」平铺并底对齐）；托盘未读 1s 轮询 + 免打扰↔通知开关双向同步；清理 `toggleAction`。
>
> **已完成（0.1.8）**：邮件列表右键菜单迁到 shadcn `ContextMenu`（边界翻转/键盘/Esc/焦点/Portal 层级），按列表上下文分组显示，状态项改复选框 toggle，补回复/回复全部/转发/重新编辑；「移动到文件夹」统一到右键菜单、批量工具栏、阅读器三处并**跟随账号**（IMAP→服务器文件夹；POP3/无服务器目录→本机归档目录；顺序同账号树 `compareFolders`）；服务器可行→真移（确认+本机自动跟），服务器已删/非 IMAP→新增后端 `move_local_archive` 仅重定本机归档 A→B；批量工具栏按上下文收窄；删除旧的「归入本地文件夹」平铺对话框。
>
> **待办**：
> - 下个版本：**整体同步上游** —— 0.1.11 原附件转发 + 五项邮件快捷键；0.1.12 完整富文本写信（Tiptap）+ 更新说明 Markdown 渲染。**邮件快捷键移植后再补 `ContextMenuShortcut` 快捷键提示**。cherry-pick 单提交，勿 merge `upstream/main`（基线 `da3b667`）。
> - 长期/可选：「本地优先/乐观」移动（本机视图即时 + 后台同步 + 失败回滚）—— **暂停**。
> - 待用户人工复核：规则页 5 条已迁移为 `serverMove` 的规则仍为停用，需逐条预览匹配数后决定是否启用（启用即真移服务器，不可逆）。
> - 待真实账号验收：本机归档 A→B 重定（`move_local_archive`）目前仅单测覆盖，需在真实账号对「服务器已删、仅本机存档」邮件实测一次。
>
> **环境与命令**：门禁 `cargo test --manifest-path src-tauri/Cargo.toml`、`npx vitest run`、`npx tsc --noEmit`、`npx prettier --check "src/**/*.{ts,tsx,css}"`、`npm run check:ui`、`npm run test:desktop`、`npm run build`。构建装机直接做、不要问：
> ```bash
> cd ~/Mytools/anser
> set -a && . ./.env.local && set +a
> APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" \
>   npx tauri build --config '{"plugins":{"updater":{"createUpdaterArtifacts":false}}}' --bundles app
> # pkill 旧进程 → rm -rf /Applications/雁信.app → cp -R 产物 → open，报 PID
> ```
>
> **约定/注意**：基础组件一律 shadcn（`npm run check:ui`）；桌面 UI 不截图排查，用代码/CSS 推导 + 用户反馈；存储与钥匙串标识 `dev.maildesk.desktop` 不得改，DB 在 `~/Library/Application Support/dev.maildesk.desktop/mail.sqlite3`，直接改库先 `PRAGMA trusted_schema=ON;`；改版本需同步 `package.json`/`src-tauri/Cargo.toml`/`src-tauri/tauri.conf.json`（+ `package-lock.json`/`Cargo.lock`）并更新 `docs/releases/vX.Y.Z.md`，tag `vX.Y.Z` 会触发 `release.yml` 出 DMG。规则迁移前整库备份在 `/Users/wanghlstar/Mytools/mail-before-rule-merge-2026-10-16.sqlite3`。
>
> 默认从「邮件列表右键菜单重构」开始，并按 AGENTS.md 的准则（先思考、简洁、精准修改、目标驱动）推进。

## 目标（用户最终要求）

用户级**只保留一个移动动作：`移动到文件夹`**，语义对齐 Foxmail 的「移动到 <文件夹>」。

- 配置跟随规则已选的**账号**；目标文件夹列**该账号的文件夹**。
- **IMAP 账号** → 真正发 IMAP MOVE（走现有 `directory_operations` 队列，含确认/重试/清理状态机），所有设备可见。
- **POP3 / 无服务器目录的账号** → 退化为纯本地归类（写 `localFolder` 标签）。
- **完全去掉**「归入本地文件夹」这个独立动作（不再作为可选动作）。

用户原话：「我想要的最终结果等同移动服务器邮件」「我希望对于用户层面是合并的一个动作」。

## 现状（本会话已做、**尚未提交**）

工作区有 14 个文件改动（含 1 个新测试文件），HEAD = `75cd636`（0.1.6），与 origin/main 同步。

### 已完成并通过门禁

1. **本地动作多选叠加**：`Rule.action` 用 `+ , ， ; ；` 分隔写多个动作；`effective_actions()` / `effective_actions_deduped()`（`models.rs`）。read/unread 互斥、去重。`store.rs` 的 `apply_configured_rules` 改循环，累积后只写库一次、只记一条日志。
2. **服务器动作禁止与本地动作叠加**：`rules.rs::validate` 逐动作校验。
3. **前端动作区改多选**（shadcn Checkbox）：`toggleAction()`（`rule-match.ts`）处理勾选，**勾本地自动解除服务器动作，反之亦然**。
4. **规则按账号分组折叠**：`groupRulesByAccount()`；每组保留**全局顺序号**（规则有序执行，折叠不能丢优先级语义）；账号组卡片框沿用设置页账号卡样式。
5. **规则导出**：`export_rules(account_ids, include_global)` + Tauri 命令 + `write_text_file`；UI 弹账号多选 +「包含全部账号的通用规则」。
6. **规则对话框滚动**：`.conditions` 内部限高滚动；弹窗 `sm:max-h-[85vh] overflow-y-auto` 兜底；`.dialog-actions` **去掉了 `position: sticky`**（在无滚动容器里会飘到中间重叠）。
7. **本地文件夹可删除**：`store.clear_local_folder(name)` + `clear_local_folder` 命令；侧栏本地文件夹悬停显示删除按钮（`.local-folder-row`），确认后邮件移回「全部存档」。
8. **归类对话框重做**（`App.tsx` 的 moveIds 对话框）：列出已有本地文件夹做快捷选择 + 普通 Input + **「移出归类」**（退回「全部存档」）+ 取消/确认。

门禁基线：Rust **314 passed** / Vitest **339 passed (45 files)** / tsc / prettier / check:ui / test:desktop 18 / build。

### ⚠️ 需要修正的地方（本会话遗留）—— **已修正（2026-10-16 会话）**

**上一轮把「归入本地文件夹」的目标下拉改成了列"服务器文件夹"——这是错的**，导致用户跑规则后侧栏凭空多出 4 个平铺本地文件夹（`深港日检`/`出账报表`/`日常稽核`/`上线申请`）。已用 SQL 把这 1623 封移回「全部存档」，但**规则仍启用，新邮件又被归进去 1 封**。新会话做合并动作时，这条错误改动要一起撤掉。

相关代码：`rule-match.ts::ruleFolderOptions()` 是上一轮新增的（列服务器文件夹），合并方案下应删除或改用途；`rules-panel.tsx` 的 folder 目标字段用了 `FolderInput` + `ruleFolderOptions`。

**处理结果：**
- 代码：已删除 `ruleFolderOptions`；本地移动的目标建议改回 `data.folders`（本地文件夹），不再列服务器文件夹。
- 数据：库中 5 条把**服务器文件夹展示名**写成目标的历史 `folder` 规则（`紧急告警`/`日检巡检`/`上线申请`/`出账结果`/`日常稽核`）已迁移为 `serverMove`、目标改成服务器**原始目录名**、`sourceFolder` 留空、**全部停用**待用户复核。迁移前库已备份到 `$TMPDIR/opencode/mail-before-rule-merge.sqlite3`。`垃圾邮件`(read+trash) 未动。服务器侧本就有 907 条已完成的 move 记录。

## 合并动作要做的事 —— **已完成（2026-10-16 会话）**

实现说明：
- 用户层只有一个勾选动作 `move`「移动到文件夹」，`read`/`unread`/`star`/`trash` 为可叠加的本地动作。
- 目标随账号：`move` 落地值由账号能力决定 —— 已启用 IMAP 账号 → `serverMove`（真正服务器移动，目标列该账号服务器目录、无来源字段）；POP3/Gmail/无服务器目录 → `folder`（纯本地归类，目标列本地文件夹自由文本）。
- `move` 独占：勾选它清掉其它动作，勾选其它动作也解除它（`rule-match.ts::toggleMergedAction`）。
- 后端 `serverMove.source_folder` 允许为空：为空时按邮件当前活跃的服务器来源目录（收件箱优先）动态解析（`rule_operations.rs::resolve_source`）。
- 存量 `folder` / `serverMove` / `serverCopy` 仍可执行、仍能正确展示。
- 门禁：Rust 317 / Vitest 339 / tsc / prettier / check:ui / test:desktop 18 / build 全绿。

### 同日后续调整

- **来源固定为账号收件箱范围**：收信规则只作用于账号的收件箱（唯一入口）。`serverMove.source_folder` 留空时解析为 `account.inboxFolders`（未配置则 `INBOX`），不再取"任意活跃目录"；邮件已在该范围内的活跃来源才命中，已在目标目录的跳过（避免 X→X 无效任务与重复计数）。修复了「日检巡检」预览把 960 封已归位邮件算成 972 的假象。
- **规则卡片**：条件区改为单行、超出省略号截断（高度统一）；移动动作的目标显示服务器目录中文名（不再显示 `&Tgp+v3Uzi,c-` 这类原始名）。
- **目标下拉**：按账号树同一套顺序（`compareFolders`：角色 + 中文拼音）。
- **本地存档账号组**：新增「草稿箱」入口，点开与账号内草稿视图一致（草稿只存本机）。
- **移动可搭配本机标记**：`serverMove/serverCopy` 现可与 `read/unread/star` 叠加（后端 `validate` 放宽；`apply_configured_rules` 对服务器规则也应用本机标记）；读/星标立即生效，移动仍异步。与 `trash`、另一个服务器动作仍互斥。
- **邮件列表行**：左侧勾选圈颜色加深约 10%；悬停新增「星标」「标记未读/已读」两个快捷动作（Foxmail 式）。
- 门禁：Rust 319 / Vitest 340 / tsc / prettier / check:ui / test:desktop 18 / build 全绿；装机 PID 34803。

### 前端（`rules-panel.tsx`、`rule-match.ts`）

- 动作列表 `ALL_ACTIONS` 去掉 `folder` 和独立的服务器动作，改为：
  - `move`（显示名「移动到文件夹」）
  - `read` / `unread` / `star` / `trash`
- `move` 的配置区：目标文件夹下拉列**该账号的文件夹**（账号 = `editing.accountId`）。
  - IMAP 账号 → 列服务器目录（复用一个类似 `RuleServerFolders` 的下拉，但只需**目标**，来源留空）。
  - POP3 / 无法加载服务器目录 → 退化为本地文件夹自由文本（保留现在的 `FolderInput`）。
- `toggleAction()` 里 `SERVER_ACTIONS` 的处理要跟着改（`move` 是独占动作，不能与其他叠加）。
- 存量规则兼容：旧的 `folder` / `serverMove` / `serverCopy` 值必须仍能执行、仍能正确展示。

### 后端（`models.rs`、`rules.rs`、`rule_operations.rs`、`store.rs`）

- 让 `serverMove` 的 **`source_folder` 允许为空**：为空时动态取邮件的活跃来源行（`trusted_sources` 里 `active=1` 的行）作为来源目录。这是和 Foxmail 的主要差距——现在必须写死来源目录，等于只处理某个目录。
  - 注意：邮件可能有多个活跃来源行，需定义取哪个（建议：全取或取第一个，并写测试）。
- `rules.rs::validate`：IMAP 移动要求账号有效 + 目标非空；来源可空。POP3 → 走本地 `localFolder`（复用现有 `folder` 分支）。
- 不要直接改 `localFolder` 来实现 IMAP 移动——那正是这次踩的坑（本地标签 ≠ 服务器移动）。

### 风险

- 规则批量执行 IMAP MOVE 不可逆、可能移动上千封。现有队列有「结果未确认不重发」，但建议**执行前预览匹配数量并二次确认**（复用现有「预览匹配，不执行动作」）。
- `directory_operations` 队列与规则的交互（`apply_remote_rule`）已存在，改动前先读 `rule_operations.rs:45` 起的实现。

## 环境与命令

- 仓库：`/Users/wanghlstar/Mytools/anser`
- `origin` = `git@github.com:wanghlstar/anser.git`（活跃）；`upstream` = `https://github.com/ansermail/anser.git`（按需 cherry-pick，勿直接 merge）
- 版本 0.1.6；tag `v0.1.5` → `432f441`，`v0.1.6` → `75cd636`
- 构建装机（本机固定签名 + OAuth 环境）：
  ```bash
  cd ~/Mytools/anser
  set -a && . ./.env.local && set +a
  APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" \
    npx tauri build --config '{"plugins":{"updater":{"createUpdaterArtifacts":false}}}' --bundles app
  # 然后 pkill 旧进程 → rm -rf /Applications/雁信.app → cp -R 产物 → open 验证 PID
  ```
  `npm run desktop:build` 现在可用（私钥已复制到 `~/.config/yanxin-release/updater.key`）。
- 门禁：`cargo test --manifest-path src-tauri/Cargo.toml`、`npx vitest run`、`npx tsc --noEmit`、`npx prettier --check "src/**/*.{ts,tsx,css}"`、`npm run check:ui`、`npm run test:desktop`、`npm run build`。
- 数据/钥匙串标识 `dev.maildesk.desktop` 不得改。数据库 `~/Library/Application Support/dev.maildesk.desktop/mail.sqlite3`。
  直接改库需先 `PRAGMA trusted_schema=ON;`（FTS 触发器会被 CLI 安全策略拦）。

## 用户偏好

- 改完**直接构建装机**并告知 PID，不要问「要不要装机」。只有涉及删数据/改远程/强推等破坏性操作才先确认。
- 桌面 UI 不要截图排查，用代码/CSS 推导 + 用户反馈。
- 严格遵守 AGENTS.md 的 shadcn 铁律。

## 相关文件

- `src/components/rules-panel.tsx`：规则页 UI（动作多选、分组、导出、编辑对话框）
- `src/lib/rule-match.ts`：`ruleActions` / `ruleActionsDeduped` / `toggleAction` / `isRemoteRule` / `groupRulesByAccount` / `ruleFolderOptions`
- `src-tauri/src/models.rs`：`Rule` + `effective_actions*`
- `src-tauri/src/rules.rs`：`validate` / `remote`
- `src-tauri/src/store.rs`：`apply_configured_rules`（执行）、`export_rules`、`clear_local_folder`
- `src-tauri/src/rule_operations.rs`：`apply_remote_rule`（服务器动作落地）
- `src/components/rule-server-folders.tsx`：服务器来源/目标下拉（合并动作可复用目标部分）
- `src-tauri/src/tests.rs` / `src/lib/rule-match.test.ts` / `src/components/rules-panel.test.tsx` / `src/components/rules-dialog-layout.test.ts`

## 下一步 —— 已完成

1. ~~先撤掉「目标列表服务器文件夹」的错误改动（`ruleFolderOptions` 相关）。~~ ✅
2. ~~实现合并动作「移动到文件夹」（前端单选 + 账号文件夹列表；后端 `source_folder` 可空动态解析）。~~ ✅
3. ~~补测试（IMAP 服务器移动、POP3 退化本地、来源留空按活跃来源移动、存量 folder/serverMove 仍可用）。~~ ✅
4. ~~全量门禁 → 装机。~~ ✅ 装机 PID 22793（2026-10-16）。

**待用户人工复核：** 规则页 5 条已迁移为 `serverMove` 的规则现为停用状态，请逐条预览匹配数后决定是否启用；启用后执行会真正移动服务器邮件（不可逆）。

---

# 附：邮件列表右键菜单重构建议（独立任务，用户已认可方向）

## 现状

邮件列表的右键菜单是**自绘浮层**：`App.tsx` 里 `rowMenu` 状态 + `<div className="row-context-menu">` 包若干 shadcn `Button`，定位用 `style={{ left: rowMenu.x, top: rowMenu.y }}`（鼠标坐标）。CSS 见 `src/index.css` 的 `.row-context-menu`。当前 6 项：标记为已读 / 标记为未读 / 完整保存到本地 / 归入本地文件夹 / 移到本地废纸篓（或恢复）/ 彻底删除（含服务器）。

## 问题

1. **违反 AGENTS.md 的 shadcn 铁律**：“禁止自行实现一套 UI 组件”。项目里已有 `src/components/ui/context-menu.tsx`（Radix shadcn ContextMenu）却没使用。
2. **无边界翻转**：直接用鼠标坐标，靠近屏幕右/下边缘会被裁切，不会自动翻转或补偿。
3. **无键盘可达性**：自绘 div 没有 `role="menu"`、方向键导航、Esc 关闭、焦点管理、`aria-*`。
4. **层级不统一**：手写 `z-index: 60`，而 shadcn Popover/Select 是 `z-50`；铁律要求基础弹层统一层级、由 Portal 顺序处理嵌套。
5. **信息密度低**：6 项平铺，无分组、无图标、无快捷提示；破坏性项（彻底删除）只靠红色区分。
6. **状态项重复**：已读/未读、移到废纸篓/恢复 都是两项并列，靠用户判断点哪个；应改为按当前状态只显示适用的一项，或统一为单一 toggle 项。
7. **动作不全**：缺星标、回复、转发；「归入本地文件夹」应能做成子菜单直接列文件夹，一点即归类，而不是再弹对话框。

## 建议

- **迁移到 shadcn `ContextMenu`**（组件已存在），自动获得：边界翻转、键盘导航、Esc 关闭、焦点陷阱、层级与 Portal 统一。
- 用 `ContextMenuSeparator` 分两组：**常用**（回复 / 转发 / 星标 / 标记已读或未读 / 移动或归类 / 完整保存）与 **危险**（移到废纸篓或恢复 / 彻底删除）。
- 「移动到文件夹」用 `ContextMenuSub` 列出已有目标（与上面的合并动作呼应），`ContextMenuCheckboxItem` 表示已读/星标状态。
- 补齐星标、回复、转发等高频动作。
- 触发方式从 `onContextMenu` 手写事件改为 `ContextMenuTrigger` 包裹邮件行；多选时的作用范围沿用现有 `rowMenu.ids` / `rowMenu.threads` 逻辑。
- 快捷键提示用 `ContextMenuShortcut`（与“邮件快捷键移植”任务可能存在的冲突需先核对）。

## 关联

- 与「合并动作：移动到文件夹」耦合——子菜单列的目标文件夹应与规则里的目标一致（账号内文件夹）。
- `src/lib/mail-shortcuts.ts` 若已存在（上游 0.1.11 移植相关），重构右键菜单时核对动作定义是否可共用。

