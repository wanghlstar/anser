# 会话交接（2026-10-18，第二轮：列表刷新/关闭确认/浮动阅读窗）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接整段复制给助手）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a，最近快照 tag checkpoint-2026-10-18-compose-window。

开工先做四件事，然后向我确认要迭代什么：
1. 读 AGENTS.md（项目长期约定：UI 铁律、真实收发范围、上游 cherry-pick 策略）与 docs/HANDOFF.md（交给你的这份）。
2. 读 docs/IMPLEMENTATION.md 最后三节 + docs/RULES_PORT_UPSTREAM.md 的关键发现 27–36（写信窗口关闭确认/⌘W、列表头部、浮动阅读窗这几块刚踩过的雷）。
3. 跑 git status / git log --oneline -6 / git tag -l | tail，确认工作树状态、分支与快照 tag 对得上。
4. 需要跑起来看效果时优先 npm run desktop 复用已运行的开发预览（dev server http://localhost:1420），不要为了看一眼就重装应用包。

背景：上一轮把写信窗口做成了 Foxmail 式（标题栏拖动、四角缩放、双击/绿灯最大化、黄灯最小化、与收件箱互不阻塞、可同时开多封），并移植了上游附件系统与富文本写信。本轮（第六轮反馈）做完了三件：①列表头部刷新右移 + 按账号收取下拉 ②写信窗口关闭前问「保存/不保存/取消」并支持 ⌘W 只关写信窗 ③收件列表双击/右键弹出可拖动、八角缩放、不置顶的浮动阅读窗。代码与文档已完成、门禁全绿，但**尚未提交、尚未装机验收**。

铁律（必须遵守）：
- 中文界面；业务界面只用 shadcn/ui 组件，改 UI 后跑 npm run check:ui；不得回退已验收功能。
- 每轮同步 docs/IMPLEMENTATION.md（末尾追加带日期小节）与 docs/RULES_PORT_UPSTREAM.md（编号「关键发现」，现 36 条）。
- 改动先给我人工验收，我确认后再提交；提交信息用中文 feat:/fix: 风格，对应实际完成范围。
- 验证要在「构建产物」和真机上做：合成 PointerEvent 会假通过，WKWebView 里 event.buttons 恒为 0；CSS 改动要 grep dist/assets/index-*.css 确认没有在生产构建里被吃掉。
```

## 二、当前基线

- 仓库 `/Users/wanghlstar/Mytools/anser`，分支 `feat/port-upstream-a`（未推送到 origin，除用户要求外不要 push）。
- 发布：**0.1.9**（发布提交 `9e1e8e0`，注解 tag `v0.1.9`，说明 `docs/releases/v0.1.9.md`）；上一版 0.1.8。本轮开始**不打正式 tag**，阶段性临时 tag。
- 快照 tag：`checkpoint-2026-10-18-compose-window`（上一轮写信窗 Foxmail 化 + 附件/富文本移植那次）；更早 `checkpoint-2026-10-17-port-upstream-a`、`baseline-2026-10-16`。**本轮还没有新 tag**。
- 上一轮提交：`b6783f0 feat: 写信窗口 Foxmail 化与附件系统移植（临时快照）`。
- 本轮改动（**未提交**）：`src/App.tsx`、`src/App.test.tsx`、`src/components/mail-window.tsx`（新增）、`src/components/mail-window.test.tsx`（新增）、`src/components/compose-dialog.tsx`、`src/components/compose-dialog.test.tsx`、`src/components/ui/button-group.tsx`（新增）、`src/index.css`、`src-tauri/src/lib.rs`、`docs/IMPLEMENTATION.md`、`docs/RULES_PORT_UPSTREAM.md`。
- 门禁基线（本轮，全绿）：`npx tsc --noEmit`、`npx prettier --check "src/**/*.{ts,tsx,css}"`、`npm run check:ui`、`npx vitest run` = **52 文件 / 430 用例**、`cargo test --manifest-path src-tauri/Cargo.toml` = **340 passed / 1 ignored**、`npm run build` 成功。

本轮三个改动（细节见 IMPLEMENTATION.md 末尾三节）：

1. **列表头部：刷新右移 + 按账号收取**：真因是 `src/index.css` 的 `.list-heading > div { flex:1; overflow:hidden }` 同时命中标题组与动作组；改为 `> div:first-child` 并给 `.list-heading-actions` 加 `flex:none`。头部改成 shadcn `ButtonGroup`（新增 `src/components/ui/button-group.tsx`，取自官方 new-york registry）：左侧「收取全部账号」+ 右侧账号下拉（全部账号 / 每个启用账号）。`sync(accountId?)` → `sync_mail(id?)` → `collect_mail(only)`。
2. **写信窗口关闭确认 + ⌘W**：红点 ×、⌘W、Esc 走同一个三按钮 `AlertDialog`（取消 / 不保存 / 保存）；空白邮件直接舍弃。macOS 上 ⌘W 是原生菜单加速键，前端收不到 keydown，所以由 Rust 拦 `CloseRequested`（`AppState.compose_open` + 命令 `set_compose_open` + 事件 `compose-close-requested`）转交前端。
3. **浮动阅读窗口**：新增 `src/components/mail-window.tsx`，列表双击或右键「在新窗口打开」弹出；窗口外壳**复用写信窗口那套类名与 `--compose-*` 几何变量**（`.compose-dialog/.compose-expanded/.compose-floating/.compose-minimized/.compose-resize-handle/.compose-light*/.compose-restore-bar`），只多一个 `.mail-window` 覆盖默认尺寸与内部排版。可拖动、八角缩放、三灯（关闭/最小化/最大化）、可同时多开（`stackIndex>0` 阶梯错开 +28/+20px）、**点窗口外不自动收起**、只读（回复/全部回复/转发/导出原始邮件 + 附件下载 + 正文图片缩放与链接）。

## 三、用户已验收、不得回退的功能

阅读窗图片选择/复制/自定义菜单、附件多选、写信附件条、Finder ⌘C→⌘V 粘贴为附件、收件箱 ⌘ 多选、写信红框、收件人区紧凑、写信工具栏单行（`COMPOSE_NARROW_WIDTH = 1080`）、三灯图标、点窗口外自动最小化、最小化保留最大化、多封信互不覆盖、标题栏拖动不漂移、列表头部刷新与账号下拉、关闭确认三按钮。

产品约束：中文界面；正文仿宋 14pt；自带问候语/签名/全角空格首行缩进；存储与钥匙串标识 `dev.maildesk.desktop` 不能改。

## 四、常用命令

```bash
# 开发预览（优先复用已运行实例）
cd /Users/wanghlstar/Mytools/anser && npm run desktop      # dev server: http://localhost:1420

