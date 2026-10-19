# 上游同步与移植评估：0.1.20 / 0.1.21（2026-10-19）

> 本轮只做**同步与评估**：`git fetch upstream` + 逐提交分析，**没有改任何业务代码**。
>
> 结论速览：上游自我们基线（上游 `v0.1.19` = `037d7aa`）以来只有两个实质提交 ——
> `3d48afc`（0.1.20：邮件工作流 + 过滤规则 + 未读口径）与 `1229985`（0.1.21：设置五分类导航 + 后台任务卡片反馈），
> 其余是 Homebrew 配方移入主仓库与 release 记录（**不建议跟**）。
> 同时发现**旧移植清单存在缺口**：上游 0.1.15–0.1.18 从未进过清单（双语翻译、全局代理、邮件图片与字体、翻译校验），
> 本次一并记录。逐项可合并性见第六节，建议顺序见第七节，需用户决策项见第八节。

## 一、本次同步记录

- fetch 前 `upstream/main` = `30d65a7`（2026-10-16「docs: record verified 0.1.19 release and Homebrew update」）；fetch 后 `upstream/main` = `331e05c`。
- 新引用：分支 `upstream/codex/issue-1-improvements`；tag `v0.1.20`（`eb80fa4`）、`v0.1.21`（`1229985`）。
- fetch 时被拒的 tag：`v0.1.5`–`v0.1.9`（`would clobber existing tag`）——**同名不同物**：
  本地 `v0.1.5`（`432f441`「雁信 0.1.5 完结版本（基线）」）… `v0.1.9`（`9e1e8e0`「0.1.9 写信窗口 Foxmail 化 + 附件系统与富文本写信移植」）是**我们自己的**发布 tag；
  上游另有一套 v0.1.5–v0.1.9。以后看 tag：`v0.1.19 / v0.1.20 / v0.1.21` 是**上游**的，`v0.1.5–v0.1.9`、`v0.2.0` 是**我们的**。
- 我们此前的移植基线 = 上游 `v0.1.19`（`037d7aa`，2026-10-16「Release Anser 0.1.19」），它是 `upstream/main` 的祖先。
- **HEAD 与 `upstream/main` 没有共同祖先**（本仓库历史已整理成单一初始提交 `432f441`）→ **不能 `cherry-pick`**，
  只能按文件读 `git diff` / `git show <sha>:<path>` 逐块搬（沿用既有移植做法）。
- 命令：
  ```bash
  cd /Users/wanghlstar/Mytools/anser
  git fetch upstream --tags --prune
  git log --oneline v0.1.19..upstream/main
  git diff --stat v0.1.19..upstream/main
  git show <sha>:<path>            # 读上游某个文件的当时内容
  ```

## 二、上游 v0.1.19 之后的完整提交

| commit                | 日期  | 内容                                                                                                          |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| `30d65a7`             | 10-16 | docs：记录 0.1.19 发布与 Homebrew 更新（= fetch 前的 `upstream/main`，我们的基线之后）                        |
| `3d48afc`             | 10-17 | **Improve Issue #1 mail workflows, rules, and unread views (#2)** —— 0.1.20 的实质内容（42 文件，+3361 −648） |
| `eb80fa4`             | 10-17 | 0.1.20 版本号与发布说明（五处同步）                                                                           |
| `b2e89e1`             | 10-17 | 记录 0.1.20 发布                                                                                              |
| `c6f3426`             | 10-17 | Homebrew 配方移入应用主仓库（`Casks/anser.rb` + `.github/workflows/homebrew.yml`）                            |
| `0c300cb`             | 10-18 | 记录 Homebrew 工作流与 tap 迁移验证                                                                           |
| `1229985`             | 10-18 | **Redesign settings navigation and task feedback for 0.1.21** —— 0.1.21 的实质内容（23 文件，+1095 −535）     |
| `1c85297`             | 10-18 | Homebrew 配方更新到 0.1.21                                                                                    |
| `bff5261` / `331e05c` | 10-18 | 记录 0.1.21 发布与 Homebrew 同步验证                                                                          |

## 三、0.1.20（`3d48afc`）做了什么

