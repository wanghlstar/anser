# 同步上游：附件体系 + 富文本 —— 工作点（2026-10-17）

> ## 新会话引导语（可直接复制到开场白）
>
> 继续「雁信（Anser）」开发。仓库 `/Users/wanghlstar/Mytools/anser`（活跃；旧仓库 `wanghlstar/yanxin` 已废弃）。先读 `AGENTS.md` 和本文件。
>
> **当前基线**：分支 `feat/port-upstream-a`，HEAD `8f8e94b`；`origin/main` = `15f73bd`（tag `v0.1.8`，已推送）；工作区干净。可回滚点：`checkpoint-2026-10-17-port-upstream-a` → `222ab9e`（本地未推送）。
>
> **本分支已完成（上游 A 类移植，均已提交）**：阅读快捷键、单封打印、清空草稿/废纸篓、精简版转发带原附件、正文图片超时重试、通知点击定位，以及一轮用户反馈修复（自寄邮件菜单/通知、重新编辑原样载入、问候语顶格、写信拖拽/粘贴附件、阅读器图片复制保存、废纸篓按当前文件夹独立、待确认删除按视图作用域清理）。
>
> **本轮任务（用户已定）**：同步上游 v0.1.19 的**附件体系 + 富文本编辑器**，并**保留我们的问候语 / 签名 / 字体字号 / 首行缩进**。
>
> **从「第一天计划 → 第①步 后端 compose_files」开始。** 按 AGENTS.md 准则推进（先思考、简洁、精准修改、目标驱动）。

## 用户决策

「同步上游附件 + 富文本（但要保留我们问候 + 签名的样式）」。用户原以为附件已做，实际上一轮只做了「转发带原附件的精简版」（`extract_attachments`），完整附件体系当时被评估后跳过；本轮补齐。

## 关键发现（务必先理解，避免白做）

1. **上游「富文本」与「附件」是同一套系统，不能拆。** 上游编辑器插入正文图片走 `read_body_images`（把图片存成草稿自有的 compose 文件、发送时作为附件带上），依赖 `compose_files.rs`。所以「同步附件 + 富文本」等于整块移植。
2. **上游没有我们的邮件特有功能**：问候语（`GreetingParagraph`）、首行缩进（`BodyIndent` + 真实全角空格）、字体字号默认（仿宋/14pt）、签名与问候拼装（`signatures` 的 `greeting` 字段）。这些必须原样保留并重新接到上游的编辑器/写信窗口上。
3. **上游 Compose 与我们的仅差两个字段**：`forward_source: Option<ForwardSource>`、`forward_files: Vec<ForwardFile>`。模型合并很简单。
4. **阅读器图片原生菜单 JS 关不掉**（WKWebView 行为；上游 0.1.19 的阅读器传 `inspectable=true` 故意保留原生菜单，也不做自定义图片菜单）。因此「自研中文图片菜单 / 左键选中」不在本轮范围，要做需原生 `WKUIDelegate` 覆盖，属独立高风险项。
5. 我们这边后端已有可直接复用的能力：`Store::message_raw`、`eml_files::account()`、`Store::save_draft`（上游叫 `save_draft_record`）。

## 移植清单（上游基线 `v0.1.19`）

**后端**

- `src-tauri/src/compose_files.rs`（新增，1166 行）：草稿自有附件副本 + 会话 token + 正文图片。
- `src-tauri/src/models.rs`：`Compose` 加 `forward_source` / `forward_files`；新增 `ForwardSource{id,hash}`、`ForwardFile{id,name,mime,size,included}`（均 `#[serde(rename_all="camelCase")]`）。
- `src-tauri/src/lib.rs`：`mod compose_files;` + 命令 `clear_drafts`、`open_compose_session`、`close_compose_session`、`prepare_forward_files`、`read_body_images`（注册进 `invoke_handler`）。
- `src-tauri/src/store.rs`：DB 初始化序列里加 `crate::compose_files::initialize(&db)?;`。
- `src-tauri/src/network.rs`：发送时若 `forward_source.is_some() || forward_files.any(included)` → 取 `store.forward_payloads(c)` 带附件；普通附件仍走 `c.attachments` 路径。

**前端**

- 新增：`src/lib/rich-extensions.ts`(76)、`src/lib/rich-image-size.ts`(51)、`src/lib/rich-body.ts`(103)、`src/components/rich-toolbar.tsx`(556)、`src/components/rich-search.tsx`、`src/components/rich-image-controls.tsx`(317)。
- 替换/改造：`src/components/rich-editor.tsx`(上游 355 / 我们 457)、`src/components/compose-dialog.tsx`(上游 1164 / 我们 907)；`src/lib/compose-attachments.ts`(上游 25 / 我们 51)。
- 依赖新增（`^3.31.3`）：`@tiptap/extension-highlight`、`-subscript`、`-superscript`、`-text-align`、`-list`（TaskList/TaskItem）、`-find-and-replace`。

**必须保留的我们的功能**：`GreetingParagraph`/`BodyIndent`、`src/lib/fonts.ts`、`src-tauri/src/signatures.rs`（含 `greeting`/`greeting_html`）、`prepareCompose` 与写信/发送/重新编辑链路、`textToHtml`/净化、草稿字段兼容。

## 计划（每步都要过门禁）

