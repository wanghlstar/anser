# 会话交接（2026-10-19，第六轮：两线并行——设置页重排待验收 + 上游全量比较完成，等用户定「同步上游 / 个性化实现」怎么排）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接整段复制给助手）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a（已推 origin），最新 tag v0.2.0（Alpha 预发布通道）；上游已 fetch 到 upstream/main = 331e05c（上游 0.1.21）。

**当前状态（两件事）**

① 刚提交的「设置与账号」页重排（检查点提交 `0672f93` + tag `checkpoint-2026-10-19-settings-compact`，**已装机，等你验收**）。第一版装机后用户反馈了三条：①「活动与诊断」要整卡默认折叠、内层只折叠「最近活动」、其余四项展开 ②「已归档 N 封」并进「保留 N 天」那一行 ③顶卡恢复紧凑（四个开关横排一行、三个下拉同行）并把「侧边栏字号」改「侧栏字号」。三条都已改完，开发预览里量过几何（数据见 docs/IMPLEMENTATION.md 的「同日修订」小节），`/Applications/雁信.app` 里就是这一版（0.2.0，PID 61892 起于 2026-10-19 11:32）。要整轮退回：`git reset --hard 2d357d4` 或 `git revert 0672f93`。

② 刚做完**上游同步与移植评估**（只改文档，没动业务代码）。结论：上游自我们移植基线（上游 v0.1.19 = 037d7aa）以来只有两个实质提交 —— `3d48afc`（0.1.20：邮件工作流 + 规则条件/状态快照 + 未读口径 + Dock 角标）与 `1229985`（0.1.21：设置五分类导航 + 后台任务卡片反馈）；另发现**旧清单缺口**：上游 0.1.15–0.1.18 从未评估（含**大模型逐段双语翻译**）。逐项可合并性、建议批次、待决策项全在 **docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md**。

**优先级已定：先定本地界面，再同步上游。** 开工先做五件事，然后向我确认两条工作线怎么排：**A 本地界面 / 个性化实现**（我们自己要的界面与行为改动、自研功能，需求由我描述，**不要自行发明需求**）、**B 同步上游**（按批次搬上游 0.1.20/0.1.21 与 0.1.15–0.1.18 缺口的可合并项，排在 A 之后）。