上游自己的说明：`git show 3d48afc:docs/ISSUE_1_WORKING.md`；发布说明：`git show eb80fa4:docs/releases/v0.1.20.md`。

**规则引擎（改动最大）**

- 一条规则最多 **8 个顺序动作**，兼容旧单动作配置；纯本地动作可叠加（归类/完整保存/已读/未读/星标/本地废纸篓）。
- 条件新增：
  - 文字 **以此开头 / 以此结尾**（原来只有包含/不包含/等于）
  - **完整 MIME 大小**（整数 KB，未知大小按需读取）
  - **邮件日期**（改用 shadcn `Calendar` + `Popover`，不再用原生日期输入）
  - **已读状态 / 星标状态**（比较方式统一「等于」，值 true/false）
  - **抄送 / 收件人或抄送**（`Mail.cc`；「收件人或抄送」的「不包含」要求两个地址列表都不含该文字）
  - **优先级（高/普通/低）**（读 `X-Priority`/`Priority`/`Importance`）
  - **已接收天数（大于/小于/等于）**（按邮件 RFC3339 日期算完整天数，不用服务器下载时间）
- **首次匹配状态快照**：`Store::apply_configured_rules` 在展开动作前记录 `ObservedStatus`（两个布尔），每步用 `match_state_observed` 判断状态条件，
  于是「未读 → 标记已读 → 归类」这种链能整条走完；持久规则任务把同一快照写入 `RuleRun.observed`（旧任务 `serde(default)` 退回当前状态）。
- **未知头信息不误判**：抄送/收件人或抄送/优先级这类条件遇到未知头信息时进入 `NeedsBody`，由既有持久规则任务先完整保存再核对；
  规则预览分别显示「实际匹配数」与「等待完整邮件核对数」，不把未知算成否定匹配。
- 规则弹窗：固定 900px 宽（窄窗口受视口限制）；本地目标文件夹与动作选择同行，上移/下移/删除集中在最右侧；
  新建动作菜单**隐藏服务器复制/移动**，已保存的服务器动作仍显示并保留后端兼容。
- 涉及：`src-tauri/src/rules.rs`(+548)、`rule_runs.rs`(+158)、`store.rs`(169)、`scheduling.rs`(98)、`lib.rs`(181)、`models.rs`(24)、`tests.rs`(+294)、`archive.rs`(42)、`rule_operations.rs`；
  前端 `src/components/rules-panel.tsx`(+533)、`src/lib/rule-match.ts`(+71)、`src/lib/types.ts`(18)、`src/lib/api.ts`(98)。

**解析版本迁移**

- `archive::PARSER_VERSION` 升到 **5**。启动迁移对解析版本 3/4 的本地原件**只读已验证 MIME 的头部块**回填抄送与优先级，**不重新解码正文与附件**；
  没有原件的在线记录直接升版并保留 `header_metadata_known=false`。

**发送工作流**

- 写信与对话简短回复**点击发送即持久入队**，**8 秒内**可在待发页取消并**重新编辑**或**立即发送**；调度领取后不能撤回。
- `send_kind` 区分「撤回窗口」与「指定时间计划」；待发页默认收起详情；已发送待发记录可复制为新草稿。
- **已发送邮件可创建保留正文与附件的新草稿**，原邮件保持不变。
- 发送记录改为**按 `updated_at` 实际时间倒序**（取消原「待发送置顶 + 计划时间优先」混合排序），同时间按行号稳定排序。
- 草稿箱改紧凑卡片；全局草稿箱卡片紧凑布局。
- 涉及：`scheduling.rs` / `store.rs` / `lib.rs`、`src/components/outbox-panel.tsx`(+459)、`compose-dialog.tsx`(101)、`conversation-reader.tsx`(61)、`App.tsx`(146)。

**未读口径与桌面**

- 侧栏入口改名 **「全部邮件」**，口径 = 所有账号、**所有可阅读文件夹**（撤销只统计 INBOX 的做法）；排除废纸篓及隔离在线记录；
  侧栏/目录/星标、菜单栏、Dock 数字统一用同一范围；父目录按可信子目录汇总。
