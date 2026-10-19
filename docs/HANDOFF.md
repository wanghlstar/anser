# 会话交接（2026-10-18，第三轮：0.2.0 发布准备）

> 本文件供新会话/新助手快速接手，**每次交接时整体重写**，只保留当前有效信息。
> 长期约定在 `AGENTS.md`，进度记录在 `docs/IMPLEMENTATION.md`，踩过的坑在 `docs/RULES_PORT_UPSTREAM.md`。

## 一、给新会话的引导语（可直接整段复制给助手）

```text
项目：雁信 / Anser（Tauri 2 + React/TypeScript + shadcn/ui + Rust + SQLite）。
仓库 /Users/wanghlstar/Mytools/anser，分支 feat/port-upstream-a，最近发布 tag v0.2.0（Alpha 预发布），最近快照 tag checkpoint-2026-10-18-compose-window。

开工先做四件事，然后向我确认要迭代什么：
1. 读 AGENTS.md（项目长期约定：UI 铁律、真实收发范围、上游 cherry-pick 策略）与 docs/HANDOFF.md（交给你的这份）。
2. 读 docs/IMPLEMENTATION.md 最后三节 + docs/RULES_PORT_UPSTREAM.md 的关键发现 37–49（原生阅读窗/写信窗、ACL 白名单、跨窗事件、主窗铺满这几块刚踩过的雷）。
3. 跑 git status / git log --oneline -6 / git tag -l | tail，确认工作树状态、分支与快照 tag 对得上。
4. 需要跑起来看效果时优先 npm run desktop 复用已运行的开发预览（dev server http://localhost:1420），不要为了看一眼就重装应用包。

背景：0.1.9 之后做了四件：①列表头部刷新改按钮组、可按账号收取 ②阅读窗改为 Tauri 原生独立窗口 ③写信窗改为 Tauri 原生独立窗口 + 「继续写信」悬浮入口 ④主窗「铺满」状态跨重启（Dock/屏幕变化后不再「占不满」）+ 阅读窗「查看邮件」悬浮入口。全部已验收并提交，0.2.0 已写好发布说明、版本号与发布流水线（走 Alpha 预发布通道）。

铁律（必须遵守）：
- 中文界面；业务界面只用 shadcn/ui 组件，改 UI 后跑 npm run check:ui；不得回退已验收功能。
- 每轮同步 docs/IMPLEMENTATION.md（末尾追加带日期小节）与 docs/RULES_PORT_UPSTREAM.md（编号「关键发现」，现 49 条）。
- 改动先给我人工验收，我确认后再提交；提交信息用中文 feat:/fix: 风格，对应实际完成范围。
- 验证要在「构建产物」和真机上做：合成 PointerEvent 会假通过，WKWebView 里 event.buttons 恒为 0；CSS 改动要 grep dist/assets/index-*.css 确认没有在生产构建里被吃掉。
```

## 二、当前基线

- 仓库 `/Users/wanghlstar/Mytools/anser`，分支 `feat/port-upstream-a`，已推送 `origin`（远程 tag 同步推）。
- 发布：**0.2.0（Alpha 预发布通道）**——注解 tag `v0.2.0`，说明 `docs/releases/v0.2.0.md`；`release.yml` 建 Release 时带 `--prerelease`，因此 GitHub 的 `releases/latest` 仍指向上一版正式版 **0.1.9**（发布提交 `9e1e8e0`，`docs/releases/v0.1.9.md`），已装用户不会被自动升级到 Alpha。
- 快照 tag：`checkpoint-2026-10-18-compose-window`（写信窗 Foxmail 化 + 附件/富文本移植那次）；更早 `checkpoint-2026-10-17-port-upstream-a`、`baseline-2026-10-16`。
- 0.1.9 → 0.2.0 的提交（时间序）：`80b42de` 列表按账号收取、写信关闭确认与 ⌘W、浮动阅读窗 → `3a2414c` 阅读窗改为原生独立窗口 → `8bce831` 写信窗改为原生独立窗口 → `233f529` 主窗铺满状态跨重启、阅读窗悬浮入口 → 本轮：Alpha 预发布通道 + 0.2.0 版本号与发布说明 + 交接文档同步。
- 门禁基线（0.2.0，全绿）：`npx tsc -b`、`npx prettier --check`（含 `.github/workflows/*.yml`、`package*.json`、`src-tauri/*.json`）、`npm run check:ui`、`npx vitest run` = **53 文件 / 430 用例**、`cargo test --manifest-path src-tauri/Cargo.toml` = **343 passed / 1 ignored**（共 344 例）、`npm run test:desktop` = 18、`npm run build`、`npm run release:check`（版本四处一致 + 发布说明非空）全部通过。

0.1.9 之后的四项改动（细节见 IMPLEMENTATION.md 对应小节）：

