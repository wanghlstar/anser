# 会话交接（2026-10-20：0.20.1 本地检查点 —— 设置/规则与折叠头已完成）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接复制）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a。本地已提交到 0.20.1 本地检查点，
工作树应干净；origin/feat/port-upstream-a 仍停在 2d357d4，本地领先 13+ 笔且**未推送**。
发布 tag：v0.2.0（已推送，Alpha 预发布）；v0.20.1 是**本地检查点 tag，不发布、不推送**。
上游 upstream/main = 331e05c（上游 0.1.21）。

当前状态（一句话）：设置五分类导航、后台任务五卡、全部折叠头统一、规则条件扩展 + 首次匹配快照
均已完成并验收；下一步是同步上游剩余批次，建议从「解析迁移（旧存档 cc/优先级头回填）」开始。

先读 AGENTS.md、本文件、docs/IMPLEMENTATION.md 最后几节、docs/RULES_PORT_UPSTREAM.md 关键发现 50–61。
需要看效果时 `npm run desktop`；安装版 `/Applications/雁信.app` 为 0.20.1。
铁律：中文界面；业务 UI 只用 shadcn/ui；改 UI 跑 `npm run check:ui`；改动先验收再提交；
上游与本地无共同祖先，不能 cherry-pick，只能 `git show <sha>:<path>` / `git diff` 逐块搬；
CSS 改动要在 `dist/assets/index-*.css` 里 grep；本机 browser.screenshot 不可用，布局只量 getBoundingClientRect。
```

## 二、当前基线

- 分支 `feat/port-upstream-a`；HEAD 为「交接文档重写」提交（`git log -1` 可查），tag `v0.20.1` 指向同一提交。
- 已发布：`v0.2.0`（Alpha 预发布，GitHub `releases/latest` 仍指 0.1.9，已装用户不会自动升级）。
- 本地检查点：`v0.20.1`，**未推送、未发布**；版本号按用户原话使用 0.20.1（不是 0.2.1）。
- 安装版：`/Applications/雁信.app` = **0.20.1**，安装后 PID 51386（重启机器/应用后会变）。
- 上游：`upstream/main = 331e05c`（0.1.21）；上游 tag 在同名命名空间 `refs/upstream/tags/*`。看 tag 先认作者：`v0.1.19/20/21` 是上游，`v0.1.5–v0.1.9`、`v0.2.0`、`v0.20.1` 是我们的。
- 门禁基线：`npx tsc --noEmit`、`npm run format:check`、`npm run check:ui`、`npx vitest run` = **54 文件 / 442 例**、`npm run test:desktop` = **18**、`npm run build`；Rust `cargo test --manifest-path src-tauri/Cargo.toml` = **354 passed / 1 ignored**。
- 装机命令（本地签名；末尾 updater 私钥报错是预期的）：
  ```bash
  cd ~/Mytools/anser
  set -a && . ./.env.local && set +a
  APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" \
    npx tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app
  # pkill -f "/Applications/雁信.app/Contents/MacOS/yanxin" → rm -rf /Applications/雁信.app
  # cp -R src-tauri/target/release/bundle/macos/雁信.app /Applications/雁信.app → open
  ```

## 三、本轮已完成（已验收）

### 设置与界面

- 设置页改为五分类导航：邮箱账号 / 本地存档 / 应用偏好 / 后台任务 / 关于雁信；宽窗左侧、窄于 900px 顶部导航；切换分类保留未保存输入。
- 分类内部保留我们的组合：账号卡 + 签名 + 收件范围；完整保存卡 + 存档校验；通知与启动 + 间隔与外观；五张后台任务卡；更新与运行说明。
- 后台任务五张独立卡：最近活动（第一）/ 完整保存任务 / 服务器状态同步 / 目录来源检查 / 服务器文件夹操作；默认折叠、每卡刷新，刷新至少 600ms 可见。
- 统一折叠头：后台任务五卡、规则页账号分组、服务器规则执行记录、邮件签名、全部收件箱都用「标题+说明整块可点，箭头提示，右侧操作独立」。
- 规则页：内容区最大宽度 1800px、横向内边距 12px；账号分组卡头上下居中；「N 条」与刷新按钮左缘对齐；执行记录卡头 `compact` 收紧（58→44px）。
- 签名区左移、问候语预览压扁；全部收件箱勾选横向三列、收件箱必选且不可取消；账号配置「服务器与高级配置」每次打开默认折叠。

### 规则

- 条件扩展：开头/结尾、邮件大小 KB、邮件日期（Calendar + Popover）、已读/星标、抄送、收件人或抄送、优先级、已接收天数。
- 首次匹配快照：应用动作前捕获 `ObservedStatus`，整条规则链与后续规则都按原始已读/星标判断。
- `NeedsBody`：正文/大小未完整保存、cc/优先级头未知、附件元数据未知时返回等待；预览显示「等待完整邮件核对」并双计数。
- `Mail` 新增 `cc` / `priority` / `attachment_metadata_known` / `header_metadata_known`；新邮件解析时即填充。
- **未做**：旧存档 `PARSER_VERSION` 迁移与 cc/优先级头回填；`rule_runs` 顺序动作引擎；完整保存类规则动作。

### 许可证

- `LICENSE` / `NOTICE` / `docs/LICENSING.md` / `docs/licenses/shadcn-ui-MIT.txt` 已补齐并随 App 打包；`package.json` / `Cargo.toml` 许可字段与 README 段已更新。

## 四、同步上游剩下的工作（按建议顺序）

| 优先级 | 批次 | 内容与依赖 | 状态/风险 |
| ------ | ---- | ---------- | --------- |
| 1 | 解析迁移与头块回填 | `archive::PARSER_VERSION` 升到 5；对已有原件的旧邮件**只读头块**回填 `cc` / `priority`，设置 `header_metadata_known=true`；不重新解码正文/附件。没有原件的在线记录保留 `false`。 | 建议下一批；不做则旧邮件的抄送/优先级规则永远显示等待核对。参考上游 `3d48afc`。 |
| 2 | `rule_runs` 顺序动作引擎 | 一条规则最多 8 个顺序动作、`rule_runs` 表、崩溃后续跑、`RuleRun.observed`、`save` / `saveFolder` 动作；与本地 `rule_operations.rs` / `rule-executions.tsx` 合并。 | 用户此前明确“后置”；与批次 1 可独立。上游 `rule_runs.rs` 1299 行。 |
| 3 | 邮件工作流对齐 | 8 秒撤回 + 取消后恢复编辑 + 立即发送、`send_kind` 边界、调度领取后不可撤回；发件箱是否改按 `updated_at` 倒序仍**待用户决策**（现为按状态分组）。 | 部分已有（倒计时/取消/立即发送）；主要是行为对齐，不必整搬 `scheduling.rs`。 |
| 4 | 未读口径「全部邮件」 | 所有账号所有可阅读文件夹、排除废纸篓/隔离；已发送与草稿不计未读；父目录汇总；菜单栏/Dock 同口径。 | 产品语义变更，用户尚未选择；现为「统一收件箱 + 每账号可配置范围」。 |
| 5 | Dock 未读角标 | macOS `set_badge_count`，零未读清除。 | 最低优先；托盘已有未读数。 |
| 6 | 双语翻译（0.1.17/0.1.18） | `translation.rs`（1689 行）、设置卡片、钥匙串存 Key、SQLite 有界缓存、逐段译文、取消/重试、最近活动；依赖全局代理。 | 大功能；用户未决定是否做。 |
| 7 | 全局代理 + 邮件图片/样式 | `proxy.rs`、`network-proxy-settings.tsx`、`mail_images.rs`（310）、`mail_styles.rs`（231）；翻译依赖它。 | 原 C 类「暂不做」；若做翻译需一起评估。 |
| 8 | 更新说明 Markdown / 更新历史 | 当前更新说明是纯文本 `whitespace-pre-wrap`；上游 `update_history.rs`（472）、`release-history.ts`、`release-notes.ts`。 | 小-中；可单独一批。 |
| 9 | 原生邮件链接（0.1.16） | 外链走系统浏览器。 | 我们已有等价做法（`web_link` / 系统打开），先核对再决定是否补。 |
| 10 | workflow 许可校验 | `release.yml` 加 4 行 `test -s`，断言包内 `LICENSE` / `NOTICE` / `LICENSING.md` / `licenses/shadcn-ui-MIT.txt`。 | 小；防配置回归。 |
| 不跟 | Homebrew / preview / signing-check / 上游发布脚本 / Apple 证书 | 仓库与发布基建不同，**不要搬**。 | 见 `RULES_PORT_UPSTREAM.md` 第 55 条。 |

**旧清单缺口**：上游 0.1.15–0.1.18（全局代理、原生邮件链接、双语翻译、邮件图片/字体）此前从未进清单；本表已并入。逐版本差异跑 `npm run upstream:matrix` → `docs/UPSTREAM_VERSION_MATRIX.md`，判定是启发式，需人工归类。

**待用户决策**：解析迁移是否下一批；`rule_runs` / 保存动作是否要做；发件箱排序是否改；未读口径是否改「全部邮件」；双语翻译是否做（含代理）。

## 五、不要覆盖的本地功能

原生写信窗/阅读窗（`compose-window.tsx`、`mail-reader-window.tsx` + capabilities）、待发送/草稿面板、收件箱范围、邮件菜单、问候语/首行缩进、写信附件、移动菜单、删除账号弹窗、图片缩放、字体、`scroll-pane`、`button-group`、存档分层与「存档校验」、设置五分类与折叠头。同步上游时以本地为底逐块合并。

## 六、常用命令与数据

- 开发预览：`npm run desktop`（单实例；安装版在跑时先退出安装版）。
- 门禁：`npx tsc --noEmit`、`npm run format:check`、`npm run check:ui`、`npx vitest run`、`npm run test:desktop`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 版本校验：`npm run release:check`（要求 `docs/releases/v<version>.md` 非空）。
- 数据/钥匙串标识 `dev.maildesk.desktop` 不得改；DB `~/Library/Application Support/dev.maildesk.desktop/mail.sqlite3`（只读用 `sqlite3 -readonly "file:$DB?immutable=1"`）。
- 真实收发范围见 `AGENTS.md`：仅腾讯企业邮箱 ↔ QQ 邮箱互发，主题「雁信联调」。
- 文档索引：`docs/IMPLEMENTATION.md`（进度）、`docs/RULES_PORT_UPSTREAM.md`（关键发现 1–61）、`docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`（逐项评估）、`docs/UPSTREAM_VERSION_MATRIX.md`（全量比较）、`docs/UPDATES.md`（发布/更新器）。