- **已发送与草稿**：不显示、也不计入未读；不显示未读点；列表右键、阅读页按钮与快捷键都不再提供未读切换；后端拒绝把它们改回未读；规则执行跳过对应 `unread` 动作。
- 账号下的收件箱/已发送/草稿箱目录不再提供右键「标记为已读」，其他服务器目录与账号星标入口保留。
- **Dock 未读角标**：macOS 主窗用 Tauri `set_badge_count` 同步本机未读统计，零未读清除角标（涉及 `notifications.rs`、`lib.rs`）。
- **托盘菜单**：打开 / 立即检查新邮件 / 暂停新邮件通知 / 退出；本机未读数每 5 秒刷新；通知前核对持久免打扰偏好。
- 已发送/草稿的服务器目录不显示未读徽标。

## 四、0.1.21（`1229985`）做了什么

上游说明：`git show 1229985:docs/SETTINGS_LAYOUT_WORKING.md`、`docs/releases/v0.1.21.md`。

- **设置五分类导航**（新增 `src/components/settings-layout.tsx`，79 行）：邮箱账号 / 本地存档 / 应用偏好 / 后台任务 / 关于雁信；
  宽窗口左侧分类 + 右侧内容，容器宽度 **< 900px 自动切换顶部导航**（`ResizeObserver`）；切换分类回到内容顶部；
  面板 `forceMount` + `hidden` 保持挂载 → **切换分类不丢未保存输入**。组合的是既有 shadcn `Tabs` + `Badge`（上游 `ui/tabs.tsx` 88 行，与我们**完全一致**）。
- **后台任务五张独立卡**（新增 `src/components/task-panel-header.tsx`，88 行）：每卡标题/说明本身就是展开触发器（点标题、说明、箭头都行），
  右侧独立「刷新」按钮：手动刷新时图标旋转 + 文案「刷新中」，**至少 600ms** 可见，防重复点击，卸载时清理，尊重「减少动态效果」；
  刷新完立即发布新数据（不延迟），刷新**保持当前展开状态**。五个卡都传 `defaultCollapsed`（默认折叠）。
- `src/components/storage-tools.tsx` 改 206 行：通知/启动与后台检查统一 `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` 层级，启动项用 `Separator` 分隔；
  该文件此时只剩两张卡（209 行）——**「本地存档」与「后台任务」的内容都搬到 `App.tsx` 的分类里**。
- `src/App.tsx` 改 552 行：按五分类重组；账号卡片改用 shadcn `Card`，操作按钮带账号名；规则页与补存提示里的「查看任务」直接进后台任务分类。
- `src/index.css` +123：分类导航、内容宽度、24px 卡片间距、窄窗口布局。
- 上游 App.tsx 分类内容（`git show 331e05c:src/App.tsx`，1840–2220 行）：
  - 邮箱账号 = 账号卡片列表 + 「添加账号」
  - 本地存档 = `storage-card`（完整保存/独立留存）+ `ArchiveIntegrity` + `ArchiveLocation` + 备份 / 立即归档 / 删除存档
  - 应用偏好 = `StorageTools`（系统通知与启动 + 后台检查）+ `NetworkProxySettings` + `MailTranslationSettings` + `MailSignatures`
  - 后台任务 = `ArchiveJobsPanel` + `ServerOperations` + `FolderHealthPanel` + `DirectoryOperationsPanel` + 「最近活动」卡（都 `defaultCollapsed`）
  - 关于雁信 = 关于 + 更新
- 另有 **Homebrew 配方移入主仓库**（`Casks/anser.rb`、`.github/workflows/homebrew.yml`）——与本项目发布目标无关，**不跟**。

## 五、旧清单的缺口：上游 0.1.15–0.1.18

我们的移植清单（`RULES_PORT_UPSTREAM.md`「移植清单（上游基线 v0.1.19）」）只列了 0.1.19 的附件体系与富文本，
`AGENTS.md` 的上游基线说明里**跳过了 0.1.15–0.1.18**，这四版从未评估：

