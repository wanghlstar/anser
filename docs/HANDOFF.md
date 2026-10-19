# 会话交接（2026-10-19 第七轮：B 线范围与排序定稿 —— 先「设置重新设计」，再「规则」，其余待定）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。
>
> **本轮交接背景**：用户要把 opencode 从 v2 降级到 v1，v1 读不到 v2 的会话记录。所以本文件必须**自包含**——新会话看不到任何聊天记录，只能靠 AGENTS.md + 本文件 + 仓库文档。

## 一、给新会话的引导语（可直接整段复制给助手）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a（工作树干净，本地领先 origin 8 笔，**未推送**），最新发布 tag v0.2.0（Alpha 预发布通道）；上游 upstream/main = 331e05c（上游 0.1.21）。

**当前状态（一句话）**：A 线（本地界面）的设置页重排已验收提交；B 线（同步上游）刚做完批次 0.5（许可证），**范围与排序刚定稿、还没开工写代码**——先做「设置重新设计」，再做「规则」。

**用户刚定的 B 线范围（2026-10-19，原话见 docs/IMPLEMENTATION.md 最后一节）**
- 1a Dock 未读角标：**可做可不做，优先级最低**（我们已有托盘未读数）。
- 1b TaskPanelHeader：用户「没太明白是做什么」→ 已解释（见本文件第四节），**暂不做**；它与「后台任务五张独立卡」绑定，若将来用户要五卡再说。
- 2 设置：**要做，但不是照搬上游五分类导航，要「结合我们自己的个性化重新设计」**。← 下一轮从这里开始。
- 3 规则：**要做**，规则参考上游（同源，我们落后，且我们多了「规则处理」部分）。
- 4–7（解析迁移、邮件工作流、未读口径、双语翻译）：**等上面两项完成后再排计划**。

**下一轮开工前必须先问用户（不要自行发明需求）**：
1. 「设置的个性化重新设计」具体指什么——是保留我们现有的四卡+顶卡紧凑形态、只重排信息架构？还是要新的导航（左侧分区/顶部分类）？还是有具体想加/想删的设置项？可以给 2–3 个方案让用户挑，但**不能直接照搬上游五分类**。
2. 规则这一批的范围与优先级：条件扩展（开头/结尾、KB、日期、已读/星标、抄送、优先级、已接收天数）、首次匹配状态快照、`rule_runs.rs` 顺序动作引擎（我们只有 695 行的单动作 rule_operations.rs）——哪些要先做。
3. 顺带确认 4 个旧待决策项里与规则批相关的：未读口径是否改「全部邮件」、发送记录是否改按最近更新倒序（后台任务五卡形态、双语翻译可继续挂起）。

**优先级已定：先做本地要的东西，再同步上游的剩余批次。** 两条线：**A 本地界面 / 个性化实现**（需求由用户描述，**不要自行发明**）、**B 同步上游**（按批次搬，排在 A 之后）。

1. 读 AGENTS.md（长期约定：UI 铁律、真实收发范围、上游不可 cherry-pick）与本文件。
2. 读 docs/IMPLEMENTATION.md 最后七节（设置页重排、同日修订、上游评估、全量版本比较、验收提交、批次 0.5 许可证、B 线范围与排序定稿）+ docs/RULES_PORT_UPSTREAM.md 的关键发现 37–55。
3. 读 docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md（第十二节是**用户排序与 workflow 差异**，先看它；第七节是原批次表，已被第十二节取代排序）+ docs/UPSTREAM_VERSION_MATRIX.md（逐版本/双树比对）。
4. 核对环境：git status / git log --oneline -6 / git tag -l | tail。**tag 同名不同物**：v0.1.19/20/21 是上游的，v0.1.5–v0.1.9、v0.2.0 是我们的（`git log -1 --format="%an %s" <tag>` 认作者）。
5. 需要看效果时 `npm run desktop`；之前起过后台 dev server（PID 73584，端口 1420，可能还活着），浏览器里停在「设置与账号」页，可直接量几何。

