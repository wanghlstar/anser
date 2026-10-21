# 会话交接（2026-10-21：0.2.2 正式发布 / 同步上游 0.1.24）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接复制）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，基线分支 main。后续从 main 拉短分支开发，推送并发 PR。
已发布 v0.2.2（Alpha）：release.yml 正常 Release，双架构资产与 latest.json 齐全，releases/latest 指向它。
本地检查点：v0.20.1 / v0.20.2 / v0.20.3 / 0.2.2.0 / 0.2.2.1，均不推送、不发布。
上游 upstream/main = 490a432（上游 0.1.24）。

当前状态：0.2.2 已包含 0.1.24 的实时单连接、Gmail 钥匙串待写容错、
整行自适应的收件人行、Tiptap 表格与字体颜色，以及发布许可校验。

先读 AGENTS.md、本文件、docs/IMPLEMENTATION.md 最后几节、docs/RULES_PORT_UPSTREAM.md 关键发现 50–68。
需要看效果时 `npm run desktop`；安装版 `/Applications/雁信.app` 已是 **0.2.2**；`0.2.2.1` 是本地检查点 tag。
铁律：中文界面；业务 UI 只用 shadcn/ui；改 UI 跑 `npm run check:ui`；改动先验收再提交；
上游与本地无共同祖先，不能 cherry-pick，只能 `git show <sha>:<path>` / `git diff` 逐块搬；
CSS 改动要在 `dist/assets/index-*.css` 里 grep；本机 browser.screenshot 不可用，布局只量 getBoundingClientRect。
```

## 二、当前基线

- 基线 `main` = `v0.2.2` 发布提交；官方 tag `v0.2.2` 已推送。本地检查点 `0.2.2.1` = `7fd5382`、`0.2.2.0` = `fe1878a`，均未推送。上一发布 tag `v0.2.1` = `ab97b9f`；后续从 `main` 拉 `feat/...` / `fix/...` 短分支，推送并发 PR，验收后合并。
- 已发布：`v0.2.2` 为正常 Release（标题 Alpha，不设 prerelease），`releases/latest` 指向它，支持应用内更新；双架构 DMG、app.tar.gz、sig、latest.json 已上传。
- 历史发布：`v0.2.1`、`v0.2.0` 为 0.2 主线 Alpha；`v0.1.9` 及更早为上一稳定线。
- 本地检查点：`v0.20.1`、`v0.20.2`、`v0.20.3`、`0.2.2.0`、`0.2.2.1`，**未推送、未发布**；版本号按用户当时原话使用 0.20.x / 0.2.2.x，不是公开的 0.2.x 线。
- 正式发布：`v0.2.2`（2026-10-21），双架构与 latest.json 由 `release.yml` 发布。
- 安装版：`/Applications/雁信.app` 已是 **0.2.2**（本地签名校验通过）。
- 上游：`upstream/main = 490a432`（0.1.24）；上游 tag 在同名命名空间 `refs/upstream/tags/*`。看 tag 先认作者：`v0.1.19–v0.1.24` 是上游，`v0.1.5–v0.1.9`、`v0.2.0`、`v0.2.1`、`v0.2.2`、`0.2.2.0`、`0.2.2.1`、`v0.20.1/v0.20.2/v0.20.3` 是我们的。
- 更新中心：当前 0.2.2 已是 latest，显示「没有可用更新」是正常结果；首次检查遇到过 GitHub 代理瞬断，重试即可。
- 门禁基线（本轮）：前端 **55 文件 / 466 例**、Rust **375 passed / 2 ignored**；`npx tsc --noEmit`、`npm run format:check`、`npm run check:ui`、`cargo fmt --check`、生产构建通过。
- 装机命令（本地签名；末尾 updater 私钥报错是预期的）：
  ```bash
  cd ~/Mytools/anser
  set -a && . ./.env.local && set +a
  APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" \
    npx tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app
  # pkill -f "/Applications/雁信.app/Contents/MacOS/yanxin" → rm -rf /Applications/雁信.app
  # cp -R src-tauri/target/release/bundle/macos/雁信.app /Applications/雁信.app → open
  ```

### 0.2.2 发布内容（当前）

- 版本号统一为 `0.2.2`，新增 `docs/releases/v0.2.2.md`；正式 tag `v0.2.2` 推送 origin，触发正常 Alpha Release。
- 上游 0.1.24：实时单连接监听、Gmail 钥匙串待写容错、Tiptap 表格、字体颜色/十六进制归一化、空正文首行光标。
- 写信：回复/转发中文主题、收件人/抄送/密送整行自适应折叠、保存草稿按钮、阅读与写信行高/段距统一。
- 发布：`release.yml` 校验包内 4 个许可文件非空，缺失则在发布前中止。
- 暂缓：中英文界面（含 0.1.24 英文原生文案）、正文双语翻译、全局代理/图片样式、未读口径「全部邮件」、原生邮件链接。

### 0.2.1 窗口行为（保留，别再回退）

- 写信窗/阅读窗在前台时，`show_main_window` 直接返回：Dock、托盘、全局恢复快捷键不抢焦点、不最小化、不显示悬浮条。
- 主窗收到 `CloseRequested` **只隐藏主窗**；不再把关闭请求转给写信窗。写信窗自然失焦成「继续写信」，恢复主窗后悬浮条仍在。
- 写信窗自己的红灯/⌘W 仍由 `compose-window-*` 的 `CloseRequested` 拦下，发 `COMPOSE_WINDOW_CLOSE` 给写信窗，弹「保存 / 不保存 / 取消」。
- 悬浮条按 `!focused` 渲染；「继续写信」右侧 X 在主窗内弹三选项（保存并关闭 / 不保存 / 取消），空白邮件直接舍弃；「查看邮件」右侧 X 直接调用 `close_mail_window`。
- 写信窗位置按主窗逻辑坐标居中，并用当前显示器工作区钳制，修复 Retina 下出屏。
- 旧规则的 `action: "read+trash"` / `"serverMove+read"` 由 `ruleActionSteps()` 拆成多步，编辑器不再空白。

### 0.1.24 同步（0.2.2.1 检查点）

- 实时收取改为单条 IDLE 监听连接独占 INBOX：推送下载、连接后补查、每分钟只读复核和定时补查都在同一会话完成；后台全目录收取跳过被监听的 INBOX，复核失败丢弃会话。
- Gmail/OAuth 后台刷新令牌成功但钥匙串非交互写入被拒时，不再判整次收取失败：新令牌保留在内存并标记 pending，只在用户主动检查、连接或保存设置时交互重写，首次失败写活动日志。
- 收件人/抄送/密送输入行铺满整行，按实际宽度显示，放不下才折叠为 `+N`；聚焦输入框不再自动撑开多行，抄送行的「密送」入口固定在右侧。上游原来的 416px 上限按本地要求取消。
- 富文本接入官方 Tiptap 表格扩展，保留粘贴表格的行列、合并单元格与边框，随草稿和发送 HTML 保存。
- 富文本新增字体颜色：灰/红/橙/绿/蓝/紫/粉 7 个预设与默认色，按选区应用，图标跟随当前颜色；保存前把 `rgb()` 归一化为十六进制，兼容 Outlook。
- 空正文只保留一行，点击正文光标不再落到第二行。
- 英文界面原生托盘菜单、工具提示与通知文案属于 i18n，继续随中英文界面暂缓。

### 0.2.1 发布与流程

- 版本号统一为 `0.2.1`，新增 `docs/releases/v0.2.1.md`；`release.yml` 先建草稿、上传双架构资产，再自动发布为正常 Release（标题 Alpha、非 prerelease），`releases/latest` 指向它。
- 0.2.0 用户可应用内更新；本地 0.20.x 检查点版本号更大，semver 不会自动降级，已手动安装一次 0.2.1。
- `main` 已合并并通过 fast-forward 到发布代码；旧的长期功能分支已删除。后续每次从 `main` 拉短分支，推送并发 PR，验收后合并。
- CI 的 Vitest 超时放宽到 120s（`vite.config.ts`），避免 macOS runner 上分页/窗口用例误报；发布 Action 已完整通过。

## 三、本轮已完成（已验收）

### 设置与界面

- 设置页改为六分类导航：邮箱账号 / 过滤规则 / 本地存档 / 应用偏好 / 后台任务 / 关于雁信；宽窗左侧、窄于 900px 顶部导航；切换分类保留未保存输入。
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
- 旧存档迁移：`archive::PARSER_VERSION = 5`；`parser_version >= 3` 的旧记录只读头块回填 cc/优先级，不重新解码正文/附件；在线记录保留未知状态；`parser_version < 3` 仍完整重解析。
- `rule_runs` 顺序动作引擎：一条规则最多 8 个动作，持久化游标/快照/崩溃续跑；支持 `folder` / `save` / `saveFolder` / `read` / `unread` / `star` / `trash` / `serverCopy` / `serverMove`；新增后台任务卡「规则处理任务」。
- Dock：macOS 未读数 `set_badge_count`，零未读清除；口径沿用「全部收件箱」。
- 更新说明：Markdown 渲染 + 消毒（marked/DOMPurify），更新中心拉取当前版本到目标版本之间的全部 Release 历史。
- 撤回：即时发送撤回与定时计划取消都已「恢复为草稿并重新打开编辑」；发件箱排序按用户要求保持现状（待发送优先，计划时间升序）。

### 全局恢复窗口快捷键与偏好布局

- 应用偏好提供「恢复窗口快捷键」，默认 `⌘⌥` + 反引号，点击后直接录制；`Preferences.restore_shortcut` 持久化，旧偏好回退默认；Rust 用 `tauri-plugin-global-shortcut` 注册，保存失败回滚旧键。录制时 `suspend_restore_shortcut` 暂时注销当前键，取消/保存后重注册；被 macOS 占用的组合键无法录制（界面已提示）。
- 窗口恢复：handler 切主线程；先 AppKit 激活，200ms 后无条件 `open -a` 当前 bundle 走 LaunchServices（只发 reopen，不新建窗口）。不能依赖 `NSApplication.isActive` 判断，它可能已为 true 但前台仍是别的 App。实测最小化后 `⌘⌥` + 反引号可恢复并前置。
- 应用偏好两张全宽横卡上下排列；四个开关 + 快捷键横向铺开，三个下拉同行分摊、保存靠右；规则页 quiet-note 与执行记录卡间距统一为 24px。
- 验证：本轮前端 466 例、Rust 375 passed / 2 ignored；1470/1180/980 宽度布局已检查并装机。

### 许可证

- `LICENSE` / `NOTICE` / `docs/LICENSING.md` / `docs/licenses/shadcn-ui-MIT.txt` 已补齐并随 App 打包；`package.json` / `Cargo.toml` 许可字段与 README 段已更新。

## 四、同步上游剩下的工作（按建议顺序）

| 优先级 | 批次                                                           | 内容与依赖                                                                                                                                                                                                      | 状态/风险                                                           |
| ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 0      | 0.1.24 加固与写信修复                                         | 实时单连接监听、Gmail 钥匙串待写容错、收件人整行自适应折叠、Tiptap 表格、字体颜色、空正文光标。                                                                                                                     | **已发布（v0.2.2）**；英文原生文案随 i18n 暂缓。                   |
| 1      | 解析迁移与头块回填                                             | `archive::PARSER_VERSION` 升到 5；对已有原件的旧邮件**只读头块**回填 `cc` / `priority`，设置 `header_metadata_known=true`；不重新解码正文/附件。没有原件的在线记录保留 `false`。                                | **已完成（0.20.2）**；新增回填测试。                                |
| 2      | `rule_runs` 顺序动作引擎                                       | 一条规则最多 8 个顺序动作、`rule_runs` 表、崩溃后续跑、`RuleRun.observed`、`save` / `saveFolder` 动作；与本地 `rule_operations.rs` / `rule-executions.tsx` 合并。                                               | **已完成（0.20.2）**；本地动态来源与服务器执行记录保留。            |
| 3      | 邮件工作流对齐                                                 | 8 秒撤回 + 取消后恢复编辑 + 立即发送、`send_kind` 边界、调度领取后不可撤回；发件箱是否改按 `updated_at` 倒序仍**待用户决策**（现为按状态分组）。                                                                | **核对完成**：撤回已恢复编辑；发件箱保持现状，不改。                |
| 4      | 未读口径「全部邮件」                                           | 所有账号所有可阅读文件夹、排除废纸篓/隔离；已发送与草稿不计未读；父目录汇总；菜单栏/Dock 同口径。                                                                                                               | **暂缓**（用户 2026-10-21 决定）；保持「统一收件箱 + 每账号可配置范围」。 |
| 5      | Dock 未读角标                                                  | macOS `set_badge_count`，零未读清除。                                                                                                                                                                           | **已完成（0.20.2）**；与托盘同一口径。                              |
| 6      | 中英文界面（0.1.22/0.1.23）                                    | 上游 96 文件：`i18n.ts` + `src/locales/{config,zh-CN,en}.json`（各 1198 行）、`language-settings.tsx`、`interface_language.rs`、`check-i18n.mjs`；日历经 date-fns locale。0.1.23 只修版本一致性，无新产品功能。 | **暂缓**（用户 2026-10-21 再次确认）；0.1.24 英文原生文案同批暂缓。 |
| 7      | 双语翻译（0.1.17/0.1.18）                                      | `translation.rs`（1689 行）、设置卡片、钥匙串存 Key、SQLite 有界缓存、逐段译文、取消/重试、最近活动；依赖全局代理。                                                                                             | **暂缓**（用户 2026-10-21 再次确认）。                              |
| 8      | 全局代理 + 邮件图片/样式                                       | `proxy.rs`、`network-proxy-settings.tsx`、`mail_images.rs`（310）、`mail_styles.rs`（231）；翻译依赖它。                                                                                                        | **暂缓**（用户 2026-10-21 再次确认）；图片/样式仅在出现实际加载问题时再评估。 |
| 9      | 更新说明 Markdown / 更新历史                                   | 当前更新说明是纯文本 `whitespace-pre-wrap`；上游 `update_history.rs`（472）、`release-history.ts`、`release-notes.ts`。                                                                                         | **已完成（0.20.2）**；去掉代理依赖，指向 `wanghlstar/anser`。       |
| 10     | 原生邮件链接（0.1.16）                                         | 外链走系统浏览器。                                                                                                                                                                                              | **暂缓**（用户 2026-10-21 决定）；已有 `web_link` / 系统打开等价做法。 |
| 11     | workflow 许可校验                                              | `release.yml` 加 4 行 `test -s`，断言包内 `LICENSE` / `NOTICE` / `LICENSING.md` / `licenses/shadcn-ui-MIT.txt`。                                                                                                | **已完成**（2026-10-21）；缺失或为空时 CI 在发布前失败。           |
| 不跟   | Homebrew / preview / signing-check / 上游发布脚本 / Apple 证书 | 仓库与发布基建不同，**不要搬**。                                                                                                                                                                                | 见 `RULES_PORT_UPSTREAM.md` 第 55 条。                              |

**旧清单缺口**：上游 0.1.15–0.1.18（全局代理、原生邮件链接、双语翻译、邮件图片/字体）此前从未进清单；0.1.22/0.1.23 又新增了中英文界面，均已并入本表。逐版本差异跑 `npm run upstream:matrix` → `docs/UPSTREAM_VERSION_MATRIX.md`，判定是启发式，需人工归类；本轮人工复核 0.1.24，i18n 文件报「本地缺」符合预期；0.1.24 的功能项均已归类。

**已决定暂缓（2026-10-21）**：未读口径改「全部邮件」、原生邮件链接、中英文界面（含 0.1.24 英文原生文案）、邮件正文双语翻译、全局代理/邮件图片样式。

**已完成**：`release.yml` 已增加包内许可证非空校验（不需要新 secret 或 GitHub 设置）。

## 五、不要覆盖的本地功能

原生写信窗/阅读窗（`compose-window.tsx`、`mail-reader-window.tsx` + capabilities）、待发送/草稿面板、收件箱范围、邮件菜单、问候语/首行缩进、写信附件、移动菜单、删除账号弹窗、图片缩放、字体、`scroll-pane`、`button-group`、存档分层与「存档校验」、设置分类与折叠头。同步上游时以本地为底逐块合并。

## 六、常用命令与数据

- 开发预览：`npm run desktop`（单实例；安装版在跑时先退出安装版）。
- 门禁：`npx tsc --noEmit`、`npm run format:check`、`npm run check:ui`、`npx vitest run`、`npm run test:desktop`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`。
- 版本校验：`npm run release:check`（要求 `docs/releases/v<version>.md` 非空）。
- 数据/钥匙串标识 `dev.maildesk.desktop` 不得改；DB `~/Library/Application Support/dev.maildesk.desktop/mail.sqlite3`（只读用 `sqlite3 -readonly "file:$DB?immutable=1"`）。
- 真实收发范围见 `AGENTS.md`：仅腾讯企业邮箱 ↔ QQ 邮箱互发，主题「雁信联调」。
- 文档索引：`docs/IMPLEMENTATION.md`（进度）、`docs/RULES_PORT_UPSTREAM.md`（关键发现 1–61）、`docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`（逐项评估）、`docs/UPSTREAM_VERSION_MATRIX.md`（全量比较）、`docs/UPDATES.md`（发布/更新器）。