| 上游版本 | commit    | 内容                                                                                                                                                                                                                                                                                    | 规模   |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| v0.1.15  | `63fb6c2` | 全局邮件代理（`src-tauri/src/proxy.rs` 53 行 + `src/components/network-proxy-settings.tsx`）                                                                                                                                                                                            | 中     |
| v0.1.16  | `8a13673` | 原生邮件链接修复（我们已有等价做法：外链走系统浏览器，**待核对**）                                                                                                                                                                                                                      | 小     |
| v0.1.17  | `7312e5c` | **大模型逐段双语翻译**（`translation.rs` 1444 行、设置卡片 `mail-translation-settings.tsx`、`translatable-mail-body.tsx`、`lib/mail-translation.ts`、钥匙串存 API Key、SQLite 有界缓存、活动记录）＋ **邮件图片/背景/字体**（`mail_images.rs` 310、`mail_styles.rs` 231，依赖全局代理） | **大** |
| v0.1.18  | `7122409` | 翻译稳定性与错误分类（`translation.rs` +267、`mail-translation.ts` +62）                                                                                                                                                                                                                | 中     |

双语翻译的功能要点（`git show 7312e5c:docs/releases/v0.1.17.md`、`docs/TRANSLATION_WORKING.md`）：
邮件标题右侧翻译图标 → 保留原文、逐段在下方显示译文并保留标题/加粗/链接/列表/表格排版；设置页左右布局配置「服务 / 模型 / 密钥 / 目标语言」，
兼容 OpenAI Chat Completions，预置 DeepSeek / OpenAI / 自定义 / 本机模型；API Key 只存本机钥匙串；
仅用户点击时把可见正文文字发给模型（不发邮件头/图片/附件/原始 MIME）；支持取消、隐藏、重试与本地缓存；
批次与连接测试写入「最近活动」（记结果、字数、耗时、缓存来源，不记正文/译文/地址/密钥）。远程请求走上游的**全局代理**。

## 六、与本地现状的逐项对照（可合并性）

本地现状核实方式：`grep`/读源码（见括号内位置）。