铁律：
- 中文界面；业务界面只用 shadcn/ui，改 UI 后跑 `npm run check:ui`；不得回退已验收功能。
- 每轮同步 docs/IMPLEMENTATION.md（末尾追加带日期小节）与 docs/RULES_PORT_UPSTREAM.md（编号「关键发现」，现 55 条）。
- 改动先给用户人工验收，确认后再提交；提交信息用中文 `feat:`/`fix:`/`docs:` 风格，对应实际范围。
- 验证要在**构建产物**和真机上做：合成 PointerEvent 会假通过，WKWebView 里 event.buttons 恒为 0；CSS 改动要 grep `dist/assets/index-*.css`；本机 browser.screenshot 不可用，看布局只能量 getBoundingClientRect。
- **上游改动不能 cherry-pick**（与 upstream/main 无共同祖先），只能 `git show <sha>:<path>` / `git diff` 逐块搬。
```

## 二、当前基线

- 仓库 `/Users/wanghlstar/Mytools/anser`，分支 `feat/port-upstream-a`，工作树干净。`HEAD` 即本轮交接提交（`git log -1` 可查）；`origin/feat/port-upstream-a` 仍在 `2d357d4`，本地**领先 8 笔未推送**。
- 最近提交：`c5dbe97` docs 交接修正 → `dfabcc7` docs 批次 0.5 记录 + 关键发现 54 → `73b9a28` docs 许可证家族与随包交付 → `b4eb000` docs 设置页验收与拆分记录 → `0b39e33` docs 双树比对 → `689d183` docs 上游评估 → `6afe0d1` feat 设置页紧凑重排。
- 回滚：`git reset --hard b4eb000` 回到批次 0.5 之前；`git reset --hard 2d357d4` 回到设置页重排之前；tag `checkpoint-2026-10-19-settings-compact` → `0672f93`；备份分支 `backup-before-split` → `ac8a57a`。
- 发布：**0.2.0（Alpha 预发布）**，tag 已推 origin，`docs/releases/v0.2.0.md` 为说明；`release.yml` 建 Release 带 `--prerelease`，GitHub `releases/latest` 仍指 **0.1.9**，已装用户不会自动升级。
- **上游**：`upstream/main` = `331e05c`（0.1.21）；我们的移植基线是上游 `v0.1.19`（`037d7aa`）。自基线起实质提交只有 0.1.20 `3d48afc`、0.1.21 `1229985`，另有从未评估的 0.1.15–0.1.18 缺口（含双语翻译）。上游 tag 在 `refs/upstream/tags/*`（`git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags`）。
- 门禁基线：`npx tsc -b`、`npm run format:check`（覆盖 src/scripts/`.github/workflows/*.yml`/`package*.json`/`src-tauri/*.json`）、`npm run check:ui`、`npx vitest run` = **53 文件 / 432 例**、`npm run test:desktop` = **18**、`npm run build` 全绿；Rust `cargo test --manifest-path src-tauri/Cargo.toml` = **343 passed / 1 ignored**。
- 装机：`/Applications/雁信.app` = **0.2.0**（PID 61892，2026-10-19 11:32 起），形态是「同日修订」后、用户**已验收**的设置页。**但该包与 `src-tauri/target/release/bundle/macos/雁信.app.tar.gz`(+`.sig`) 都是批次 0.5 之前的旧包**，`Contents/Resources/` 只有 `icon.icns`，不含许可文件；要真机看许可证需重打/重装。
- 0.2.0 发布收尾未完成：Actions「Release macOS #6 / v0.2.0」当时 queued，之后没核实（本机无 `gh`）。要看 `https://github.com/wanghlstar/anser/actions` 两架构构建是否成功、`/releases` 草稿是否带 Pre-release 且含两份 DMG + `app.tar.gz` + `.sig` + `latest.json`；确认 `releases/latest` 仍指 0.1.9。

## 三、B 线范围定稿（本轮唯一实质产出，只改文档）

| 上游项                       | 用户结论                                                                 | 状态                                   |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| 1a Dock 未读角标             | 「可做可不做，我们已经做了托盘，优先级最低」                             | 挂起（批次 1 剩余项）                  |
| 1b `TaskPanelHeader`         | 「没太明白是做什么」→ 已解释（第四节）                                   | 暂不做；与五卡绑定                    |
| 2 设置五分类导航             | 「要做，但是要结合我们自己的个性化重新设计」                             | **下一批（A 线第 1 项）**              |
| 3 规则条件与状态快照         | 「要做，规则参考上游，源头一样，只是我们落后，加了规则处理的部分」       | **A 线第 2 项**                        |
| 4 解析迁移 / 5 邮件工作流    | 「后面的等上面完成了，再安排计划」                                       | 待定                                   |
| 6 未读口径 / 7 双语翻译      | 同上                                                                     | 待定（口径与翻译仍属产品决策）         |

**「加了规则处理的部分」的含义**（据本地代码）：我们有一整套上游没有的规则处理配套——`rule_operations.rs`（695 行，已自我分叉出 `inbox_scope`/`trusted_sources`）、`rule-executions.tsx`、`rules-panel.tsx`（844 行编辑器）。上游反而是 `rules.rs` 690 行 + `rule_runs.rs` 1299 行（顺序动作引擎）的两段式。所以这一批不是「拿上游覆盖本地」，而是**以本地为底、补上游的条件与状态能力**，并决定是否引入 `rule_runs` 的顺序动作模型。

## 四、1b 到底是什么（供新会话复述）

上游 0.1.21 的 `src/components/task-panel-header.tsx`：一个卡片标题栏组件，给「后台任务」五张独立卡共用。

- 结构：`CardHeader` 里放一个 ghost 按钮，左 title + 右 `ChevronDown`，点标题展开/收起本卡；右侧一个刷新按钮（`RefreshCw`），点它调 `onRefresh()`。
- 细节：刷新**最短转 600ms**（`Math.max(0, 600 - 已耗时)`），避免本地读太快导致闪烁不可见；同一时刻只允许一个刷新（`pending` ref 去重）；卸载时不再 `setState`（`live` ref）；失败 `toast.error(String(error))`。
- 它本身**不是功能**，只是「五张卡各自折叠 + 各自刷新」的载体；只有采用上游「设置页后台任务五张独立卡」才有意义。
- 我们在批次 0 刚按用户要求把「活动与诊断」改成**一张卡外层折叠**（展开后只有「最近活动」折叠、其余四项展开），与五卡方向冲突。所以：**用户不采纳五卡 → 这个组件就没有接线对象**，不做；若将来要做五卡，再连同 163 行测试一起搬（纯新增，零风险）。

## 五、workflow 与上游有什么不同（本轮核对结论）

| 文件                    | 我们 | 上游            | 差异要点                                                                                                                                                                                                                |
| ----------------------- | ---- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | 35 行 | 32 行          | 仅一处：上游 `cargo fmt --check` **阻塞**，我们改成 advisory（`\|\| echo "::warning::…"`，项目 Rust 保持手工紧凑风格）                                                                                                  |
| `release.yml`           | 147 行 | 137 行        | ①并发组 `release-${{github.ref}}` vs 上游 `release-macos`；②跳过已发布版本：我们内联 `gh release view`，上游 `scripts/release-draft.mjs check`；③签名：上游用自家 Apple 证书（`ANSER_CODESIGN_P12_BASE64/_PASSWORD` + `scripts/mac-ci-signing.mjs import/verify/cleanup` + `anser-signing.config.json`），我们靠 tauri-action 默认签名 + `codesign --verify --strict --deep`；④发布：我们内联 `gh release create --draft --prerelease` + `upload --clobber`，上游 `release-draft.mjs upload`                                            |
| `homebrew.yml`          | 无   | 51 行          | 上游维护自己的 Homebrew tap（`Casks/anser.rb`），仓库名不同，**不跟**                                                                                                                                                    |
| `preview.yml`           | 无   | 46 行          | 上游用 GitHub Pages 部署前端预览（`npm run build:preview` + `preview/` 目录），我们没有这套脚本，**不跟**                                                                                                               |
| `signing-check.yml`     | 无   | 61 行          | 上游用固定证书做签名回归，我们没有该证书，**不跟**                                                                                                                                                                      |

**唯一值得补的一处**：上游在签名校验步骤里还 `test -s` 断言包内 4 个许可文件（`LICENSE`/`NOTICE`/`LICENSING.md`/`licenses/shadcn-ui-MIT.txt`）。我们批次 0.5 已把 `bundle.resources` 配好，但 CI 不校验——将来改 `tauri.conf.json` 可能静默丢掉随包许可。补 4 行 `test -s` 即可（未做，记入待办）。

## 六、用户已验收、不得回退的功能

阅读窗图片选择/复制/自定义菜单、附件多选、写信附件条、Finder ⌘C→⌘V 粘贴为附件、收件箱 ⌘ 多选、写信红框、收件人区紧凑、写信工具栏单行（`COMPOSE_NARROW_WIDTH = 1080`）、三灯图标、点窗口外自动最小化、最小化保留最大化、多封信互不覆盖、标题栏拖动不漂移、列表头部刷新按钮组与账号下拉、写信关闭确认三按钮（取消/不保存/保存）、阅读窗与写信窗为真正的系统窗口（可拖出主窗、独立三灯与 ⌘W）、「继续写信」与「查看邮件」悬浮入口、主窗铺满状态跨重启。

设置页（0.2.0，已验收）：顶部两卡按控件类型分组——左「通知与启动」（新邮件通知/发送结果通知/Dock 图标/开机自启，四个开关横排一行）、右「间隔与外观」（后台检查间隔/延时发送/侧栏字号，三个下拉同行、一个保存按钮）；「存档校验」与「活动与诊断」整行平铺，「活动与诊断」外层默认折叠、展开后仅「最近活动」折叠。

产品约束：中文界面；正文仿宋 14pt；自带问候语/签名/全角空格首行缩进；存储与钥匙串标识 `dev.maildesk.desktop` 不能改。

## 七、常用命令

```bash
# 开发预览
cd /Users/wanghlstar/Mytools/anser && npm run desktop      # dev server: http://localhost:1420
lsof -ti:1420                                              # 看是否已有实例

# 门禁（每轮必跑）
npx tsc -b && npm run format:check && npm run check:ui && npx vitest run
npm run test:desktop && npm run build
cargo test --manifest-path src-tauri/Cargo.toml            # 动了 Rust 才跑

# 全量版本比较（会重写 docs/UPSTREAM_VERSION_MATRIX.md）
npm run upstream:matrix -- --local=<tag>

# 发布（真正构建只在 GitHub Actions；本机无 gh、无 updater 私钥）
npm run release:check
git push origin feat/port-upstream-a
git tag -a v0.2.1 -m "雁信 0.2.1" && git push origin v0.2.1
```

装机包（用户要真机验收时才做，约 5 分钟）：

```bash
cd /Users/wanghlstar/Mytools/anser
touch src-tauri/src/lib.rs          # 强制重新嵌入前端产物
set -a && . ./.env.local && set +a
APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" npx tauri build \
  --config '{"bundle":{"createUpdaterArtifacts":false}}' --bundles app
# 结尾「A public key has been found, but no private key」是已知无害报错

osascript -e 'quit app "雁信"'; sleep 2; pkill -f "雁信.app/Contents/MacOS/yanxin"
rm -rf /Applications/雁信.app
cp -R src-tauri/target/release/bundle/macos/雁信.app /Applications/雁信.app
open /Applications/雁信.app
```

真机鼠标/辅助功能探针（仓库外，可重建）：`/private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode/`
`ax.swift`（`click` / `drag` / `dblclick` / `dump [depth]` / `press`）、`wins.swift`、`wkverify.swift` + `wkverify.js`（真 WKWebView 跑 dev server 上的真前端代码）。

```bash
osascript -e 'tell application "System Events" to set frontmost of process "yanxin" to true'
swift ax.swift click 118 165
swift ax.swift dump 9 | grep "AXGroup t=写邮件"
```

设置页几何核对（截图不可用时）：`browser.evaluate` 量 `.storage-tools-top > *`、`.settings-tool-switches > *`、`.settings-tool-selects`、`.diagnostics-card` 内有无 `.diagnostics-body`，以及展开后各 `[data-slot=collapsible]` 的 `data-state`。**先 `tools.browser.tabs.focus({tabID})` 切前台**，否则 transition 挂起会量到中间值。

## 八、踩过的雷（完整 55 条见 RULES_PORT_UPSTREAM.md）

- WKWebView 的 `pointermove/mousemove` 里 `event.buttons` 恒为 0；手势收尾靠 `pointerup/pointercancel/mouseup/blur`。
- 合成 `new PointerEvent(..., { buttons: 1 })` 会假通过；真机用 CGEvent + AX 读回几何，或真 WKWebView 加载 dev server。
- 生产构建的 CSS 不是源码逐字复制（lightningcss 合并规则会丢声明）；**改完必须 grep `dist/assets/index-*.css`**。
- 浮动窗口定位不用 `translate`，用 `left/right + margin:auto`，并把 Dialog 自带 `translate-x/y-[-50%]` 从类名顶掉。复用外壳改尺寸时 `width/max-width` 要 `!important`，`height` **绝不能**加。
- ⌘W 被 macOS 原生菜单吃掉，走 Rust 拦 `CloseRequested`，别改默认菜单（会连累 ⌘C/⌘V）。
- `tauri.conf.json` 的 `app.security.capabilities` 是白名单，新 capability 必须登记；ACL 报错只在 debug 构建里有明细。
- 跨窗事件按方向拆名，否则同名事件回环（实测 1 分钟 trace 破百万行）。
- 建原生窗口时不要调原生淡入（runloop 未就绪 → alpha=0，窗口「找不到」）。
- macOS 拖到顶部填充不置 `NSWindow.isZoomed`；要持久化「铺满意图」并在启动时按 `work_area()` 重填。
- 设置页开关横排要按**自然宽度之和**算（444px），等分网格会把标签折成两行；判据是 `label` 的 `height` 14→28，盒子不溢出、`scrollWidth` 查不出来。
- 点 Radix 触发器用 `dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))`；React 更新异步，状态要在下一次 evaluate 里量。
- 三灯按钮的 AX 几何是乱码，只能按 CSS 算坐标；原生窗口标题栏按钮不可测。
- 演示模式持久化在 localStorage `mail-desktop-demo-v1`（点「先体验」进入，别点两次）。
- 环境坑：macOS 会话/显示器睡眠期间 AX 与 CGEvent 全部失效；Retina 视觉效果只能用户人工看。

## 九、待办与下一步

1. **A 线第 1 项：设置「结合个性化重新设计」**（对应上游批次 2，但不照搬五分类）。开工前先问清需求（第一节列了三个问题）；实现时保留现有已验收形态里用户满意的部分，上游可参考的是 `settings-layout.tsx`/`ui/tabs.tsx` 与 `storage-tools.tsx` 的 `CardHeader` 层级改造。
2. **A 线第 2 项：规则**（对应上游批次 3）。以本地 `rules-panel.tsx` + `rule_operations.rs` 为底，补条件（开头/结尾、KB、日期 Calendar、已读/星标、抄送、优先级、已接收天数）与 `ObservedStatus` 状态快照；是否引入上游 `rule_runs.rs` 顺序动作引擎需用户定。规则预览必须只读、不保存、不改真实邮件。
3. **挂起项**：1a Dock 角标（最低优先）、1b TaskPanelHeader（不采纳五卡就不做）、批次 4–7（等 1、2 完成再排）。
4. **0.2.0 发布收尾**：核实 Actions 两架构构建与草稿 Release，再决定是否手动发布；确认 `releases/latest` 仍指 0.1.9。
5. **可补的小口子**：`release.yml` 加 4 行 `test -s` 校验包内许可文件（见第五节）。
6. 已记录但暂缓：通知横幅优先级与可靠性；阅读器图片自定义菜单与左键选中（需原生 `WKUIDelegate`）；服务器删除永久阻塞时待删邮件一直隐藏；更新说明 Markdown 渲染（现为纯文本）；全局网络代理。
