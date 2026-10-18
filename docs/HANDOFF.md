# 会话交接（2026-10-18）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接整段复制给助手）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a，快照 tag checkpoint-2026-10-18-compose-window。

开工先做四件事，然后向我确认要迭代什么：
1. 读 AGENTS.md（项目长期约定：UI 铁律、真实收发范围、上游 cherry-pick 策略）与 docs/HANDOFF.md（交给你的这份）。
2. 读 docs/IMPLEMENTATION.md 最后两节 + docs/RULES_PORT_UPSTREAM.md 的关键发现 24–26（写信窗口这块已经踩过的雷）。
3. 跑 git status / git log --oneline -6 / git tag -l | tail，确认工作树干净、分支与快照 tag 对得上。
4. 需要跑起来看效果时优先 npm run desktop 复用已运行的开发预览（dev server http://localhost:1420），不要为了看一眼就重装应用包。

背景：上一轮把写信窗口做成了 Foxmail 式（标题栏拖动、四角缩放、双击/绿灯最大化、黄灯最小化、与收件箱互不阻塞、可同时开多封），并把上游的附件系统与富文本写信移植进来；装机版已人工验收通过，代码已提交并打了临时 tag。接下来继续迭代（写信体验、附件、富文本、通知、上游同步……具体优先级等我的新反馈）。

铁律（必须遵守）：
- 中文界面；业务界面只用 shadcn/ui 组件，改 UI 后跑 npm run check:ui；不得回退已验收功能。
- 每轮同步 docs/IMPLEMENTATION.md（末尾追加带日期小节）与 docs/RULES_PORT_UPSTREAM.md（编号「关键发现」，现 26 条）。
- 改动先给我人工验收，我确认后再提交；提交信息用中文 feat:/fix: 风格，对应实际完成范围。
- 验证要在「构建产物」和真机上做：合成 PointerEvent 会假通过，WKWebView 里 event.buttons 恒为 0；CSS 改动要 grep dist/assets/index-*.css 确认没有在生产构建里被吃掉。
```

## 二、当前基线

- 仓库 `/Users/wanghlstar/Mytools/anser`，分支 `feat/port-upstream-a`（未推送到 origin，除用户要求外不要 push）。
- 快照 tag：`checkpoint-2026-10-18-compose-window`（此前还有 `checkpoint-2026-10-17-port-upstream-a`、`baseline-2026-10-16`；`v0.1.x` 是发布 tag）。
- 门禁基线：`npx tsc --noEmit`、`npx prettier --check "src/**/*.{ts,tsx,css}"`、`npm run check:ui`、`npx vitest run` = **51 文件 / 414 用例**全绿。

本次快照（2026-10-18 这一轮会话，5 段反馈）包含：

1. **写信窗口 Foxmail 化**：标题栏可拖动、四角/边缩放、双击标题栏或绿灯最大化、黄灯最小化、与收件箱互不阻塞；`App.tsx` 的单个 `draft` 改成 `composes: Compose[]`（`openCompose`/`closeCompose`，渲染 `composes.map(... <ComposeDialog key={item.id} stackIndex={index}>)`），支持同时开多封；多封的「继续写信」还原条用 `--compose-bar-lift`（`stackIndex * 52px`）向上错开。
2. **三灯**：改成 macOS 风格内联 SVG（关闭 ×、最小化 —、最大化/还原 ⤢，随 `expanded` 切换路径）；最小化后再「继续写信」保持最大化状态。
3. **修「点标题栏漂移半个身位」**：居中不再用 `translate`（否则 shadcn `DialogContent` 自带的 `translate-x/y-[-50%]` 会把窗口推走半格）。改 `left/right + margin:auto`（垂直 `top/bottom + margin-block:auto`），基础规则加 `transform: none !important` 关掉入场 `zoom-in-95` 缩放，`measureGeometry` 回到 `getBoundingClientRect()`。
4. **修「点写信窗自己的浮层误触最小化」**：自动最小化的白名单补上 `.rich-image-zoom`、`[data-sonner-toast]`、`.compose-restore-bar`、`[role="tooltip"]`。
5. **附件系统移植**（上游 v0.1.19）：写信附件条、多选、Finder ⌘C→⌘V 粘贴为附件、正文图片、草稿自有附件副本（`src-tauri/src/compose_files.rs`、`src/components/compose-attachments.tsx`、`src/lib/compose-attachments.ts`、`src/lib/mail-html.ts` 等）。

## 三、用户已验收、不得回退的功能

阅读窗图片选择/复制/自定义菜单、附件多选、写信附件条、Finder ⌘C→⌘V 粘贴为附件、收件箱 ⌘ 多选、写信红框、收件人区紧凑、写信工具栏单行（`COMPOSE_NARROW_WIDTH = 1080`）、三灯图标、点窗口外自动最小化、最小化保留最大化、多封信互不覆盖、标题栏拖动不漂移。

产品约束：中文界面；正文仿宋 14pt；自带问候语/签名/全角空格首行缩进；存储与钥匙串标识 `dev.maildesk.desktop` 不能改。

## 四、常用命令

```bash
# 开发预览（优先复用已运行实例）
cd /Users/wanghlstar/Mytools/anser && npm run desktop      # dev server: http://localhost:1420