| 上游改动                                                                                   | 我们现状                                                                                                                                                      | 判断                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 设置五分类导航（`settings-layout.tsx` + Tabs）                                             | 设置页与「本地存档管理」是 `App.tsx` 里同一分支（`page === "settings" \|\| page === "storage"`，仅页头文案不同，App.tsx:2592）；`storage-tools.tsx` 4 张卡    | **可合并（需改造）**：`ui/tabs.tsx` 与上游逐行一致，组件本身近乎可原样搬；工作量在 `App.tsx` 五分类重组（我们 4435 行 vs 上游 3088 行）       |
| 后台任务五卡 + `TaskPanelHeader`（默认折叠、每卡刷新、点标题展开）                         | 本轮刚定为「活动与诊断」**一张卡**：外层默认折叠、展开后「最近活动」折叠、其余四项展开                                                                        | **方向冲突，先定取舍**：上游是「五张独立卡 + 每卡刷新」（截图里是展开后的样子）；`TaskPanelHeader` 组件本身可先搬（纯新增 + 自带 163 行测试） |
| `storage-tools.tsx` 改 `CardHeader/CardTitle/CardDescription/CardContent` + `Separator`    | 本轮仍是自绘 `.settings-tool-title` + `<h3>`                                                                                                                  | 可合并（低风险，随分区导航一起做）                                                                                                            |
| 规则条件扩展（开头/结尾、KB、日期、已读/星标、抄送、收件人或抄送、优先级、已接收天数）     | 本地条件字段只有 `sender / recipients / subject / body / attachment / date`（`rules-panel.tsx:51-58`），无开头/结尾操作符、无状态类条件、日期无 Calendar 弹层 | **可合并（分批）**：后端 `rules.rs` / 前端 `rules-panel.tsx` 都得逐块读，我们与上游是两套实现                                                 |
| 首次匹配状态快照 `ObservedStatus` / `RuleRun.observed`                                     | 没有（无 `match_state_observed`）                                                                                                                             | 可合并；注意旧 `RuleRun` 的 `serde(default)` 兼容                                                                                             |
| 未知头信息 → 等待完整保存后核对（`NeedsBody`）+ 预览双计数                                 | 没有对应机制                                                                                                                                                  | 可合并（依赖解析迁移）                                                                                                                        |
| 解析版本升 5 + 头块回填迁移                                                                | 我们的 `parser_version` 是 3（`archive_jobs.rs:317`、`search.rs:269` 等），且历史上写过 1                                                                     | **需改造**：先定我们自己的版本号与迁移路径，再搬头块回填逻辑                                                                                  |
| 规则弹窗 900px / 目标与动作同行 / 排序删除集中右侧 / 隐藏服务器复制移动 / Calendar 弹层    | 已有「移动到文件夹」单一合并动作、本地动作可叠加（`rules-panel.tsx` 字段表与提示文案）；弹窗宽度与日期控件不同                                                | 可合并（UI 对齐，低风险）                                                                                                                     |
| 8 秒撤回 + 取消后**恢复编辑** + 立即发送 + `send_kind`                                     | 已有待发送面板：倒计时、取消、重新定时、立即发送（`src/components/pending-send.tsx` 有「立即发送」）                                                          | **部分已有**：缺「取消后把正文/收件人恢复到写信窗口」与「调度领取后不可撤回」的边界，做行为对齐即可，不必搬整个 `scheduling.rs`               |
| 发送记录按 `updated_at` 倒序 + 紧凑行 + 默认收起详情                                       | 我们发件箱是**按状态分组**（0.1.6 起如此）                                                                                                                    | **需决策**：两种排序取向不同                                                                                                                  |
| 已发送邮件创建新草稿（保留正文与附件）                                                     | **已有**：`App.tsx:1764`「重新编辑已发送邮件：生成新草稿进写信窗口，原邮件不动」                                                                              | 已具备；只需核对附件是否一并保留                                                                                                              |
| Dock 未读角标（`set_badge_count`）                                                         | **没有**（Rust 里搜不到 badge 相关）                                                                                                                          | **可合并（纯净新增）**，建议单独一笔                                                                                                          |
| 托盘菜单「打开 / 立即检查 / 暂停通知 / 退出」+ 菜单栏数字                                  | 已有「免打扰 / 立即收取 / 退出」+ `tray.set_title(未读数)`（`lib.rs:2594-2595`）                                                                              | 低优先对角（我们「免打扰↔通知开关双向同步」是自有功能，别丢）                                                                                 |
| 未读口径 = 「全部邮件」（所有账号所有可阅读文件夹，排除废纸篓/隔离；已发送与草稿不计未读） | 我们是「统一收件箱 + 每账号可配置范围」                                                                                                                       | **口径不同、高风险**：属产品语义变更，必须用户先定                                                                                            |
| 双语翻译（0.1.17/0.1.18）                                                                  | **完全没有**（无 `translation.rs` / `mail-translation*` / `translatable-mail-body*`）                                                                         | 大功能，独立轮次；需用户先定是否要                                                                                                            |
| 邮件图片/字体走全局代理（`mail_images.rs` / `mail_styles.rs`）                             | 我们有自有正文图片处理（0.1.14 起「正文图片加载超时提示与重试」），无代理                                                                                     | 与代理绑定；先只评估「透明占位图误报」那条修复是否需要                                                                                        |
| 全局网络代理（0.1.15）                                                                     | 没有                                                                                                                                                          | 既有 C 类「暂不做」，但**翻译依赖它**，若要翻译需一并评估                                                                                     |
| Homebrew 配方移入主仓库                                                                    | 我们走 `release.yml` + Alpha 预发布通道，发布目标是 `wanghlstar/anser`                                                                                        | **不做**                                                                                                                                      |
| 上游 docs 类提交（`ISSUE_1_WORKING.md` 等）                                                | ——                                                                                                                                                            | 不移植，只作参考                                                                                                                              |

## 七、建议的推进顺序（每批一个可验收单元）

```text
批次 0  收尾本轮设置页重排      → 验收 → 提交（否则后面所有设置页改动都会撞未提交改动）
批次 1  低风险纯新增            → Dock 未读角标；TaskPanelHeader 组件 + 测试（先不接线）
批次 2  设置五分类导航          → settings-layout.tsx + App.tsx 五分类重组 + index.css
                                  + 后台任务五卡接线（含 storage-tools 改 CardHeader 层级）
批次 3  规则条件与状态快照      → 抄送/优先级/天数/已读/星标/开头结尾/KB + ObservedStatus
                                  + 预览双计数 + Calendar 弹层 + 900px 弹窗
批次 4  解析迁移                → parser_version 与「只读头块回填」（cc/priority）
批次 5  邮件工作流对齐          → 8 秒撤回的「取消恢复编辑」、send_kind 边界、（排序待决策）
批次 6  未读口径                → 若用户要「全部邮件」，单独一轮
批次 7  双语翻译                → 若用户要，独立大轮（含代理依赖评估）
不做    Homebrew 主仓配方、上游 docs 类提交
```