1. **列表与收取**：`sync_mail(id?)` 加可选账号，列表头部刷新改 shadcn `ButtonGroup` + `DropdownMenu`（全部账号 / 单账号），托盘仍收全部；修最窄宽度下标题被截断（`.list-heading > div:first-child` + `.list-heading-actions { flex: none }`）。
2. **阅读窗原生化**（`3a2414c`）：Rust `WebviewWindowBuilder` 建 `mail-window-N`（原生标题栏、标题=邮件主题、760×640、从主窗阶梯错开，同一封只开一扇）；新增 `src-tauri/capabilities/mail-window.json`；`main.tsx` 按 label 分流到 `src/components/mail-reader-window.tsx`；回复/转发/导出/保存附件一律 emitTo("main","mail-window-action") 交主窗；删除 `src/components/mail-window.tsx` 与 `.mail-window*` 样式（换成 `.mail-reader*`）。
3. **写信窗原生化**（`8bce831`）：`compose-window-N`（980×720、标题=草稿主题），自绘三灯/八角缩放剥离，「继续写信」悬浮入口 + `focus_compose_window`；`compose-window-close` / `compose-close-requested` 按方向拆名以免事件回环；`tauri.conf.json` 的 `app.security.capabilities` 从 `["main"]` 补成 `["main","mail-window","compose-window"]`（该字段是白名单，漏列会让 capability 文件失效）。
4. **铺满 + 悬浮入口**（`233f529`）：`Preferences.window_fill` 记「铺满意图」，启动时 `was_full || 矩形近乎铺满` 就按当前 `monitor.work_area()` 重填（判定与重填都在 `run_on_main_thread`）；`mail_windows` 登记表带 `subject` 快照 + `focus_mail_window` + `mail-windows-changed`（只发主窗），主窗按未聚焦阅读窗渲染「查看邮件」条，与「继续写信」共用同一条堆叠。

## 三、用户已验收、不得回退的功能

阅读窗图片选择/复制/自定义菜单、附件多选、写信附件条、Finder ⌘C→⌘V 粘贴为附件、收件箱 ⌘ 多选、写信红框、收件人区紧凑、写信工具栏单行（`COMPOSE_NARROW_WIDTH = 1080`）、三灯图标、点窗口外自动最小化、最小化保留最大化、多封信互不覆盖、标题栏拖动不漂移、列表头部刷新与账号下拉、关闭确认三按钮（取消/不保存/保存）、阅读窗与写信窗为真正的系统窗口（可拖出主窗、独立三灯与 ⌘W）、「继续写信」与「查看邮件」悬浮入口、主窗铺满状态跨重启（自定义尺寸仍记住）。

产品约束：中文界面；正文仿宋 14pt；自带问候语/签名/全角空格首行缩进；存储与钥匙串标识 `dev.maildesk.desktop` 不能改。

## 四、常用命令