# 门禁（每轮必跑）
npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}" && npm run check:ui && npx vitest run
# 另有 npm run format:check（还覆盖 scripts/workflows/package.json/src-tauri json，不含 docs）
# Rust：cargo test --manifest-path src-tauri/Cargo.toml
```

装机包（用户要真机验收时才做，约 5 分钟）：

```bash
cd /Users/wanghlstar/Mytools/anser
touch src-tauri/src/lib.rs          # 强制重新嵌入前端产物
set -a && . ./.env.local && set +a
APPLE_SIGNING_IDENTITY="Yanxin Local Code Signing" npx tauri build \
  --config '{"plugins":{"updater":{"createUpdaterArtifacts":false}}}' --bundles app
# 结尾「A public key has been found, but no private key」是已知无害报错

pkill -f "/Applications/雁信.app/Contents/MacOS/yanxin"; sleep 1.5
rm -rf /Applications/雁信.app
cp -R src-tauri/target/release/bundle/macos/雁信.app /Applications/雁信.app
open /Applications/雁信.app
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

装机版几何（主窗 1470×876，屏幕坐标）：写信窗默认 `175,174 / 1120×636`；最大化 `12,82 / 1446×820`；侧边栏「写邮件」按钮 `pos=24,148 size=188x34`；写信标题栏可点区域 y≈192；「继续写信」还原条首次在 `714,857 size 95x32`（中心约 `761,873`），每多一条向上错开 52px；被最小化的写信窗在 AX 里表现为 `AXGroup t=写邮件 pos=0,38 size=1470x10`。浮动阅读窗（`.mail-window`）默认 `clamp(640px, 100vw-360px, 980px)` × `clamp(420px, 100dvh-标题栏-240px, 720px)`，最大化与写信窗同规则。

## 五、踩过的雷（详见 RULES_PORT_UPSTREAM.md 关键发现 1–36）