# 门禁（每轮必跑）
npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}" && npm run check:ui && npx vitest run
# 另有 npm run format:check（还覆盖 scripts/workflows/package.json/src-tauri json，不含 docs）
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

装机版几何（主窗 1470×876，屏幕坐标）：写信窗默认 `175,174 / 1120×636`；最大化 `12,82 / 1446×820`；侧边栏「写邮件」按钮 `pos=24,148 size=188x34`；写信标题栏可点区域 y≈192；「继续写信」还原条首次在 `714,857 size 95x32`（中心约 `761,873`），每多一条向上错开 52px；被最小化的写信窗在 AX 里表现为 `AXGroup t=写邮件 pos=0,38 size=1470x10`。

## 五、踩过的雷（详见 RULES_PORT_UPSTREAM.md 关键发现 1–26）

- **WKWebView 的 `pointermove`/`mousemove` `event.buttons` 恒为 0**（实测 131 次移动全为 0）：手势收尾必须靠 `pointerup`/`pointercancel`/`mouseup`/`blur`，不能用 `buttons` 判断。
- **合成 `new PointerEvent(..., { buttons: 1 })` 会假通过**，jsdom 与 Chromium 都掩盖过真机 bug；真机核对要用 CGEvent + AX 读回几何，或用真 WKWebView 加载 dev server 跑真代码（见 `wkverify.*`）。
- **只验证源码会假绿：生产构建的 CSS 不是源码逐字复制**。lightningcss 会把 `translate: none` 降级合并进同规则后面的 `transform: none` 里丢掉 → 装机后点一下标题栏窗口偏半个身位。**改完必须 grep `dist/assets/index-*.css`**。
- 写信窗定位**不要用 `translate`**：用 `left/right + margin:auto`，并把 `DialogContent` 自带的 `translate-x/y-[-50%]` 从**类名**顶掉（`translate-x-0 translate-y-0`）。配合 `transform: none !important`（关掉入场缩放）后 `getBoundingClientRect()` 恒等于布局盒。
- 写信窗里的 Select/Popover/Dialog 是 React portal 挂在 `body`（在 `.compose-dialog` 之外）；「点窗口外自动最小化」的判定必须把写信窗派生 UI 全认下来（图片缩放浮条 / sonner 通知 / 提示气泡 / 另一封的还原条），否则会误收。
- 三灯按钮的 AX 几何是乱码（如 `pos=-699,-314 size=737x424`），只能用 CSS 算坐标点。
- `WKWebView.callAsyncJavaScript(_:arguments:in:in:)` 有两个 `in:` 标签，需 `in: nil, in: .page`；`evaluateJavaScript` 不能返回 Promise。
- 演示模式持久化在 localStorage `mail-desktop-demo-v1`（点「先体验」进入，别点两次）。
- **环境坑**：macOS 会话/显示器睡眠期间 AX 与 CGEvent 全部失效（`screencapture -x` 只拍到桌面壁纸、AX 树自引用十几层）；此时从终端直接跑 `/Applications/雁信.app/Contents/MacOS/yanxin` 可「唤醒」会话。本机截图不可用，视觉/Retina 效果只能由用户在装机版上人工看。

探针目录（仓库外，可重建）：`/private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode/`
`ax.swift`（`click` / `drag` / `dblclick` / `dump [depth]` / `press`）、`wins.swift`、`wkverify.swift` + `wkverify.js`（真 WKWebView 跑 dev server 上的真前端代码）、`wkbuttons.*`。

## 六、待办与下一步

1. 用户在装机版上手动点一次**图片缩放浮条**（正文插图后出现的 `− % +`），确认不再把写信窗收起来。它与「继续写信」还原条走同一条 `closest()` 判定，自动化测试与装机版已验证该判定，但这个具体元素还没人工点过。
2. **核对并更新 `AGENTS.md` 的「上游基线 / 未移植」清单**：该清单已过期（写的是「0.1.12 的完整富文本写信未移植」，而 `c8b3b38 feat: 移植上游富文本写信编辑器（前端）` 已落地；0.1.19 附件系统已进本次快照）。更新前先与实际代码对一遍。
3. 已记录但暂缓（见 `RULES_PORT_UPSTREAM.md` 末尾）：通知横幅优先级与可靠性；阅读器图片自定义菜单与左键选中（需原生 `WKUIDelegate`，独立高风险项）；服务器删除被永久阻塞时待删邮件一直隐藏（考虑加「阻塞时重新露出」兜底）；更新说明 Markdown 渲染；全局网络代理（暂不做）。
4. 新反馈优先：下一批迭代点等用户提出。