```bash
# 开发预览（优先复用已运行实例）
cd /Users/wanghlstar/Mytools/anser && npm run desktop      # dev server: http://localhost:1420

# 门禁（每轮必跑）
npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}" && npm run check:ui && npx vitest run
# 另有 npm run format:check（还覆盖 scripts/workflows/package.json/src-tauri json，不含 docs）
# Rust：cargo test --manifest-path src-tauri/Cargo.toml

# 发布（真正构建只在 GitHub Actions 上跑：本机没有 gh，也没有 updater 私钥）
npm run release:check                                        # 版本四处一致 + docs/releases/v版本.md 非空
git push origin feat/port-upstream-a                         # 先推代码
git tag -a v0.2.0 -m "雁信 0.2.0" && git push origin v0.2.0   # 触发 release.yml（Alpha 预发布草稿）
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

装机版几何（主窗 1470×876，屏幕坐标）：原生写信窗默认 980×720、原生阅读窗默认 760×640，都从主窗口阶梯错开、拖动缩放最大化交系统；侧边栏「写邮件」按钮 `pos=24,148 size=188x34`；「继续写信」还原条首次在 `714,857 size 95x32`（中心约 `761,873`），每多一条（写信窗或阅读窗）向上错开 52px；被最小化的写信窗在 AX 里表现为 `AXGroup t=写邮件 pos=0,38 size=1470x10`。

## 五、踩过的雷（详见 RULES_PORT_UPSTREAM.md 关键发现 1–49）

- **WKWebView 的 `pointermove`/`mousemove` `event.buttons` 恒为 0**（实测 131 次移动全为 0）：手势收尾必须靠 `pointerup`/`pointercancel`/`mouseup`/`blur`，不能用 `buttons` 判断。
- **合成 `new PointerEvent(..., { buttons: 1 })` 会假通过**，jsdom 与 Chromium 都掩盖过真机 bug；真机核对要用 CGEvent + AX 读回几何，或用真 WKWebView 加载 dev server 跑真代码（见 `wkverify.*`）。
- **只验证源码会假绿：生产构建的 CSS 不是源码逐字复制**。lightningcss 会把 `translate: none` 降级合并进同规则后面的 `transform: none` 里丢掉。**改完必须 grep `dist/assets/index-*.css`**。
- 浮动窗口定位**不要用 `translate`**：用 `left/right + margin:auto`，并把 `DialogContent` 自带的 `translate-x/y-[-50%]` 从**类名**顶掉（`translate-x-0 translate-y-0`）。配合 `transform: none !important` 后 `getBoundingClientRect()` 恒等于布局盒。（现在只剩演示模式的内嵌写信窗还走这套。）
- 写信窗里的 Select/Popover/Dialog 是 portal 挂在 `body`；演示模式「点窗口外自动最小化」的判定必须把写信窗派生 UI 全认下来（`[role=dialog/alertdialog/listbox/menu/tooltip]`、`.rich-image-zoom`、`[data-sonner-toast]`、`.compose-restore-bar`），否则会误收。
- **复用浮动外壳改尺寸时：`width/max-width` 要 `!important`，`height/max-height` 绝不能加**（否则 0,1,0 会反杀掉 `.compose-dialog.compose-expanded` 的 0,2,0 高度 → 「最大化后尺寸纹丝不动」）。
- **浏览器探针要先 `tools.browser.tabs.focus({tabID})` 把标签页切到前台**：后台标签页里 CSS transition 被挂起，`getBoundingClientRect()` 会长期停在上一个状态的中间值（本机实测 640×428 vs 切前台后的 755×586）。
- **⌘W 在 macOS 上被原生菜单吃掉**，前端收不到 keydown；不要改默认菜单（会连累 ⌘C/⌘V），走 Rust 拦 `CloseRequested`。
- **`tauri.conf.json` 的 `app.security.capabilities` 是白名单**：新增 `capabilities/*.json` 必须登记进去，否则该 capability 形同不存在（上一轮阅读窗/写信窗的 listen 一直失效、写信拖拽附件不可用就是这个）。release 只报 `Command <cmd> not allowed by ACL`，`allowed-on` 明细要 debug 构建才看得到。
- **跨窗事件要按方向拆名**：JS `listen` 不带 options 时 target 是 Any，会收到任何 `emit_to` 的事件，同名事件跨窗回环（实测 1 分钟 trace 破百万行、主线程占死）。
- **建原生窗口时不要调原生淡入**：那一刻 runloop 未就绪，动画不生效会让窗口停在 alpha=0（表现为「窗口找不到」）。
- **macOS 拖到顶部填充/平铺不置 `NSWindow.isZoomed`**：窗口状态插件因此存下 `maximized:false` + 旧像素尺寸，重启就「占不满」。解法是持久化「铺满意图」（`Preferences.window_fill`）并在启动时按当前 `monitor.work_area()` 重填；判定与重填都要 `run_on_main_thread` 等插件的异步还原落地，矩形判定留 5% 容差兜住首次启动。
- **原生阅读窗的悬浮入口**：`mail_windows` 登记表存 `{id, subject}` 快照，只向 `main` 发 `mail-windows-changed`；`focus_mail_window` 走 `unminimize` + `set_focus`；浮条复用 `.compose-restore-bar`，与「继续写信」共用一条堆叠（偏移按未聚焦写信窗数量算）。
- 三灯按钮的 AX 几何是乱码（如 `pos=-699,-314 size=737x424`），只能用 CSS 算坐标点；原生窗口的标题栏按钮不在可测范围。
- `WKWebView.callAsyncJavaScript(_:arguments:in:in:)` 有两个 `in:` 标签，需 `in: nil, in: .page`；`evaluateJavaScript` 不能返回 Promise。
- 演示模式持久化在 localStorage `mail-desktop-demo-v1`（点「先体验」进入，别点两次）；浏览器里它可能被前面的会话清掉，需要重进一次。
- **环境坑**：macOS 会话/显示器睡眠期间 AX 与 CGEvent 全部失效；本机截图不可用（`browser.screenshot` 报 "Screenshot needs a visible tab"），视觉/Retina 效果只能由用户在装机版上人工看。

探针目录（仓库外，可重建）：`/private/var/folders/n4/t0q43h1d7c1d6zwl007yth6h0000gn/T/opencode/`
`ax.swift`（`click` / `drag` / `dblclick` / `dump [depth]` / `press`）、`wins.swift`、`wkverify.swift` + `wkverify.js`（真 WKWebView 跑 dev server 上的真前端代码）、`wkbuttons.*`。

## 六、待办与下一步

1. **0.2.0 发布收尾**：推 `v0.2.0` tag 后看 Actions 两架构构建与草稿 Release，核验 DMG / app.tar.gz / sig / latest.json 与发布说明，再手动发布草稿（会带 Pre-release 徽标）；顺手确认 `releases/latest/download/latest.json` 仍指向 0.1.9。
2. Alpha 版不自动升级：要真机看 0.2.0 就得手动下 DMG 覆盖安装（账号、存档、设置保留）。
3. 已记录但暂缓（见 `RULES_PORT_UPSTREAM.md` 末尾）：通知横幅优先级与可靠性；阅读器图片自定义菜单与左键选中（需原生 `WKUIDelegate`，独立高风险项）；服务器删除被永久阻塞时待删邮件一直隐藏（考虑加「阻塞时重新露出」兜底）；更新说明 Markdown 渲染（现为纯文本）；全局网络代理（暂不做）。
4. 上游同步：继续按 `docs/RULES_PORT_UPSTREAM.md` 的移植清单逐项 cherry-pick（`AGENTS.md` 的上游基线清单已在本轮核对更新）。
5. 新反馈优先：下一批迭代点等用户提出。