1. 读 AGENTS.md（项目长期约定：UI 铁律、真实收发范围、上游 cherry-pick 策略）与 docs/HANDOFF.md（交给你的这份）。
2. 读 docs/IMPLEMENTATION.md 最后四节（「设置页重排」「同日修订」「上游同步与 0.1.20/0.1.21 移植评估」「上游全量版本比较脚本」）+ docs/RULES_PORT_UPSTREAM.md 的关键发现 37–53（原生窗、ACL 白名单、跨窗事件、主窗铺满、设置页排布、tag/清单两个坑、矩阵脚本口径）。
3. 读 docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md（上游评估：逐项对照表、批次 0–7、4 个待决策项；**第十一节是以检查点 tag 为基准的双树比对结论**）与 docs/UPSTREAM_VERSION_MATRIX.md（逐版本对照 + 双树比对原始清单）；要复核就重跑 npm run upstream:matrix --local=<tag>（上游 tag 在 refs/upstream/tags/*）。
4. 跑 git status / git log --oneline -6 / git tag -l | tail，核对工作树与 tag 对得上。**tag 有同名不同物**：v0.1.19/v0.1.20/v0.1.21 是上游的，v0.1.5–v0.1.9、v0.2.0 是我们的（用 `git log -1 --format="%an %s" <tag>` 认作者）。
5. 需要跑起来看效果时优先 npm run desktop；之前起过一个后台 dev server（PID 73584，端口 1420，可能还活着），浏览器里已进演示模式并停在「设置与账号」页，可直接复用来量设置页几何。

先问我这三件事再动手：**a)** 本轮设置页重排的验收结论（通过／要改哪里）；**b)** 本地界面这条线这次要改什么（先做这条）；**c)** 上游同步从哪一批开始（评估文档第七节给了批次 0–7，其中批次 0.5 = 补 LICENSE/NOTICE + 人工核 rule_runs/archive-* 是否真缺；排在本地界面之后）。另外评估文档第八节有 4 个必须我先定的取舍：后台任务「五张独立卡」还是「一张卡外层折叠」、未读口径是否改成「全部邮件」、发送记录是否改成按最近更新时间倒序、要不要做双语翻译。

背景（已提交、打成 0.2.0 Alpha）：①列表按账号收取 ②阅读窗改 Tauri 原生独立窗口 ③写信窗改原生独立窗口 +「继续写信」悬浮入口 ④主窗「铺满」状态跨重启 + 阅读窗「查看邮件」悬浮入口。

铁律（必须遵守）：
- 中文界面；业务界面只用 shadcn/ui 组件，改 UI 后跑 npm run check:ui；不得回退已验收功能。
- 每轮同步 docs/IMPLEMENTATION.md（末尾追加带日期小节）与 docs/RULES_PORT_UPSTREAM.md（编号「关键发现」，现 53 条）。
- 改动先给我人工验收，我确认后再提交；提交信息用中文 feat:/fix:/docs: 风格，对应实际完成范围。
- 验证要在「构建产物」和真机上做：合成 PointerEvent 会假通过，WKWebView 里 event.buttons 恒为 0；CSS 改动要 grep dist/assets/index-*.css 确认没有被生产构建吃掉；本机 browser.screenshot 不可用，看布局只能量 getBoundingClientRect。
- **上游改动不能 cherry-pick**（本仓库与 upstream/main 无共同祖先），只能 `git show <sha>:<path>` / `git diff` 逐块搬。
```

## 二、当前基线

- 仓库 `/Users/wanghlstar/Mytools/anser`，分支 `feat/port-upstream-a`；本轮设置页重排已验收，已拆为 `6afe0d1`(feat) + `689d183`(docs)（拆分自检查点 `0672f93`；tag `checkpoint-2026-10-19-settings-compact` 仍指向 `0672f93` 作回滚点），**未推 origin**（`origin/feat/port-upstream-a` 仍在 `2d357d4`，本地领先 3 笔）。
- 发布：**0.2.0（Alpha 预发布通道）**——注解 tag `v0.2.0` 已推 origin，`docs/releases/v0.2.0.md` 为说明；`release.yml` 建 Release 时带 `--prerelease`，GitHub 的 `releases/latest` 仍指向上一版正式版 **0.1.9**，已装用户不会被自动升级。
- **发布收尾未完成**：推 tag 时看到 Actions「Release macOS #6 / v0.2.0」状态 queued，之后没再核实（本机没装 `gh`）。新会话可打开 `https://github.com/wanghlstar/anser/actions` 看两架构构建是否成功、`/releases` 看草稿 Release 是否带 Pre-release 徽标且含 `Yanxin_0.2.0_{aarch64,x86_64}.dmg`、`app.tar.gz`、`.sig`、`latest.json`，再决定是否手动发布草稿；顺手确认 `releases/latest/download/latest.json` 仍指向 0.1.9。
- **上游**：`upstream/main` = **`331e05c`**（上游 0.1.21，2026-10-19 fetch）；我们的移植基线是上游 `v0.1.19`（`037d7aa`）。上游自那以后只有两个实质提交：0.1.20 `3d48afc`、0.1.21 `1229985`；另有旧清单缺口 0.1.15–0.1.18（含大模型双语翻译）。评估见 `docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`。**注意 tag 同名不同物**：`v0.1.19/v0.1.20/v0.1.21` 是上游的，`v0.1.5–v0.1.9`、`v0.2.0` 是我们的。`HEAD` 与 `upstream/main` 无共同祖先，上游改动只能逐块搬，不能 cherry-pick。**全量版本比较**：`npm run upstream:matrix` → 生成 `docs/UPSTREAM_VERSION_MATRIX.md`（逐版本对照「本地缺/本地偏薄」，首轮结论见评估文档第十节）；`--local=<tag>` 可指定基准并额外生成「双树比对」段，已跑过 `checkpoint-2026-10-19-settings-compact ↔ 上游 v0.1.21`：上游独有 52 / 本地独有 29 / 双方不同 116，归类见评估文档第十一节。上游 tag 在独立命名空间 `refs/upstream/tags/*`，一次性抓取 `git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags`。
- 最近提交：`2d357d4` docs 交接文档与上游基线同步 → `fe6e600` release 0.2.0 版本号与发布说明 → `1a72a62` ci 发布流水线改走 Alpha 预发布通道 → `233f529` feat 主窗铺满状态跨重启、阅读窗悬浮入口 → `8bce831` feat 写信窗原生 → `3a2414c` feat 阅读窗原生 → `80b42de` feat 列表按账号收取、关闭确认与 ⌘W、浮动阅读窗。
- tag：`v0.2.0`（最新正式发布 tag）、`v0.1.9`（上一版正式）；快照 tag `checkpoint-2026-10-18-compose-window`、`checkpoint-2026-10-17-port-upstream-a`、`baseline-2026-10-16`。
- 门禁基线：`npx tsc -b`、`npm run format:check`（覆盖 src / scripts / `.github/workflows/*.yml` / `package*.json` / `src-tauri/*.json`）、`npm run check:ui`、`npx vitest run` = **53 文件 / 432 例**、`npm run test:desktop` = 18、`npm run build` 全绿；Rust 本轮未改（上次 `cargo test` = 343 passed / 1 ignored，共 344 例）。
- 装机：`/Applications/雁信.app` = **0.2.0**（PID 61892，2026-10-19 11:32 起），即「同日修订」后的形态，**用户已验收通过**（装机版第一版 PID 75638 早于修订，已作废）。

### 本轮改动（已提交为检查点 `0672f93` + tag `checkpoint-2026-10-19-settings-compact`）

**A. 设置页重排那轮（业务改动，等验收）**：`src/components/storage-tools.tsx`、`src/components/storage-tools.test.tsx`、`src/index.css`、`src/App.test.tsx`、`docs/IMPLEMENTATION.md`（同轮小节 + 「同日修订」小节）、`AGENTS.md`（UI 铁律里那条设置页分组约定已按最终形态改写）。

**B. 本次「同步上游 + 评估 + 全量版本比较」记录**：新增 `docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`、`docs/UPSTREAM_VERSION_MATRIX.md`（脚本生成）、`scripts/upstream-matrix.mjs`；`docs/RULES_PORT_UPSTREAM.md`（第 52–53 条 + 移植清单顶部提示，现 53 条）；`AGENTS.md` 与 `docs/IMPLEMENTATION.md` 里的上游基线说明；`package.json`（新增 `upstream:matrix`）；`docs/HANDOFF.md`（本文件）。

**设置页重排的最终形态**（细节见 `IMPLEMENTATION.md` 最后一节及其「同日修订」小节）：

1. 顶部两卡按**控件类型**分组，卡名是本轮改的（回退只动两处 `<h3>` 文案 + 两处图标）：左卡「系统通知」→ **「通知与启动」**（Bell 图标）＝ 新邮件通知 / 发送结果通知 / Dock 图标 / **开机自启**（从右卡搬回，说明文字一并搬回），**四组开关横排一行**（自然宽度合计 444px）；右卡「后台检查」→ **「间隔与外观」**（Clock3 图标）＝ 后台检查间隔 / 延时发送 / **侧栏字号**（从「外观」卡搬来），**三个下拉同行并排、不写文字标签**（含义靠卡底说明），合并后的保存按钮同排靠右。
2. 顶卡列宽 `1.3fr : 1fr`（左宽右窄，为容纳四组开关）；第一版的「逐行对齐」已撤销（`.storage-tools-top .settings-tool { justify-content:flex-start }`、`.settings-tool-row { min-height:36px }` 都删了）；窄窗口（`max-width: 1279px`）开关退成两行两列。
3. 右卡**保存按钮合并成一个**：`save()` 一次写 `syncIntervalMinutes` / `sendCountdownSeconds` / `sidebarScale` 并设 `--nav-scale`，未改动时禁用；原 `saveScale()` 已删。
4. 「外观」卡取消；「存档校验」「活动与诊断」从两列改为直接挂在 `.storage-tools` 下的**整行平铺**卡（顺序：存档校验 → 活动与诊断）；「存档校验」里「保留 N 天」下拉与「已归档 N 封 / 外置盘未连接」**同一行**（`.settings-tool-inline`），四个动作按钮仍靠右。
5. 「活动与诊断」**外层默认折叠**（折叠时五个小项一个都不渲染），卡头标题是折叠触发器；展开后「最近活动」折叠、其余四项默认展开（回到 0.1.5/0.1.6「高级与诊断」的形态），内容去掉左缩进与行头齐头。
6. 测试：`storage-tools.test.tsx` 16 例（「外层整体折叠 + 内层只有最近活动折叠」一例、三处 `aria-label` 改「侧栏字号」）；`App.test.tsx` 的诊断用例改成先点开外层、四项默认展开直接可见「异常目录暂停同步」。
7. 布局核对（截图不可用，`browser.evaluate` 量几何）：模拟默认窗口 1380 → 顶卡 571 / 439 等高 225px、四个开关同处一行（标签均单行）、三个下拉 + 保存同排；窄窗口（视口 1000）开关两行两列无溢出；「存档校验」下拉与文案间距 8px 同排；「活动与诊断」默认无 `.diagnostics-body`，展开后 5 行、四行内容左缘与宽度一致（均 341 / 600px，量测时标签页在前台）。

## 三、用户已验收、不得回退的功能

阅读窗图片选择/复制/自定义菜单、附件多选、写信附件条、Finder ⌘C→⌘V 粘贴为附件、收件箱 ⌘ 多选、写信红框、收件人区紧凑、写信工具栏单行（`COMPOSE_NARROW_WIDTH = 1080`）、三灯图标、点窗口外自动最小化、最小化保留最大化、多封信互不覆盖、标题栏拖动不漂移、列表头部刷新按钮组与账号下拉、写信关闭确认三按钮（取消/不保存/保存）、阅读窗与写信窗为真正的系统窗口（可拖出主窗、独立三灯与 ⌘W）、「继续写信」与「查看邮件」悬浮入口、主窗铺满状态跨重启（自定义尺寸仍记住）。

产品约束：中文界面；正文仿宋 14pt；自带问候语/签名/全角空格首行缩进；存储与钥匙串标识 `dev.maildesk.desktop` 不能改。

（本轮设置页重排**尚未验收**：第一版已装机给用户看过并收到三条反馈，已按反馈改完（外层折叠 / 紧凑排布 / 封数并进下拉行 / 字号改名），**等再次验收**。）

## 四、常用命令

```bash
# 开发预览（优先复用已运行实例）
cd /Users/wanghlstar/Mytools/anser && npm run desktop      # dev server: http://localhost:1420
lsof -ti:1420                                              # 看 dev server 是否还活着（本轮起过 PID 73584）

# 门禁（每轮必跑）
npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}" && npm run check:ui && npx vitest run
# 另有 npm run format:check（还覆盖 scripts/workflows/package.json/src-tauri json，不含 docs）
# Rust：cargo test --manifest-path src-tauri/Cargo.toml

# 发布（真正构建只在 GitHub Actions 上跑：本机没有 gh，也没有 updater 私钥）
npm run release:check                                        # 版本四处一致 + docs/releases/v版本.md 非空
git push origin feat/port-upstream-a                         # 先推代码
git tag -a v0.2.1 -m "雁信 0.2.1" && git push origin v0.2.1   # 触发 release.yml（Alpha 预发布草稿）
# 或在 GitHub 网页里 Run workflow；随后核对草稿里的 DMG/app.tar.gz/sig/latest.json 再手动发布
```

装机包（用户要真机验收时才做，约 5 分钟）：

```bash
cd /Users/wanghlstar/Mytools/anser
touch src-tauri/src/lib.rs          # 强制重新嵌入前端产物
set -a && . ./.env.local && set +a
APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" npx tauri build \
  --config '{"plugins":{"updater":{"createUpdaterArtifacts":false}}}' --bundles app
# 结尾「A public key has been found, but no private key」是已知无害报错

osascript -e 'quit app "雁信"'; sleep 2; pkill -f "雁信.app/Contents/MacOS/yanxin"
rm -rf /Applications/雁信.app
cp -R src-tauri/target/release/bundle/macos/雁信.app /Applications/雁信.app
open /Applications/雁信.app        # 报 PID
```

真机鼠标/辅助功能验证（仓库外的探针，见第五节）：

```bash
cd /private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode
osascript -e 'tell application "System Events" to set frontmost of process "yanxin" to true'
swift ax.swift click 118 165      # 侧边栏「写邮件」（中心点）
swift ax.swift drag 575 192 675 272
swift ax.swift dblclick 575 192
swift ax.swift dump 9 | grep "AXGroup t=写邮件"
```

装机版几何（主窗 1470×876，屏幕坐标）：原生写信窗默认 980×720、原生阅读窗默认 760×640，都从主窗口阶梯错开；侧边栏「写邮件」按钮 `pos=24,148 size=188x34`；「继续写信」还原条首次在 `714,857 size 95x32`（中心约 `761,873`），每多一条（写信窗或阅读窗）向上错开 52px；被最小化的写信窗在 AX 里表现为 `AXGroup t=写邮件 pos=0,38 size=1470x10`。

设置页几何核对（截图不可用时的替代办法）：`browser.evaluate` 里量 `.storage-tools-top > *` 的 `getBoundingClientRect()`（两卡宽度比 1.3:1、等高）、`.settings-tool-switches > *`（四组的 `top` 是否同一行、`label` 的 `height` 是 14 还是 28）、`.settings-tool-selects` 与保存按钮是否同排、`.diagnostics-card` 里有无 `.diagnostics-body`，以及展开后各行 `[data-slot=collapsible]` 的 `data-state`（最近活动 closed、其余 open）。

## 五、踩过的雷（详见 RULES_PORT_UPSTREAM.md 关键发现 1–52）

- **WKWebView 的 `pointermove`/`mousemove` `event.buttons` 恒为 0**（实测 131 次移动全为 0）：手势收尾必须靠 `pointerup`/`pointercancel`/`mouseup`/`blur`，不能用 `buttons` 判断。
- **合成 `new PointerEvent(..., { buttons: 1 })` 会假通过**，jsdom 与 Chromium 都掩盖过真机 bug；真机核对要用 CGEvent + AX 读回几何，或用真 WKWebView 加载 dev server 跑真代码（见 `wkverify.*`）。
- **只验证源码会假绿：生产构建的 CSS 不是源码逐字复制**。lightningcss 会把 `translate: none` 降级合并进同规则后面的 `transform: none` 里丢掉。**改完必须 grep `dist/assets/index-*.css`**。
- 浮动窗口定位**不要用 `translate`**：用 `left/right + margin:auto`，并把 `DialogContent` 自带的 `translate-x/y-[-50%]` 从**类名**顶掉（`translate-x-0 translate-y-0`）。配合 `transform: none !important` 后 `getBoundingClientRect()` 恒等于布局盒。（现在只剩演示模式的内嵌写信窗还走这套。）
- 写信窗里的 Select/Popover/Dialog 是 portal 挂在 `body`；演示模式「点窗口外自动最小化」的判定必须把写信窗派生 UI 全认下来（`[role=dialog/alertdialog/listbox/menu/tooltip]`、`.rich-image-zoom`、`[data-sonner-toast]`、`.compose-restore-bar`），否则会误收。
- **复用浮动外壳改尺寸时：`width/max-width` 要 `!important`，`height/max-height` 绝不能加**（否则 0,1,0 会反杀掉 `.compose-dialog.compose-expanded` 的 0,2,0 高度 → 「最大化后尺寸纹丝不动」）。
- **浏览器探针要先 `tools.browser.tabs.focus({tabID})` 把标签页切到前台**：后台标签页里 CSS transition 被挂起，`getBoundingClientRect()` 会长期停在上一个状态的中间值（本机实测 640×428 vs 切前台后的 755×586）。另：本机 `browser.screenshot` 恒报 “Screenshot needs a visible tab”，只能量坐标。
- **⌘W 在 macOS 上被原生菜单吃掉**，前端收不到 keydown；不要改默认菜单（会连累 ⌘C/⌘V），走 Rust 拦 `CloseRequested`。
- **`tauri.conf.json` 的 `app.security.capabilities` 是白名单**：新增 `capabilities/*.json` 必须登记进去，否则该 capability 形同不存在（阅读窗/写信窗的 listen 一直失效、写信拖拽附件不可用就是这个）。release 只报 `Command <cmd> not allowed by ACL`，`allowed-on` 明细要 debug 构建才看得到；该文件里曾有重复的 `capabilities` 键，改完要数一下出现次数。
- **跨窗事件要按方向拆名**：JS `listen` 不带 options 时 target 是 Any，会收到任何 `emit_to` 的事件，同名事件跨窗回环（实测 1 分钟 trace 破百万行、主线程占死）。
- **建原生窗口时不要调原生淡入**：那一刻 runloop 未就绪，动画不生效会让窗口停在 alpha=0（表现为「窗口找不到」）。
- **macOS 拖到顶部填充/平铺不置 `NSWindow.isZoomed`**：窗口状态插件因此存下 `maximized:false` + 旧像素尺寸，重启就「占不满」。解法是持久化「铺满意图」（`Preferences.window_fill`）并在启动时按当前 `monitor.work_area()` 重填；判定与重填都要 `run_on_main_thread` 等插件的异步还原落地，矩形判定留 5% 容差兜住首次启动。
- **原生阅读窗的悬浮入口**：`mail_windows` 登记表存 `{id, subject}` 快照，只向 `main` 发 `mail-windows-changed`；`focus_mail_window` 走 `unminimize` + `set_focus`；浮条复用 `.compose-restore-bar`，与「继续写信」共用一条堆叠。
- **设置页两卡「逐行对齐」不能留 `space-between`**（第 50 条）；但「逐行对齐」与「紧凑」互斥，用户最终要紧凑：四个开关横排要按**自然宽度之和**（444px）算够不够，等分网格会把标签折成两行、而 `label` 的 `height` 14→28 才是判据（盒子不溢出、`scrollWidth` 查不出来），详见第 51 条。
- **量几何前先把标签页切到前台**（`tools.browser.tabs.focus`），后台标签页里 transition 被挂起会量到上一状态的中间值；另外在 `browser.evaluate` 里点 Radix 触发器（如「活动与诊断」标题）时，`el.click()` 出现过点了没反应，改用 `el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))` 就正常，且要在**下一次** evaluate 里量状态（React 更新是异步的）。
- 三灯按钮的 AX 几何是乱码（如 `pos=-699,-314 size=737x424`），只能用 CSS 算坐标点；原生窗口的标题栏按钮不在可测范围。
- `WKWebView.callAsyncJavaScript(_:arguments:in:in:)` 有两个 `in:` 标签，需 `in: nil, in: .page`；`evaluateJavaScript` 不能返回 Promise。
- 演示模式持久化在 localStorage `mail-desktop-demo-v1`（点「先体验」进入，别点两次）；浏览器里它可能被前面的会话清掉，需要重进一次。
- **环境坑**：macOS 会话/显示器睡眠期间 AX 与 CGEvent 全部失效；视觉/Retina 效果只能由用户在装机版上人工看。

探针目录（仓库外，可重建）：`/private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode/`
`ax.swift`（`click` / `drag` / `dblclick` / `dump [depth]` / `press`）、`wins.swift`、`wkverify.swift` + `wkverify.js`（真 WKWebView 跑 dev server 上的真前端代码）、`wkbuttons.*`。

## 六、待办与下一步

1. ~~先定本轮设置页重排的去向~~ **已完成**：用户验收通过；已按中文 `feat:`/`docs:` 拆为两笔提交（`6afe0d1` 源码 + `689d183` 文档），回滚点 tag `checkpoint-2026-10-19-settings-compact` 仍在 `0672f93`。**A 线（本地界面）本轮暂不修改**，直接进第 2 条上游移植。
2. **上游移植（评估已完成，等用户定取舍）**：读 `docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`。建议批次：0 收尾本轮设置页重排 → 1 纯新增（Dock 未读角标、TaskPanelHeader 组件）→ 2 设置五分类导航（`settings-layout.tsx` + App.tsx 重组 + 后台任务五卡）→ 3 规则条件与首次匹配状态快照 → 4 解析迁移（cc/优先级头块回填）→ 5 邮件工作流对齐（取消恢复编辑、排序待定）→ 6 未读口径（若用户要）→ 7 双语翻译（若用户要）。评估文档第八节有 4 个必须用户先定的取舍。
3. **0.2.0 发布收尾**：核实 Actions 两架构构建与草稿 Release（DMG / app.tar.gz / sig / latest.json），再手动发布草稿；确认 `releases/latest` 仍指向 0.1.9。
4. 已记录但暂缓（见 `RULES_PORT_UPSTREAM.md` 末尾）：通知横幅优先级与可靠性；阅读器图片自定义菜单与左键选中（需原生 `WKUIDelegate`）；服务器删除永久阻塞时待删邮件一直隐藏；更新说明 Markdown 渲染（现为纯文本）；全局网络代理。
5. 新反馈优先：下一批迭代点等用户提出。