每批的验证要按 `docs/HANDOFF.md` 第四节的门禁 + 真机/开发预览；规则、解析迁移、未读口径三批要额外做原生只读预览核对（规则预览不保存、不改真实邮件）。

## 八、需要用户先决策的问题

1. **后台任务形态**：采用上游「五张独立卡、默认折叠、每卡刷新」，还是保留本轮刚改的「一张卡外层折叠 + 内层四项展开」？
2. **未读口径**：是否改成上游「全部邮件」（所有文件夹 + 排除废纸篓/隔离 + 已发送与草稿不计未读 + 父目录汇总）？
3. **发送记录排序**：是否改成「按最近更新时间倒序」（现在是按状态分组）？
4. **双语翻译**：要不要做（大功能，需模型服务配置与钥匙串存 Key，且上游实现依赖全局代理）？

## 九、参考

- 上游工作点文档：`git show 3d48afc:docs/ISSUE_1_WORKING.md`、`git show 1229985:docs/SETTINGS_LAYOUT_WORKING.md`、`git show 7122409:docs/TRANSLATION_WORKING.md`
- 上游发布说明：`docs/releases/v0.1.20.md`、`v0.1.21.md`、`v0.1.17.md`、`v0.1.18.md`（都在上游 tag 里）
- 我们的移植规则与清单：`docs/RULES_PORT_UPSTREAM.md`（关键发现 + 移植清单）
- 门禁、装机、几何核对：`docs/HANDOFF.md` 第四节；本机 `browser.screenshot` 不可用，量 `getBoundingClientRect()`

## 十、全量版本比较（脚本，2026-10-19 新增）

起因：0.1.2–0.1.9 是「选择性同步」，漏了什么只能翻 tag；人记的清单已经漏过 0.1.15–0.1.18。

做法与产物：

- 上游 tag 与我们的 `v0.1.0–v0.1.9` 同名，先分命名空间：`git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags`
- `npm run upstream:matrix` → `docs/UPSTREAM_VERSION_MATRIX.md`（逐版本总览 + 本地缺失/偏薄清单 + 逐版本明细）

首轮结论（人工归成四类）：

- **A 真缺口（本地确实没有）**：`translation.rs`(1444→1689)、`mail-translation.ts`(575→627)、`translatable-mail-body.tsx`、`mail-translation-settings.tsx`(606)、`translation-activity.test.ts`、`mail_images.rs`(310)、`mail_styles.rs`(231)、`mail-image-resources.ts`、`proxy.rs`(393→477)、`network-proxy-settings.tsx`、`rule_runs.rs`(1159→1299)、`rule-runs.tsx`(235)、`settings-layout.tsx`、`task-panel-header.tsx`、`update_history.rs`(472)、`release-history.ts`、`release-notes.ts`、`LICENSE`、`NOTICE`。
- **B 疑似等价（改名/重写过，需人工核）**：`archive_location.rs`+`archive-location.tsx`+`archive-integrity.tsx`（我们的存档位置与「校验存档」在 App.tsx / storage-tools.tsx 里）、`mail-filters.tsx`（我们的筛选弹层）、`credentials.rs`（我们的钥匙串实现）、`preview/`+`preview-bridge.ts`（我们的演示模式）、以及若干纯测试文件（`compose-forward-files.test.tsx`、`rich-body.test.ts`、`rich-image-size.test.ts`、`remote-folder-list.test.tsx`、`demo-outbox.test.ts`）。
- **C 不跟**：`scripts/homebrew*`、`scripts/release-draft*`、`mac-*signing*`/`scripts/signing/*`（上游发布基建）、上游 `docs/`。
- **D 行数偏薄但多为测试**：`app-updates.test.tsx`(395/166，与更新说明相关)、`mail-content-loading.test.tsx`(262/90)、`remote-folders.test.ts`(158/59)、`rich-body.ts`(103/61)、`demo-rules.test.ts`(107/64)、`rules-panel.test.tsx`(430/224)；核心功能只有 `rules.rs`（690/176）真偏薄。