```text
① 后端：compose_files.rs + models + lib.rs 命令 + store 初始化 + Rust 测试
   → 验证：cargo test 全绿；命令可编译注册
② 前端：compose 子系统（rich-extensions/rich-toolbar/rich-search/rich-image-controls/
   rich-body/rich-editor/compose-dialog）替换，并重挂我们的问候/签名/字体/缩进
   → 验证：vitest 全绿；真实写信手动核对问候语顶格、签名、字体字号、首行缩进
③ 接线：转发走 forward_source（废弃精简版 extract_attachments）、正文图片、发送带附件
   → 验证：QQ↔腾讯企业邮箱实发实收（含转发带原附件、正文图片）
④ 实收发验证 + 全量门禁 + 装机
```

## 参考接口（上游 `v0.1.19`）

- `compose_files.rs`：`initialize(db)` / `Store::open_compose_session(owner)->token` / `close_compose_session(owner,token)` / `prepare_forward_files(id,token,source)` / `read_body_images(owner,token)` / `delete_compose_draft(id)` / `clear_compose_drafts(&[Compose])->ClearDraftsResult`。
- 表：`compose_sessions(draft_id PK, token)`、`compose_files(id PK, draft_id, name, mime, size, hash, created_at)`。
- 附件上限 `MAX_BYTES = 50MB`；正文图片格式仅 PNG/JPEG/GIF/WebP（`raster_mime`）。
- 发送：`if c.forward_source.is_some() || c.forward_files.iter().any(|f| f.included) { let files = store.forward_payloads(c)?; ... }`；普通附件仍按 `c.attachments`（文件路径）读取。

## 环境与命令

- 门禁：`cargo test --manifest-path src-tauri/Cargo.toml`、`npx vitest run`、`npx tsc --noEmit`、`npx prettier --check "src/**/*.{ts,tsx,css}"`、`npm run check:ui`、`npm run test:desktop`、`npm run build`。
- 装配装机（本机固定签名 + OAuth 环境；`tauri build` 末尾会因缺 updater 私钥报错，但 `.app` 正常产出）：
  ```bash
  cd ~/Mytools/anser
  set -a && . ./.env.local && set +a
  APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" \
    npx tauri build --config '{"plugins":{"updater":{"createUpdaterArtifacts":false}}}' --bundles app
  # pkill -f "雁信.app/Contents/MacOS/yanxin" → rm -rf /Applications/雁信.app → cp -R 产物 → open → 报 PID
  ```
- 数据/钥匙串标识 `dev.maildesk.desktop` 不得改。DB：`~/Library/Application Support/dev.maildesk.desktop/mail.sqlite3`（只读用 `sqlite3 -readonly "file:$DB?immutable=1"`；直接改库先 `PRAGMA trusted_schema=ON;`）。
- 真实收发测试范围见 `AGENTS.md`（仅腾讯企业邮箱 ↔ QQ 邮箱互发，主题带「雁信联调」）。

## 注意事项

- `origin` = `git@github.com:wanghlstar/anser.git`；`upstream` = `https://github.com/ansermail/anser.git`。**不要直接 merge `upstream/main`**，按文件/提交移植并逐个消化冲突（本地有 Dock 开关、存档分层、全部收件箱范围、问候语三段式、首行缩进真实空格等自有功能）。
- `compose-dialog.tsx` 是大头：上游 1164 行、与我们差异约 1000 行 diff。搬的时候逐块替换，注意重挂：问候语插入（空文档才插、顶格）、签名开关与渲染、字体/字号下拉默认值、`toolbarExtras`、附件区。
- `rich-editor` 上游依赖 `rich-toolbar` / `rich-search` / `rich-image-controls` / `rich-body`，需一并搬；上游图片节点是 `inline:true + allowBase64 + width/height`（`MailImage`），与我们当前 `inline:false` 不同，切换后要核对旧草稿显示。
- 移植完成前，`network.rs` 的发送路径不要半途改动，避免发出不完整附件。

## 分支提交清单（`feat/port-upstream-a`，时间序）

```
295d063 feat: 阅读快捷键与右键菜单快捷键提示（移植上游 0.1.11）
6cff688 feat: 单封邮件打印（移植上游 0.1.13）
078a042 feat: 清空草稿箱与清空本地废纸篓
51e4d8a feat: 转发自动带原邮件附件（精简移植上游 0.1.11）
52d5596 feat: 正文图片加载超时提示与重试（移植上游 0.1.14+0.1.19）
20e53c8 feat: 通知点击定位具体邮件（移植上游 0.1.14）
f883e9e fix: 自寄邮件菜单/通知、废纸篓隐藏、重新编辑原状、问候语顶格
23f3bea fix: 收件箱自寄邮件不再显示重新编辑、通知定位不再重复
8785852 feat: 打印面板中文化、通知横幅、写信拖拽/粘贴附件、阅读器图片复制保存
222ab9e fix: 废纸篓/彻底删除按当前文件夹独立，不再牵连同 Message-ID 的其他副本
8f8e94b fix: 待确认删除的邮件标记按视图作用域清理，废纸篓不再闪回
```

门禁基线（`8f8e94b`）：Rust 325 passed / 1 ignored、Vitest 385 passed (50 files)、tsc、prettier、check:ui、test:desktop 18、build 全绿。装机 PID `66677`（2026-10-17 夜）。

## 遗留 / 待办（非本轮）

- 通知横幅优先级与可靠性不佳（用户「回头再说」）。
- 阅读器图片自定义菜单 / 左键选中（需原生 `WKUIDelegate`，独立高风险项）。
- 服务器删除被永久阻塞时，待删邮件会一直隐藏；考虑加「阻塞时重新露出」兜底。
- B 类：更新说明 Markdown 渲染、富文本增量（本轮已并入富文本移植）。
- C 类：全局网络代理（暂不做）。