- **WKWebView 的 `pointermove`/`mousemove` `event.buttons` 恒为 0**（实测 131 次移动全为 0）：手势收尾必须靠 `pointerup`/`pointercancel`/`mouseup`/`blur`，不能用 `buttons` 判断。
- **合成 `new PointerEvent(..., { buttons: 1 })` 会假通过**，jsdom 与 Chromium 都掩盖过真机 bug；真机核对要用 CGEvent + AX 读回几何，或用真 WKWebView 加载 dev server 跑真代码（见 `wkverify.*`）。
- **只验证源码会假绿：生产构建的 CSS 不是源码逐字复制**。lightningcss 会把 `translate: none` 降级合并进同规则后面的 `transform: none` 里丢掉。**改完必须 grep `dist/assets/index-*.css`**。
- 浮动窗口定位**不要用 `translate`**：用 `left/right + margin:auto`，并把 `DialogContent` 自带的 `translate-x/y-[-50%]` 从**类名**顶掉（`translate-x-0 translate-y-0`）。配合 `transform: none !important` 后 `getBoundingClientRect()` 恒等于布局盒。
- 写信窗里的 Select/Popover/Dialog 是 portal 挂在 `body`；「点窗口外自动最小化」的判定必须把写信窗派生 UI 全认下来（`[role=dialog/alertdialog/listbox/menu/tooltip]`、`.rich-image-zoom`、`[data-sonner-toast]`、`.compose-restore-bar`），否则会误收。
- **复用浮动外壳改尺寸时：`width/max-width` 要 `!important`，`height/max-height` 绝不能加**（否则 0,1,0 会反杀掉 `.compose-dialog.compose-expanded` 的 0,2,0 高度 → 「最大化后尺寸纹丝不动」）。
- **浏览器探针要先 `tools.browser.tabs.focus({tabID})` 把标签页切到前台**：后台标签页里 CSS transition 被挂起，`getBoundingClientRect()` 会长期停在上一个状态的中间值（本机实测 640×428 vs 切前台后的 755×586）。
- **⌘W 在 macOS 上被原生菜单吃掉**，前端收不到 keydown；不要改默认菜单（会连累 ⌘C/⌘V），走 Rust 拦 `CloseRequested`。
- **多封非模态 Dialog 之间没有 Esc 仲裁**：Esc 归写信窗（草稿确认），浮动阅读窗的 `onEscapeKeyDown` 直接 `preventDefault()`。
- 三灯按钮的 AX 几何是乱码（如 `pos=-699,-314 size=737x424`），只能用 CSS 算坐标点。
- `WKWebView.callAsyncJavaScript(_:arguments:in:in:)` 有两个 `in:` 标签，需 `in: nil, in: .page`；`evaluateJavaScript` 不能返回 Promise。
- 演示模式持久化在 localStorage `mail-desktop-demo-v1`（点「先体验」进入，别点两次）；浏览器里它可能被前面的会话清掉，需要重进一次。
- **环境坑**：macOS 会话/显示器睡眠期间 AX 与 CGEvent 全部失效；本机截图不可用（`browser.screenshot` 报 "Screenshot needs a visible tab"），视觉/Retina 效果只能由用户在装机版上人工看。

探针目录（仓库外，可重建）：`/private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode/`
`ax.swift`（`click` / `drag` / `dblclick` / `dump [depth]` / `press`）、`wins.swift`、`wkverify.swift` + `wkverify.js`（真 WKWebView 跑 dev server 上的真前端代码）、`wkbuttons.*`。

## 六、待办与下一步

1. **装机验收本轮三项**（浏览器测不了的部分）：⌘W 是否只关写信窗（三按钮弹窗）、关闭确认三按钮在真 WKWebView 里的表现、浮动阅读窗的拖动/八角缩放/不置顶/多开。
2. 用户确认后再提交（中文 `feat:` 提交信息，按实际范围），并打一个阶段性临时 tag。
3. **核对并更新 `AGENTS.md` 的「上游基线 / 未移植」清单**：该清单已过期（写的是「0.1.12 的完整富文本写信未移植」，实际 `c8b3b38` 已落地；0.1.19 附件系统也已进 `checkpoint-2026-10-18-compose-window`）。更新前先与实际代码对一遍。
4. 已记录但暂缓（见 `RULES_PORT_UPSTREAM.md` 末尾）：通知横幅优先级与可靠性；阅读器图片自定义菜单与左键选中（需原生 `WKUIDelegate`，独立高风险项）；服务器删除被永久阻塞时待删邮件一直隐藏（考虑加「阻塞时重新露出」兜底）；更新说明 Markdown 渲染；全局网络代理（暂不做）。
5. 浮动阅读窗可能的后续（等用户反馈再定）：Esc 关闭、星标/删除等写操作、列表里刷新后窗口内容跟随更新、与写信窗的层级/焦点顺序。
6. 新反馈优先：下一批迭代点等用户提出。