## 十一、以检查点 tag 为基准的双树比对（2026-10-19）

基准：本地 `checkpoint-2026-10-19-settings-compact`（`0672f93`）↔ 上游 `v0.1.21`（`1229985`）。生成：`node scripts/upstream-matrix.mjs --local=checkpoint-2026-10-19-settings-compact`（脚本第二段，两棵树直接比，不依赖共同祖先）。原始清单在 `docs/UPSTREAM_VERSION_MATRIX.md`。

| 项             | 数量                           | 含义                                         |
| -------------- | ------------------------------ | -------------------------------------------- |
| 上游独有       | 52（其他 13、Rust 9、前端 30） | 待移植候选                                   |
| 本地独有       | 29（前端 26、Rust 2、其他 1）  | 我们自研，上游没有                           |
| 双方都有但不同 | 116                            | 将来需逐块合并                               |
| 疑似改名对应   | 0                              | 上游缺项里没有能自动配对的改名，必须人工归类 |

**上游独有分簇**：① 双语翻译（`translation.rs` 1689、`mail-translation.ts` 627、`translatable-mail-body.tsx`、`mail-translation-settings.tsx` 606 + 测试）② 规则运行记录（`rule_runs.rs` 1299、`rule-runs.tsx`）③ 设置五分类与后台任务（`settings-layout.tsx`、`task-panel-header.tsx`）④ 全局代理与凭据（`proxy.rs`、`network-proxy-settings.tsx`、`credentials.rs`、`keychain-migrate.rs`）⑤ 更新历史（`update_history.rs`、`release-history.ts`、`release-notes.ts`）⑥ 附件图片与样式（`mail_images.rs`、`mail_styles.rs`、`mail-image-resources.ts`）⑦ 需人工核的疑似等价（`archive_location.rs`+`archive-location.tsx`+`archive-integrity.tsx`、`mail-filters.tsx`——我们的存档位置与「校验存档」在 App.tsx / storage-tools.tsx 里，筛选在自研弹层里）⑧ 不跟（`preview/*`、homebrew/签名脚本、`release-draft*`；其中 **`LICENSE`/`NOTICE` 建议补**）。

**本地独有（同步上游时别被覆盖）**：原生写信窗与阅读窗（`compose-window.tsx`、`mail-reader-window.tsx`、`capabilities/compose-window.json`、`capabilities/mail-window.json`）、待发送与草稿面板（`pending-send.tsx`、`drafts-panel.tsx`）、收件箱范围（`inbox-scope.tsx`）、邮件菜单（`mail-menu.ts`）、问候语与缩进段落（`greeting-paragraph.ts`、`indented-paragraph.ts`）、写信附件、移动菜单、删除账号弹窗、图片缩放、字体、`scroll-pane`、`button-group`。

**双方不同里行数差最大者**（我们领先 → 上游领先）：`lib.rs` 3085/1674、`tests.rs` 4093/2702、`App.tsx` 4435/3088、`store.rs` 2112/1219、`index.css` 4381/3775、`compose-dialog.tsx` 1718/1117、`rule_operations.rs` 695/433（我们更大）；**上游领先**的只有 `rules.rs` 690/176（最大真差距）、`app-updates.tsx` 581/364、`paging.rs` 1100/919，其余多为测试文件（`rules-panel.test.tsx` 430/224、`mail-content-loading.test.tsx` 262/90）。

**结论**：本地界面这条线先做没问题（上游 0.1.21 的设置结构即便搬来，也要与我们的 `storage-tools.tsx` 四卡形态和原生窗口共存）；将来同步上游时真正的功能缺口是**翻译、规则运行记录、代理/凭据、更新历史**四块，`rules.rs` 必须逐块人工合并（176 行 vs 上游 690 行），`archive-*` 与 `mail-filters` 先人工核对是否已有等价实现。
