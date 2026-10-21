# 同步上游：附件体系 + 富文本 —— 工作点（2026-10-17）

> ## 新会话引导语（可直接复制到开场白）
>
> 继续「雁信（Anser）」开发。仓库 `/Users/wanghlstar/Mytools/anser`（活跃；旧仓库 `wanghlstar/yanxin` 已废弃）。先读 `AGENTS.md` 和本文件。
>
> **当前基线**：`main` = 本地轻量 tag `0.2.2.1` 所在提交（未推送；`0.2.2.0` = `fe1878a`；上一发布 tag 为 `v0.2.1`）。后续从 `main` 拉短分支并经 PR 合并。上游 `upstream/main = 490a432`（0.1.24）。旧功能分支 `feat/port-upstream-a` 已并入 main 并删除。
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
4. **阅读器图片交互：真实病根是「跨 realm 的 instanceof」（两次误判后的最终结论）**。`sandbox="allow-same-origin"`（缺 `allow-scripts`）时帧内监听器确实收不到事件（Chromium 不复现，浏览器里测不出来），但改成 `allow-same-origin allow-scripts` 后用户实测**毫无变化**——真正的病根在 `mail-content.tsx`：**iframe 里的 DOM 属于另一个 realm**，`event.target instanceof Element`、`img instanceof HTMLImageElement` 一律为 false。浏览器实测：`isParentElement / isParentHTMLElement / isParentNode` 全 false，而 `nodeType === 1`、`tagName`、`closest()` 可靠，`img instanceof frame.contentDocument.defaultView.Element` 为 true。于是 onPointer / onContext / onDoubleClick 全部在 guard 处静默 return，表现为：单击无蓝框、双击无反应、右键是 WKWebView 原生菜单（「右键菜单功能不全」）、⌘C 没有选中对象可复制。修法是新增 `frameImageTarget()`（只用 nodeType/tagName/closest）并三处改用它。
   **规则：处理 iframe 内 DOM 不要用 `instanceof`，用 `nodeType` / `tagName`。**（`interceptMailLinks` 早就用了 `nodeType === 1`，正是同一个坑。）`allow-scripts` 保留：帧内没有任何可执行脚本（DOMPurify 禁 script/on\* + 帧内 CSP `default-src 'none'`），链接仍由帧内拦下导航并把原始 URL 交回应用。
5. **WKWebView 里 `navigator.clipboard.write` 不可用**：复制正文图片如果走浏览器剪贴板 API，会抛 `NotAllowedError: The request is not allowed by the user agent or the platform in the current context`（用户实测，⌘C 与自研菜单都失败）。**写剪贴板必须走原生**：`copy_mail_image` → `fetch_mail_image` 取字节 → `NSPasteboardItem` 同时写原格式（`public.png`/`public.jpeg`…）与 `public.tiff`（`copy_image_to_pasteboard`）；附件同理走 `NSFilenamesPboardType`。原先的 `mail_image_data`（返回 base64 让前端用 `ClipboardItem`）已删除。
6. **Tiptap v3 里 `editor.commands` 在实例销毁后必抛错**：`Editor.destroy()` 把 `commandManager` 置 null，而 `get commands()` 直接解引用 `this.commandManager.commands`（`chain()`/`can()` 有空实现兜底，`commands` 没有）。`useEditor` 的 `scheduleDestroy` 会用 1ms 定时器销毁「已渲染但副作用还没跑」的实例，于是写信打开时插入问候语的副作用会抛「null is not an object (evaluating 'this.commandManager.commands')」，被 `RichEditorBoundary` 接住显示「富文本编辑器暂时无法加载」。**规则：副作用/回调里用 `editor` 前先判 `editor.isDestroyed`，命令优先走 `chain()`；渲染处遇到已销毁实例直接 return null。**
7. 我们这边后端已有可直接复用的能力：`Store::message_raw`、`eml_files::account()`、`Store::save_draft`（上游叫 `save_draft_record`）。
8. **写信窗口改成「非模态浮动面板」需要三件事同时做，少一件就还是不能用背景**。用户反馈「现在是置顶，不能操作别的了……写信的时候要看其他信件去复制粘贴」：根因是 Radix `Dialog` 默认模态——`DialogContentModal` 会 `disableOutsidePointerEvents: true`（给 `document.body` 加 `pointer-events: none`）并渲染 `DialogOverlay`（实测计算色 `oklab(0 0 0 / 0.5)`）。修法：`<Dialog modal={false}>` + 给 `DialogContent` 新增可选 `overlay` prop（默认 `true`，写信传 `false` 不渲染遮罩）+ `onInteractOutside={(e) => e.preventDefault()}`。非模态分支（`DialogContentNonModal`，`trapFocus:false`、`disableOutsidePointerEvents:false`）里的 `onInteractOutside` 是「先调 props 回调，只有 `!event.defaultPrevented` 才记录这次外部交互」，所以 `preventDefault()` 正好能挡住 `DismissableLayer` 的 `onDismiss` → 点收件箱不会关掉草稿。**规则：应用内非模态面板一律这三个开关一起配。**
9. **`.compose-dialog` 的几何属性带 `!important`，内联样式压不住它**。该对话框的 `width / height / max-height / top` 都由 `src/index.css` 用 `!important` 固定（`width:calc(100vw - 64px)!important` 等），而 React 内联 `style={{left,top,width,height}}` 是普通声明，会被 `!important` 覆盖，拖拽/缩放看起来「没反应」。**修法是走 CSS 自定义属性**：内联只写 `--compose-left/--compose-top/--compose-width/--compose-height`，再由 `.compose-dialog.compose-floating { left: var(--compose-left); top: var(--compose-top); width: var(--compose-width); height: var(--compose-height); max-width:none; max-height:none; translate:none; transform:none }` 落地（自定义属性本身不会被 `!important` 规则影响）。同时要清掉 `translate`/`transform`——Tailwind 的 `translate-x-[-50%]` 写的是独立的 `translate` 属性，不清掉浮动定位会偏半个宽度。
10. **`DialogContent` 自带 `transition: all .2s`，拖动/缩放期间必须关掉**。Tailwind 类里的 `duration-200` 让计算值成为 `transition-property: all`（用 `document.styleSheets` 遍历找不到这条声明，Tailwind v4 用逻辑属性/简写，**CSSOM 排查不可靠，要看 computed style**）。后果是每次 `left/top/width/height` 变化都要 200ms 动画，拖动跟手性差、自动化测量还会读到动画中间值（看起来像「冻住了」）。`.compose-floating` 上 `transition: none !important` 后拖动立即跟手。**规则：拖拽/缩放类交互期间禁用容器的 transition。**
11. **缩放手柄要画在框内，不能用负偏移**。`.compose-dialog` 是 `overflow: hidden`，画在边框外的热区会被裁掉而点不中；8 个 `data-dir` 手柄（n/s/e/w/ne/nw/se/sw）都按 `position: absolute` 贴内缘（边 6px、角 14px）并配 `ns/ew/nwse/nesw-resize` 光标。几何要 `clamp` 在视口内（最小 640×420，四边各留 8px），并且监听 window `resize` 重新收敛——否则窗口缩小后浮动面板会跑到屏幕外。
12. **jsdom 里没有 `PointerEvent`，`setPointerCapture` 也会抛**。用 `pointerdown/move/up` 命名的 `MouseEvent` 派发即可让 React 的 `onPointerDown` 等回调触发（React 按事件名匹配，不看构造器）；`element.setPointerCapture()` 必须 try/catch 包住（捕获只是拖动期间的优化，没有它靠挂在元素上的 move/up 也能跑），否则测试环境直接报错。
13. **写信窗口的宽度上限有两套，别再搞混**。「最大化」按钮走 `.compose-expanded`（`width: calc(100vw - 24px)`、`max-width: none`），本来就不受上限限制；用户说「最大化的上限低了」其实是**非最大化**浮动态的 `max-width`——旧值 `1160px`（来自基线 `432f441`/0.1.5），已提到 `1440px`。浮动态初始宽度仍是 `calc(100vw - 64px)`，所以只有窗口本身很宽时 1440 才会生效。
14. **窗口拖动/缩放的基准不要用 `getBoundingClientRect()`**：shadcn `DialogContent` 的打开动画（`data-[state=open]:zoom-in-95`）会把 `transform: scale(0.95)` 留在窗口上，动画期间 rect 是缩放后的值。实测第一次拖动把基准量成 `889×574 @ (95,109)`（真实布局盒是 `936×604 @ (32,64)`），窗口当场缩小并跳位。**基准改取 computed style 的 `left/top/width/height`（布局盒）**；居中用的是 `translate`，它不计入 `left/top`，要自己减去一半尺寸。jsdom 里 computed style 拿不到值（返回空串）时再退回 rect，单测照样可跑。
15. **拖动/缩放的 move/up 挂 `window`，别只挂元素 + `setPointerCapture`**：指针捕获在某些环境下会失败（jsdom 必抛），只挂元素时指针一移出元素手势就断了——`pointerup` 收不到、手势状态清不掉，之后再滑回标题区，元素上的 `pointermove` 会带着旧基准把窗口拽飞（用户实测的「拖不动 + 窗口漂移」）。做法：手势期间 `window.addEventListener('pointermove'|'pointerup'|'pointercancel'|'blur')`，并在 `(event.buttons & 1) === 0` 时立即收尾（在应用窗口外面松手是收不到 `pointerup` 的）。
16. **别给标题栏上方留没有命中的空白**：`padding: 24px 0 0` 之类让标题栏从 24px 才开始，那圈区域既不在标题栏的 `onPointerDown/onDoubleClick` 里，也不是边框热区。用户最自然的「抓窗口顶部 / 双击标题」动作全落空，表现为「拖不动、双击没反应」；而且窗口底色比主界面浅，看上去就是左上角一块灰。**标题栏就该紧贴窗口顶边**（缩放热区只压最外 6px，和 macOS 一致）。排查手法：沿窗口顶部用 `document.elementFromPoint(x, y)` 逐点取样，看命中的到底是不是标题栏。
17. **「点窗口外自动收起」要自己挂 `document` 监听，并且必须排除弹层**：Radix 的 `onInteractOutside` 只用来 `preventDefault()`（非模态下防止关闭草稿），它在 jsdom 里不触发、单测覆盖不到。自动收起另挂 `document` 的 `pointerdown`。关键是「什么算外部」——写信窗口的字体/字号下拉、发送预览、确认框都是 React portal，DOM 上挂在 `body` 下、`.compose-dialog` 之外，不排除就会出现「选字体时窗口自己收起来」。用 `closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')` 一次盖住即可（写信窗口自己也是 `role="dialog"`，所以「窗口内」也顺带排掉）。
18. **浮动窗口的默认尺寸必须给「留在视口内」的 clamp 留余地，否则拖动一定是坏的**：写信窗口原来是 `width: calc(100vw - 64px)` / `height: min(860px, ...)`，在 1380×900 下量到 1316×804，`clampGeometry` 只允许 left ∈ [8, 56]、top ∈ [8, 88]——任何正常的拖动（−300,−200）都当场贴到 `[8, 8]` 并卡住，用户看到的就是「一拖就漂到左上角」。同时「最大化」只放大到 `[12,44,1356,844]`（宽高各 +40px）并顺带居中 20px，所以「双击没效果」和「点顶部一定漂移」是同一个根因。**结论：默认尺寸要像真正的窗口（约 1100×660），四边各留 ≥100px 拖动余地；最大化与默认尺寸必须有明显差值。** 排查手法：在真引擎里打印 `pointerdown` 前后的 rect——如果「点一下不动」时 rect 也没变，就别再怀疑手势代码，去看 window/viewport 尺寸与 clamp 的边界。
19. **窄窗降级阈值要跟着默认窗口宽度定，而且要实测**：`COMPOSE_NARROW_WIDTH` 原为 1240（跟着旧的 1316px 默认宽度定的）。默认窗口改到 1100px 后会误触发降级、把「发送预览 / 导入文件」的文字标签收成图标。实测同一套工具条在 1100px 与 1316px 下各控件宽度完全一致（56 / 266 / 104 / extras 257.1 / 26×N）、高度都是 36px 单行、`scrollWidth === clientWidth` 无溢出，所以阈值下调到 1080 是安全的。**别凭阈值数字猜，量 child 宽度对比一次。**
20. **WKWebView 专属行为（指针/动画/计算样式）用 Swift 探针直接复现，不要靠 Chromium 推断**：装一个 30 行的 `WKWebView` + `NSWindow`（`callAsyncJavaScript` 跑探测脚本），直接 `load(URLRequest(url: "http://localhost:1420"))` 加载真实前端 + 演示模式，就能在真 WebKit 里跑和浏览器里同一套 `elementFromPoint` / rect / computed style 探针。本轮实测确认：`getComputedStyle(...).left` 对 `left: 50%` 返回的是用值（`"690px"`，不是 `"50%"`）、`.compose-floating { translate: none !important }` 能压住 Tailwind 的 `translate-x/y`、入场 `zoom-in-95` 在真 WebKit 里会正常结束（0.954 → 1.0）——于是排除了两个「看起来很像」的假设，直接锁定尺寸/clamp 这个真因。

21. **WKWebView 的 `pointermove`/`mousemove` 的 `buttons` 恒为 0：手势绝不能靠 `event.buttons` 判断「主键还按着」**。最小 WKWebView 探针 + 真实 `CGEvent` 拖拽实测：`pointerdown` 2 次、`pointerup` 2 次，131 次移动事件的 `buttons` **全部是 0**。写信窗口的手势里原本写着「`(event.buttons & 1) === 0` 就收尾（防止在窗口外松手后带着旧基准拽飞）」，结果每一次拖动都在第一次 `pointermove` 被取消——用户看到的就是「拖不动」。**收尾只能靠事件：在 `window` 上挂 `pointerup/pointercancel/mouseup/blur`，并在 `pointerdown` 里 `try { setPointerCapture() } catch {}`（拖到窗口外松手也能收到 `pointerup`）。**

22. **合成 `PointerEvent` 会「假绿」，真机行为只能靠真实 `CGEvent` + AX 读回来验证**：自己的探针脚本用 `new PointerEvent("pointermove", { buttons: 1 })` 构造事件时，绕过了 WebKit 「真事件 `buttons=0`」的行为，于是 WKWebView 探针里拖动「恰好是好的」，而装机后一动不动。**判定拖动/点击是否真的生效，要在真机上发真事件**：macOS `CGEvent`（`mouseMoved` + `leftMouseDown` + 若干 `leftMouseDragged` + `leftMouseUp`，`.cghidEventTap`）打进去，再用辅助功能（AX）读回节点的 `pos/size` 对比（本轮就是靠 `AXGroup pos=175,174` 拖动前后不变确认的）。注意 CGEvent 落点会被上层窗口吃掉，探针窗口要 `.floating` + `NSApp.activate(ignoringOtherApps:)`。

23. **多写信窗口：一封一窗，窗口状态留在各自的组件实例里，用 `key={draft.id}` 天然隔离**：App 里 `draft: Compose | null` 改成 `composes: Compose[]`，`openCompose` 追加、`closeCompose(id)` 只关自己那扇，渲染成 `composes.map((item, index) => <ComposeDialog key={item.id} draft={item} stackIndex={index} …/>)`；浮动位置/最大化/最小化都是组件内部 `useState`，靠 key 分隔，不必把几何状态提到 App。写邮件/回复/转发/联系人/草稿箱 `onOpen`/发件箱 `onDraft`/重新编辑/撤回重开这些入口一律改成「追加」而不是「替换」。多个「继续写信」还原条各自是 `position: fixed` 的独立元素（不是同一 flex 容器里的兄弟），只能靠 `--compose-bar-lift`（`stackIndex * 52px` 向上错开）避免叠在一起。

24. **生产构建的 CSS 不是源码的逐字复制：用 `translate`/`transform` 这类属性做的覆盖，改完必须在产物里 grep 一遍**。lightningcss（Tailwind v4 的 CSS 管线）会把 `translate` 这类独立变换属性降级合并进 `transform`；同一条规则里后面又写了 `transform: none !important`，前面的 `translate: none !important` 就被整个吃掉——源码里写着、`dist/assets/index-*.css` 里没有。dev 不降级（探针全绿），装机后点一下标题栏窗口就偏半个身位（`-w/2, -h/2`），且「三灯以外任意位置」全部如此。**规则：凡是靠可被降级重写的属性做的覆盖，构建完成后用 `grep`/python 把产物 CSS 那条规则读出来确认；更稳的做法是别让冲突存在（见 25）。**

25. **浮动面板定位不要用 `translate` 居中，用 `left/right + margin:auto`，垂直用 `top/bottom + margin-block:auto`，并把 `DialogContent` 自带的 `translate-x/y-[-50%]` 从类名上顶掉**（`cn("translate-x-0 translate-y-0")` 会把同组的 `translate-x-[-50%]` 替换掉，已在 `cn@0.4.0` 上实测）。原因：`translate` 不计入 `getComputedStyle().left/top`，又容易被构建降级、被动画或工具类争抢；改用 margin 居中后，用值全落在 `left/top/margin` 与 `getBoundingClientRect()` 里，一眼可查。再配 `.compose-dialog { transform: none !important }` 关掉入场 `zoom-in-95` 的 `scale`（保留淡入），`rect` 就永远等于布局盒——拖动基准直接取 rect，不要再自己折半。

26. **写信窗「点外面自动最小化」的判定要能认全写信窗派生出来的 UI，别只列 role**。现在这四样都得进同一个 `closest()` 选择器：`.rich-image-zoom`（图片缩放 `− % +` 浮条，`createPortal(body)` + `role="toolbar"`）、`[data-sonner-toast]`（通知横幅，就地挂在 `#root` 里）、`[role="tooltip"]`（富文本工具条提示气泡）、`.compose-restore-bar`（另一封写信窗的「继续写信」还原条，就地渲染在 `#root` 里），再加上原本的 `dialog/alertdialog/listbox/menu`。漏掉它们的后果都一样：点一下缩放、点一下通知或点一下还原条，正在写的信就被收起来（用户反馈的「误触」）。**在写信窗里新增浮层时，把它的 role 或类名加进这个选择器**；要减少这种手工维护，可以给写信窗浮层统一加 `data-compose-ui` 标记再按标记认。

27. **macOS 上 ⌘W 是原生菜单加速键，但主窗和写信窗要分开处理**。`tauri::menu::Menu::default` 会给 `PredefinedMenuItem::close_window` 挂 ⌘W（File 与 Window 子菜单各一个），事件在 `NSApplication` 层就被处理，前端 `keydown` 收不到；不要改默认菜单，否则会弄坏 ⌘C/⌘V。**主窗 `CloseRequested` 只做 `save_window_state + hide()`，不要再用 `set_compose_open` 把关闭请求转给写信窗**：写信窗在前台时 ⌘W 本来就先到它；主窗收到关闭请求就说明主窗是 key window，此时隐藏主窗、让写信窗自然失焦成「继续写信」才是用户要的。写信窗自己的 `CloseRequested` 才拦：label 还在登记表里时 `prevent_close()` + `emit_to(label, COMPOSE_WINDOW_CLOSE)`，由写信窗弹「保存 / 不保存 / 取消」；前端确认后 `close_compose_window` 先摘登记再真正关，避免关不掉。

28. **关闭有内容的写信窗口要「先问再关」，而且确认弹层本身不能触发自动最小化**。红点 ×、⌘W（原生与前端兜底）、Esc 三处走同一个 `requestClose()`：空白邮件直接舍弃、有内容弹「取消 / 不保存 / 保存」；**「不保存」= `delete_draft`**（离散掉自动保存的那份草稿），「保存」= `save_draft`，「取消」= 什么都不做继续编辑。另外这个确认弹层也是写信窗派生的 UI，自动最小化的 effect 必须把 `closePrompt` 加进早退条件与依赖数组，否则点弹层遮罩就会把写信窗收进「继续写信」还原条（RULES 26 的同一坑，role 白名单已覆盖 `alertdialog`，但组件内的早退判断也要同步）。

29. **Radix 弹层的关闭有退出动画，DOM 会残留一小段时间，别据此误判「没关掉」**。`AlertDialog` 关闭后节点会带 `data-state="closed"` 再留在 DOM 里等 `animationend`（实测 300ms 时仍在、1800ms 已移除），`document.querySelector('[role="alertdialog"]')` 在这段时间里查得到。**断言「弹窗已关」要等节点真正消失（`waitFor` / 充足等待），或改查内容是否还在**；反过来，「点取消后弹层还在」不能当成 bug。

30. **列表头部的标题被截断，真因是「标题组」和「动作组」共用了同一条 `flex: 1` 规则**。`src/index.css` 的 `.list-heading > div { flex: 1; overflow: hidden }` 会把两侧各撑成一半宽度，动作组内容左对齐，于是窄宽度下标题被省略号截断、刷新按钮停在中间（用户反馈「字体缩进了」）。修法是把它收窄到 `> div:first-child`，并显式给动作组 `> .list-heading-actions { flex: none }`。**同一容器里两个子元素共用选择器时要复核：命中范围比你以为的大。**头部「收取 + 选账号」用 shadcn `ButtonGroup`（`src/components/ui/button-group.tsx`，取自官方 new-york registry，无新增依赖：`radix-ui` 的 `Slot.Root` + 本地 `Separator`）拼「ghost icon 按钮 + DropdownMenu 触发按钮」，不要自己拉两个裸按钮贴一起。

31. **收取全部/单个账号用同一个命令带可选参数，别加第二套代码路径**。`sync_mail(id?: Option<String>)` → `collect_mail(store, app, only)` 里 `.filter(match only)`，托盘调用点传 `None` 保持原行为；账号下拉只在「非远程文件夹」视图渲染（远程文件夹该收的是那个文件夹本身）。演示模式（`isDemo()`）下 `invoke` 会被拦，新增命令在前端要包 `.catch(() => {})`，否则控制台报错。

32. **应用内「第二个窗口类型」不要复制写信窗口那套浮动窗口机制，直接把类名与几何变量复用过去**。`MailWindow`（浮动阅读窗）用的就是 `.compose-dialog / .compose-expanded / .compose-floating / .compose-minimized`、`--compose-*` 变量、`.compose-resize-handle`、`.compose-light*`、`.compose-restore-bar`，自己只多一个 `.mail-window` 覆盖默认尺寸与内部排版。拖动/八角缩放/居中/三灯这几处都踩过坑（见 21–25），复制第二份等于把坑再走一遍；复用后行为与观感也天然一致。**代价是类名语义变宽（`compose-*` 实为「浮动窗口外壳」），所以在 `mail-window.tsx` 顶部写清楚这层含义**，将来若要改第三处再考虑重命名。

33. **给复用过来的浮动外壳覆盖尺寸时：`width/max-width` 要 `!important`，`height/max-height` 绝对不能加**。写信窗口的宽度规则是 `!important`（`.compose-dialog`），所以同特异度的 `.mail-window` 必须也 `!important` 才能覆盖；而高度规则 `.compose-dialog.compose-expanded { height: … }` 是 **非** `!important` —— 若 `.mail-window` 的高度写了 `!important`，就会以 0,1,0 反杀掉 0,2,0 的展开高度（两个都是 `!important` 时由特异性决定，`.mail-window` 输）。第一版正是这么写的，表现是「点最大化后窗口只是挪了个位置，尺寸纹丝不动」。

34. **浏览器探针要先 `bringToFront`（聚焦标签页），否则读到的几何/样式是动画中间值**。后台标签页里 Chromium 会挂起 CSS transition（compositor 停摆），`getBoundingClientRect()` 于是长期停在上一个状态：同一扇阅读窗在后台标签页里反复读到「最大化前」的 `640×428` 与 `margin-left:76px`，切到前台后再点一次立刻是 `755×586`、`x=12`。诊断手法：同一个操作隔时间多读几帧，或对比切前台前后的读数；`tools.browser.tabs.focus({tabID})` 即可。

35. **多封非模态 Dialog 之间没有 Esc 仲裁，Esc 只能给其中一个用**。写信窗口的 Esc 是「保存/不保存/取消」关闭确认（必须有），所以浮动阅读窗的 `onEscapeKeyDown` 直接 `preventDefault()` 不响应，用红点或还原条关闭。否则两扇窗同时开着时按一次 Esc 会连带关掉/收起另一扇（Radix 的 `DismissableLayer` 对同级的非模态层不做「最上层」判定）。

36. **jsdom 里对同一组件重新 `root.render()` 不会重跑 `useState` 的惰性初始化**，所以验证「第二扇窗按 stackIndex 错开」这类挂载期计算，必须改 `key` 让它真正重挂（App 里本来就是 `key={mail.id}`）；否则断言会拿到第一扇的旧几何。

37. **新建原生窗口后不要调原生淡入**。`open_mail_window` 最初照抄了主窗口的 `fade_in_window(&window)`，结果建窗那一刻 runloop 还没就绪、动画不生效，窗口**永久停在 `alpha=0`**：进程里有窗口对象、`CGWindowList` 也能查到，但人眼完全看不到（这就是「窗口找不到」的真因，实测 `wins` 从 alpha 0.0 变 1.0）。原生窗口直接显示即可，要动效交给系统。

38. **原生窗口必须把「应用内窗口壳」剥掉，否则会出现双份标题栏**。写信窗进了原生窗口后，组件里那套自绘三灯（红/黄/绿）与 macOS 原生标题栏同时存在，语义还各是一套（自绘黄灯＝收成底部细条）。做法：给 `ComposeDialog` 加 `nativeWindow` 开关，为真时不渲染三灯、8 个 `compose-resize-handle`、拖动/双击标题、还原条，也不挂「点窗口外自动最小化」与「视口 resize 重夹几何」两个 effect，只保留表单业务、`closeSignal`、Esc 关闭确认与 `narrowToolbar`。新加的 `.compose-native` 规则**必须带 `!important`** 才能压掉 `DialogContent` 自带的 `position: fixed` 居中、阴影与圆角（`.compose-dialog` 那几条本来就是 `!important`）。

39. **「前端请求关原生窗口」与「系统 CloseRequested 拦截」会互相打架，必须用登记表解**。⌘W 要在原生窗口里弹「保存/不保存/取消」，就得在 `CloseRequested` 里 `prevent_close()`；但用户点完确认后前端调 `close_compose_window` 再 `window.close()`，又会被同一个拦截接住 → 窗口关不掉。解法：`close_compose_window` **先把 label 从登记表摘掉再 `close()`**，拦截条件写成「label 是否还在表里」。

40. **跨窗的「正在写信」判定别用布尔，用 Rust 报的草稿 id 列表**。主窗口原来靠 `composes.length > 0` 判断有没有在写信（键盘守卫、通知跳过、更新弹窗拦截、清空草稿箱保护）；写信窗搬走后主窗不再持有这些窗口。改法：Rust 在建窗/销毁窗时 `emit_to("main", "compose-windows-changed", ids)`（ids 从登记表里取 `draft.id`），主窗存成 `composeIds`，判定统一用 `composing = !!draft || composeIds.length > 0`，清空草稿箱的排除项也并上 `composeIds`。

41. **不要再从主窗转发关闭请求给写信窗**。旧的 `close_latest_compose_window` / `compose-close-requested` 路径已经被 0.2.1 的「主窗关闭只隐藏」取代：主窗 `CloseRequested` 直接 `save_main_window_state + hide`；写信窗在前台时 ⌘W 会先命中它的 `CloseRequested`，走 `COMPOSE_WINDOW_CLOSE`。如果还看到主窗关掉写信窗的回归，先查是不是又把这套旧转发接回来了。Rust 侧定向通知一律用 `emit_to(label, ...)`，不要广播。

42. **浏览器 / 演示模式 / 单测里没有原生窗口，写信窗要保留应用内浮窗外壳作为回退**。`openCompose` 只在 `native` 时 `invoke("open_compose_window")`，否则仍 `setComposes` 追加（jsdom 的 430 例前端测试跑的就是这条路）。所以 `ComposeDialog` 的浮动外壳代码与它的 37 例窗口管理测试**不删**——它们是非原生环境唯一的实现，只是应用打包后不再走。

43. **锁屏状态下所有 UI 探针都会失效，只剩 `CGWindowList`**。`screencapture`（Screen Recording 权限）与 `osascript`/System Events（辅助功能权限）在锁屏时分别只能拍到壁纸+菜单栏、报 `-25211` 不允许辅助访问；自写 CGEvent 探针（`ax click/drag`）也打不到应用窗口。`wins`/`wins2`（`CGWindowListCopyWindowInfo`，无需权限）仍能读到窗口的 owner/id/layer/alpha/onscreen/bounds —— 所以锁屏时能核对的只有「窗口建出来了、尺寸/位置/alpha 对不对」，交互与截图必须等解锁。

44. **`?` 不能直接套在 `Mutex::lock()` 的结果上去传引用**：`latest_compose_label(&state.compose_windows.lock().map_err(err)?)` 报 E0308（`?` 的结果被当成 `HashMap` 而不是 `MutexGuard`）。写成 `let label = { let windows = state.compose_windows.lock().map_err(err)?; latest_compose_label(&windows) };` —— 顺便让 guard 在 `emit_to` 之前就释放，避免持锁发事件。

45. **`app.security.capabilities` 是白名单：写了列表，`capabilities/` 里没列进去的文件就是死文件**（tauri-utils `config.rs`：「By default (not set or empty list), all capability files from `./capabilities/` are included, by setting values in this entry, you have fine grained control over which capabilities are included.」）。我们原来是 `["main"]`，于是上一轮的 `mail-window.json` 与本轮的 `compose-window.json` **都没被加载**：文件躺在目录里、也被生成进 `gen/schemas/capabilities.json` 和构建产物 OUT_DIR，但运行期 ACL 里只有 `main`，新窗口的 `plugin:event|listen` / `emit_to` / `dialog:allow-open` 全被拒（`listen` 失败连拖拽附件都不好用，因为拖拽实现里用了 `listen`）。诊断靠 debug 构建（release 的 ACL 错误只有短句 `Command <cmd> not allowed by ACL`，debug 才打印明细）：`event.listen not allowed on window "compose-window-0", webview "compose-window-0", URL: local` / `allowed on: [windows: "main", URL: local]` / `referenced by: capability: main, permission: allow-listen` —— 窗口/webview 标签与 origin 都正确，只是表里没有这条 capability。修法：`"capabilities": ["main", "mail-window", "compose-window"]`。**坑：JSON 重复 key**——该文件在 `csp` 之后已有一行同样的 `"capabilities": ["main"]`，我新增的键成了重复键，serde_json 取后者，改动静默失效；改完用 `python3 -c` 数一下 key 出现次数。另注意：**上一轮阅读窗（mail-window）的 capability 也一直是失效的**（它的 `listen`/`emitTo` 从未生效，只是当时没测到），本轮一并修好。

46. **跨窗同名事件 + 不带 options 的 `listen`（target 默认 `{kind:'Any'}`）会回环**。tauri-2.12 的 `match_any_or_filter` 是 `*target == EventTarget::Any || filter(...)`，所以「目标为 Any」的监听器会收到**任何** `emit_to` 的事件，包括发给别的窗口的。主窗与写信窗原都监听 `compose-close-requested`：Rust `emit_to(写信窗, …)` → 主窗监听器也触发 → `invoke("close_latest_compose_window")` → 再 `emit_to(写信窗, …)` → 死循环（实测 1 分钟写满 1,036,123 行 trace，主线程被占死、写信窗根本没机会弹确认框）。**规则：方向不同的事件用不同名字**（Rust→写信窗 = `compose-window-close`；Rust→主窗 = `compose-close-requested`），不要指望 `emit_to` 能隔离同名事件。（这也修正了第 41 条里「定向通知一律用 `emit_to` 就够」的认知：`emit_to` 只保证广播范围，不保证同名事件不串。）

47. **「写信窗不在前台」的悬浮入口（继续写信）**：Rust 的登记表里带上 draft 快照，`compose-windows-changed` 的载荷从「id 列表」升级为 `{label, draft, focused}[]`（`compose_window_infos` 按 `compose-window-N` 的序号排序，`focused` 用 `get_webview_window(label).is_focused()` 现算）。写信窗的 `Focused` 窗口事件、以及 `save_draft`（签名加 `window: tauri::Window`，Tauri 自动注入，前端不用改；存库后把新 draft 写回登记表）都会重发该事件，于是「窗口回到前台 → 悬浮条自动消失」「自动保存 → 悬浮条主题实时更新」都是免费的。点击悬浮条走新命令 `focus_compose_window`（`unminimize()` + `set_focus()`）。前端沿用旧的 `.compose-restore-bar` 样式（语义改成「按未聚焦的写信窗各一条，用内联 `bottom: calc(16px + index * 52px)` 向上错开」），文案由导出的 `composeTitle(draft)` 生成（`Re:` → 回复邮件、`Fwd:` → 转发邮件、否则 写邮件）。

48. **macOS「拖到顶部填充 / 双击标题栏」不置 `NSWindow.isZoomed`**，所以 `tauri-plugin-window-state` 存下来的 `maximized` 永远是 `false`，只记了一组旧像素尺寸（实测 `.window-state.json`：`width 2900, height 1712, x 0, y 76, maximized false`）。Dock 变矮 / 分辨率变更后那组尺寸重算不出来，于是「占不满」。**修法是把「铺满」当意图存**：`Preferences.window_fill` 由 `save_main_window_state()` 在主窗 `CloseRequested` 与 `RunEvent::Exit` 时用 `main_window_fills_screen()` 精确记录（`is_maximized()` **或** 四边留白都在 `rect_fills_area` 的 5% 容差内——macOS 填充自带窗口间距，完全相等是等不到的）；启动时 `was_full || main_window_fills_screen(&window)` 命中就 `fill_main_window()`（`set_position` + `set_size` 到 `monitor.work_area()`）。矩形判据专管「装上升级后第一次启动、意图位还没记过」，意图位对 Dock 变动最准，两条合起来用。**判定与重填必须放进 `run_on_main_thread`（deferred）**：插件在 macOS 上的还原走 `DispatchQueue::main().exec_async`，同步量到的还是还原前的几何。`save_main_window_state` 只在主线程调（读 `NSWindow`/`NSScreen` 必须主线程），所以没动 `restart_for_update` 的保存路径。

49. **原生阅读窗「不在前台」的悬浮入口**：`mail_windows` 登记表从「label → 邮件 id」升级为「label → `{id, subject}`」快照，新增 `mail_label_seq` / `mail_window_infos` / `emit_mail_windows`（事件 `mail-windows-changed`，`emit_to("main", …)`），阅读窗的 `Focused` / `Destroyed` 与 `mail_window_mail` 都会重发（窗口回到前台 → 悬浮条自动消失）。点击走新命令 `focus_mail_window(label)`（`unminimize()` + `set_focus()`）。前端与「继续写信」共用 `.compose-restore-bar`，`bottom: calc(16px + (composeUnfocusedCount + index) * 52px)` 让两类条目沿同一条堆叠往上排。**没有新增 capability**：`focus_mail_window` 是 app 命令不是 plugin 命令，不走 ACL；`mail-windows-changed` 只发给 `main`（主窗早有 `core:event:allow-listen`）；阅读窗自己的 `capabilities/mail-window.json` 已在 `app.security.capabilities` 白名单里（第 45 条修好的）。

50. **顶部两卡「逐行对齐」靠统一行高 + `flex-start`，不能留 `space-between`**：`align-items: stretch` 只保证两卡等高，卡内 `justify-content: space-between` 会把多出来的高度摊到**每一行之间**，于是两卡的行高、行距各不相同（实测左卡行距 40px、右卡 48px，第二行起就越错越远）。做法：顶卡 `justify-content: flex-start`（多余高度留在卡底）+ 行统一 `min-height: 36px`（与 `.select-field` 的自然高度一致）+ 两边的行间距都取 12px（卡 gap 与开关组 gap）。改完用 `browser.evaluate` 量每行 `getBoundingClientRect().top` 逐行核对（本机 `browser.screenshot` 不可用，别靠肉眼）。整行平铺的卡直接挂在 `.storage-tools` 下（原来的 `.storage-tools-bottom` / `.storage-tools-col` 两列布局已删）。

51. **「逐行对齐」与「紧凑」互斥，控件数量不等时要先量真实宽度再定排布**：第 50 条那套（单列 + 统一行高）能对齐，但把两卡撑到 445px 高；用户看过装机版后要求回到紧凑形态 —— 开关横排一行、三个下拉同行、去掉文字标签。**先量再排**：四个「标签 + 开关」的自然宽度 112 / 126 / 108 / 98（合计 444px），默认窗口 1380 时单卡内宽只有 471px，等宽两卡放不下（组间距 14px → 486px，第四组掉第二行）；顶卡改 `1.3fr 1fr` 后左卡内宽 543px 才有余量。**别用 `repeat(4, 1fr)` 等分网格**：每格分到 108px 时「新邮件通知」「发送结果通知」会被折成两行 —— `label` 高度 14 → 28px，但盒子 `scrollWidth == clientWidth`、没有溢出，**光查溢出查不出来，必须量 `label` 的 `height`**。开关组用 `flex: 0 0 auto` + 容器 `justify-content: space-between`（组内自然宽度，多出来的宽度摊在组间），窄窗口整组换行；`@media (max-width: 1279px)` 退成 `flex: 0 0 calc(50% - 7px)` 两行两列。子面板折叠形态也别自己发明：用户要的「活动与诊断」是 **0.1.5/0.1.6 的「高级与诊断」**——外层折叠区默认关闭（折叠时 `CollapsibleContent` 被卸载，五个小项一个都不渲染），展开后「最近活动」折叠、其余四项展开；`Collapsible` 的 `defaultOpen` 是**逐行**给，不要行行都省。

52. **上游同步的两个坑：tag 同名不同物、移植清单会漏版本**。① `git fetch upstream --tags` 时 `v0.1.5`–`v0.1.9` 被拒（`would clobber existing tag`）——本地 `v0.1.5`(`432f441` 完结基线)…`v0.1.9`(`9e1e8e0`) 是**我们自己的**发布 tag，上游另有一套同名 tag（不同提交）；而 `v0.1.19–v0.1.24` 是**上游**的 tag。看到 `v0.1.x` 先 `git log -1 --format="%an %s" <tag>` 认作者，别默认是自己发的。② 本文件与 `AGENTS.md` 的「上游基线」写法让上游 **0.1.15–0.1.18** 直接从清单里消失了（全局代理、原生邮件链接、**大模型逐段双语翻译** 1444+267 行、邮件图片/字体），一直到看上游截图才发现有「大模型翻译」这个功能我们完全没有。**规则：同步时按上游 tag 列表逐个核对（`git tag -l 'v0.1.*'` + `git log v<旧的>..upstream/main`），不能只看自己的清单；清单本身也要写明它覆盖到哪个 tag 为止。** 另：本仓库历史是重写过的单一初始提交 `432f441`，与 `upstream/main` **无共同祖先**（`git merge-base` 无输出），所以上游改动一律 `git show <sha>:<path>` / `git diff` 逐块搬，**`cherry-pick` 不可用**。评估记录见 `docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`。

53. **全量版本比较的做法（不靠人记清单）**。① 上游 tag 与我们的同名，先把上游那半套抓进独立命名空间：`git fetch upstream '+refs/tags/*:refs/upstream/tags/*' --no-tags`（本地 `refs/tags/v0.1.0–v0.1.9` 是我们的，上游的只在 `refs/upstream/tags/*`）。② 跑 `npm run upstream:matrix`（`scripts/upstream-matrix.mjs`），逐上游版本（v0.1.0→v0.1.24）对照本地 HEAD，输出 `docs/UPSTREAM_VERSION_MATRIX.md`：总览表 + 本地缺 / 本地偏薄 / 本地更大三档。③ 判定是启发式（路径同名 + 行数比例），只用来找候选：**改名或重写过的功能会误报「本地缺」**（例：上游 `archive_location.rs`/`archive-integrity.tsx` 其实对应我们 App.tsx 里的存档位置与「校验存档」），逐项结论必须人工归类。④ 首轮结果证实漏项集中在 **0.1.2–0.1.9**（`rule_runs.rs` 1159 行、`rule-runs.tsx`、`archive_location.rs`+`archive-location.tsx`+`archive-integrity.tsx`、`LICENSE`/`NOTICE`）与 **0.1.15–0.1.18**（`proxy.rs`、`mail_images.rs`、`mail_styles.rs`、`translation.rs`）；`src-tauri/src/rules.rs` 上游 690 行 / 本地 176 行是唯一的「核心功能本地偏薄」。

54. **补齐许可证要三层一起补，否则只算半套**。上游的「许可」其实是三层：① 仓库根 `LICENSE`（3951 字节，Anser Personal Use License 1.0）+ `NOTICE`（1435 字节，第三方边界：shadcn/ui 走 MIT、patched `imap-proto 0.10.2` 走 vendor 内的 MIT/Apache-2.0）；② `docs/LICENSING.md`（中文说明）+ `docs/licenses/shadcn-ui-MIT.txt`（`NOTICE` 指向的落地路径）；③ **交付面** —— `src-tauri/tauri.conf.json` 的 `bundle.resources` 四条映射（`"../LICENSE":"LICENSE"`、`"../NOTICE":"NOTICE"`、`"../docs/LICENSING.md":"LICENSING.md"`、`"../docs/licenses/shadcn-ui-MIT.txt":"licenses/shadcn-ui-MIT.txt"`，**顺序与目标路径照抄，`licenses/` 子目录不能省**，因为 `NOTICE` 正文就写着 `licenses/shadcn-ui-MIT.txt in App resources`）与 `README.md` 的 `## 使用许可` 段。**只补 ①② 等于没发给用户**：我们改前的 0.2.0 包里 `Contents/Resources/` 只有 `icon.icns`；补上 `resources` 重打后才有那 4 个文件。**验证必须拆包看**，用「三方 sha256 对照」（仓库原文 = App 包内副本 = 上游原文），**别用 `diff … | wc -l`** —— 路径写错时 diff 的报错行会被算成 1 行，看起来像「内容不同」的假警报（本轮就踩了）。重打包验证时加 `--config '{"bundle":{"createUpdaterArtifacts":false}}'` 可避免覆盖已有的 `雁信.app.tar.gz`/`.sig`。另外 `prettier --check` 覆盖 `src-tauri/*.json` 与 `package*.json`，但**不覆盖** `LICENSE`/`NOTICE`/`docs/LICENSING.md`/`src-tauri/Cargo.toml`。最后：补了许可证要回头改过期陈述（本轮删掉 `docs/DEVELOPMENT_STATUS.md` 里「仓库根目录未发现项目 LICENSE」那一条）。

55. **workflow 只搬「自己那份基建能跑」的部分；上游 release 有三样不能照搬**。上游 5 个 workflow（`ci`/`release`/`homebrew`/`preview`/`signing-check`），我们只有前两个。`ci.yml` 唯一差别是 rustfmt 在上游阻塞、在我们这 advisory（项目 Rust 保持手工紧凑）。`release.yml` 的差别集中在签名与发布：上游用自家 Apple Developer 证书（`ANSER_CODESIGN_P12_BASE64`/`_PASSWORD` secrets + `scripts/mac-ci-signing.mjs` 的 `import`/`verify`/`cleanup` + `anser-signing.config.json`），我们靠 tauri-action 默认签名 + `codesign --verify --strict --deep`；上游跳过已发布版本与上传资产走 `scripts/release-draft.mjs`，我们是内联 `gh release view/create/upload` 且带 `--prerelease`（Alpha 通道，`releases/latest` 不指向它，已装用户不升级）。**别搬**：证书那三件、`homebrew.yml`（`Casks/anser.rb` 是上游仓库的 tap）、`preview.yml`（需要 `build:preview` 与 Pages）、`signing-check.yml`（同证书依赖）。**值得补的一处**：上游在签名校验里 `test -s` 断言包内 `LICENSE`/`NOTICE`/`LICENSING.md`/`licenses/shadcn-ui-MIT.txt`；我们批次 0.5 配了 `bundle.resources` 但 CI 不校验，改配置会静默丢文件（补 4 行即可，尚未做）。

56. **0.1.22/0.1.23 是界面语言，不是邮件正文翻译**。上游 0.1.22（`0828545`）新增可配置中英文界面：96 文件、约 5403 行新增，`src/lib/i18n.ts`（模块级 store + `useSyncExternalStore`）、`src/locales/{config,zh-CN,en}.json`（中英各 1198 行）、`language-settings.tsx`、`scripts/check-i18n.mjs`、Rust `interface_language.rs` 持久化，通知/托盘/菜单与 date-fns 日历 locale 一起切换；0.1.23（`6fb7d55`）只修 package/Tauri/Cargo 版本一致性，没有新产品功能。同步时不要把 `translation.rs`（邮件正文逐段翻译）和它混在一起：界面语言只改 UI 文案，邮件原文、账号/自建文件夹名、日志与发布说明保持原文。若做，先移植 i18n 基础、语言设置、检查脚本和 Rust 偏好，再逐页给本地自有 UI（设置六分类、规则顺序动作、更新中心）补 key；上游 JSON 不能直接覆盖本地文案。

## 移植清单（上游基线 `v0.1.19`）

> 2026-10-21 更新：上游 `upstream/main` 已同步到 **`490a432`（上游 0.1.24）**。本清单仍是**已移植**基线（上游 `v0.1.19` = `037d7aa`）；
> 0.1.20 / 0.1.21 评估见 `docs/UPSTREAM_REVIEW_0_1_20_0_1_21.md`；0.1.22/0.1.23 中英文界面、0.1.24 的实时/钥匙串/表格/颜色与**旧清单缺口 0.1.15–0.1.18（含大模型双语翻译）**见 `docs/HANDOFF.md` 第四节。
> tag 提醒：`v0.1.19–v0.1.24` 是**上游**的，`v0.1.5–v0.1.9`、`v0.2.0`、`v0.2.1`、`0.2.2.0`、`0.2.2.1`、`v0.20.1/v0.20.2/v0.20.3` 是**我们的**。

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
---- 上游 v0.1.19 附件体系 + 富文本编辑器 ----
ff76ee4 feat: 移植上游草稿自有附件体系（后端）
        compose_files.rs + Compose.forwardSource/forwardFiles + Detail.originalHash；
        clear_drafts / open|close_compose_session / prepare_forward_files / read_body_images；
        发送与定时发送走 build_prepared_message；定时取消/重新编辑恢复附件选择。
c8b3b38 feat: 移植上游富文本写信编辑器（前端）
        rich-extensions/rich-body/rich-image-size + rich-toolbar/rich-search/
        rich-image-controls/rich-editor-boundary；保留 GreetingParagraph/BodyIndent、
        fonts.ts 仿宋 14pt 默认；转发改走 forwardSource，extract_attachments 已删除。
```

门禁基线（`8f8e94b`）：Rust 325 passed / 1 ignored、Vitest 385 passed (50 files)、tsc、prettier、check:ui、test:desktop 18、build 全绿。装机 PID `66677`（2026-10-17 夜）。

门禁基线（`c8b3b38`）：Rust 338 passed / 1 ignored、Vitest 378 passed (49 files)、tsc、prettier、check:ui、test:desktop 18、build 全绿。

手动验证（`c8b3b38`，`npm run desktop` 开发预览）：问候语顶格 + 首行缩进真实全角空格、签名预览、字体下拉默认「仿宋」/字号默认「14pt」、草稿关闭重开后问候语与正文原样载入、回车新段落自动补缩进、字体下拉可选中楷体等。

## 下一步（第③④步，用户已授权实收发）

1. 装机到 `/Applications/雁信.app`，用户用腾讯企业邮箱 ↔ QQ 邮箱互发，主题「雁信联调」。
2. 验证项：SMTP 接受、实际收取、正文图片内联（cid）、转发带原附件副本（`forwardFiles` 勾选/取消）、重新编辑已发送邮件的附件恢复。
3. 全量门禁 + 装机 + 更新本文件与开发记录。

## 遗留 / 待办（非本轮）

- 通知横幅优先级与可靠性不佳（用户「回头再说」）。
- 阅读器图片自定义菜单 / 左键选中（需原生 `WKUIDelegate`，独立高风险项）。
- 服务器删除被永久阻塞时，待删邮件会一直隐藏；考虑加「阻塞时重新露出」兜底。
- B 类：更新说明 Markdown 渲染、富文本增量（本轮已并入富文本移植）。
- C 类：全局网络代理（暂不做）。

56. **设置分类导航可以照搬上游，但分类内部要按本地组合归位；后台任务卡移植时别把内容留在折叠区外**。`settings-layout.tsx` 本身可直接用（纵向/横向 `Tabs` + `ResizeObserver < 900px` + `forceMount + hidden` 保留未保存输入），但内容必须重排：我们的 `StorageTools` 原本是「通知与启动 / 间隔与外观 / 存档校验 / 活动与诊断」四卡，本批拆成 `StorageTools`（前两卡）与 `ArchiveTools`（存档校验），「活动与诊断」不再作为一张卡，而是后台任务分类里的五张独立卡（完整保存任务 / 服务器状态同步 / 服务器文件夹操作 / 目录来源检查 / 最近活动）。移植 `TaskPanelHeader` 时：① 刷新按钮至少 600ms 可见且**不延迟发布新数据**，重复点击要防抖；② 四个面板新增 `defaultCollapsed`，`CardContent` 必须包进 `CollapsibleContent`（`archive-jobs` 连 `CardFooter` 一起包），否则折叠只收标题、内容仍露在外面；③ 折叠只影响渲染，面板的挂载与轮询不能停；④ 本地 `server-copy` 卡内还保留一层「任务（N）」折叠（上游已去掉），移植上游的面板测试时要先点开内层再断言。⑤ 写测试注意 `forceMount + hidden`：所有分类都在 DOM 里，`section.textContent` 会命中隐藏分类，断言「当前分类」要用 `.settings-section:not([hidden])` 或 `!panel.hidden` 取可见面板。

57. **`Collapsible asChild` 会把 `Card` 的 `data-slot` 覆盖成 `collapsible`，按 `[data-slot="card"]` 写的样式会静默失效**。`MailSignatures` / `InboxScope` 都是 `<Collapsible asChild><Card>…`，Radix 把 props 合并到 Card 根节点后，`data-slot="card"` 被 `data-slot="collapsible"` 顶掉。表现是签名卡「紧凑间距」规则（`padding-top/bottom:12px`）一直没生效、卡片显得很高。修法：按折叠根节点匹配 `[data-slot="collapsible"]:has(> .mail-signature-layout)`，内容区（`CollapsibleContent asChild` + `CardContent`）的 `data-slot` 同样会变成 `collapsible-content`，需要直接给业务类（如 `.mail-signature-layout`）写 padding。另：问候语预览要压扁时，注意 `[data-slot="collapsible"]:has(...) [data-slot="card-content"]`（0,3,0）会压过 `.greeting-preview-frame [data-slot="card-content"]`（0,2,0），覆盖规则要把 `:has()` 带上或改用更高特异性。

58. **规则条件扩展不是只改 `rules.rs`：`Mail` 必须先有 `cc` / `priority` / 元数据已知标记**。上游 0.1.20 的条件依赖 `Mail.cc`、`Mail.priority`、`header_metadata_known`、`attachment_metadata_known`；只搬匹配函数会编译不过或把缺失头误判成空值。做法：① `models.rs` 给四个字段加 `serde(default)`，旧 JSON 自动兼容；② `archive::parse` 解析 `Cc`、用 `priority_of()` 归一化三个优先级头，并把两个 metadata 标记置 true；③ `rules::match_state` 对正文/大小、抄送/优先级、附件元数据未知的情况返回 `NeedsBody`，不要返回 `NoMatch`；④ 预览用 `message_listing` 先判，`NeedsBody` 且 `saved_locally` 时再读完整记录，等待项在标题后追加「（等待完整邮件核对）」；⑤ **首次匹配快照**要在应用任何动作前捕获一次 `ObservedStatus`，整条规则链（含后续规则与 `apply_remote_rule`）都传这份快照，否则「未读 → 标已读 → 归类」会在第二步失效。旧存档不会自动获得 cc/priority：`PARSER_VERSION` 与头块回填属于原批次 4，未做之前旧邮件只能显示等待核对。前端日期条件必须用 shadcn `Calendar` + `Popover`（AGENTS 铁律），条件行用 `.condition-value` 让值控件吃掉剩余宽度。

59. **`TaskPanelHeader` 可以复用到任何「按组聚合」的列表，不限于后台任务卡**：把 `onRefresh` 改成可选、新增 `action` 插槽后，规则页的账号分组直接复用它——标题=账号/「全部账号」，说明=执行顺序提示，右侧放规则数 `Badge`，整块标题/说明都是 `CollapsibleTrigger`，箭头只做视觉提示。分组要 `defaultOpen`（规则列表默认展开），否则升级后所有规则会突然收起。注意 `Collapsible asChild` + `Card` 时根节点的 `data-slot` 会变成 `collapsible`（见第 57 条），分组卡的内边距要直接写在业务类 `.rule-group-card` / `.rule-group-body` 上。

60. **签名与「全部收件箱」可以完全复用 `TaskPanelHeader`，但要把原来的独立箭头按钮改成受控折叠**。给 `TaskPanelHeader` 加 `disabled`（签名未启用/无账号时整块不可点）与 `controls`（保留 `aria-controls` 指向内容区）；`Collapsible` 加 `onOpenChange={setExpanded}`，否则触发器只会改 Radix 内部状态、不会同步旧的 `expanded` 变量。右侧原来的箭头按钮删掉，账号选择/开关/状态文案放进 `action` 插槽，它们不在触发器里，仍然可独立操作。注意旧的测试用「展开签名设置」「展开收件箱范围」找按钮，统一后要改成「展开或收起 + 标题」。

61. **「服务器规则执行记录」不需要再套一层「命中记录」折叠行**：直接用 `Collapsible defaultOpen={false} asChild` + `Card` + `TaskPanelHeader`，标题/说明整块展开，刷新按钮在右侧；命中数写进说明（「当前 N 条」）即可。`TaskPanelHeader` 的 `onRefresh` 与 `action` 已改为可同时渲染，不要把二者写成互斥分支。账号分组卡头要上下居中时，给卡头 `align-items: center` + 对称 `padding-block`，并把触发器按钮的 `items-start` 覆盖为 `items-center`、箭头 `margin-top: 0`；不要只加 `padding-top`，否则标题/说明块会偏下。右侧操作区用 `min-w-[88px]` + 左对齐：箭头位置由固定宽度保证一致，「规则数徽标」和「刷新按钮」的左缘也对齐（实测同为 x=1254）；若用右对齐，两者宽度不同会让箭头和操作内容都错位。需要更矮的卡头时给 `TaskPanelHeader` 传 `compact`（gap、内边距、说明字号一起收紧），不要只改其中一项。

62. **解析版本迁移不要重解析整封旧邮件**。`PARSER_VERSION` 升到 5 后，`parser_version >= 3` 的旧记录只缺后来新增的头字段，应该只读原始 MIME 的头块（`mailparse::parse_headers`）回填 `cc` / `priority` 并置 `header_metadata_known=true`，不要重新解码正文和附件。只有 `< 3` 的旧结构才需要完整 `reparse`。没有原件的在线记录不能每启动一次就失败重试：推进 `parser_version`、保留 `header_metadata_known=false`，等真正下载后再核对。所有新写入路径都要写 `archive::PARSER_VERSION`，否则新邮件下次启动又会被迁移一遍。

63. **顺序动作引擎要把「展开」和「执行」分开**。`rules::expand` 只负责把一条规则变成步骤（非首步 id 加 `#N`，`stop` 只放最后一步）；`apply_configured_rules` 先扫描是否需要正文/完整保存，需要时把「剩余步骤」整体交给 `rule_runs`，不要只延迟当前动作。`RuleRun` 必须冻结配置哈希、来源证明、`ObservedStatus`、本地意图和已入队 operation id；每一步都按首次匹配快照判断已读/星标，否则「未读 → 标已读 → 归类」会在第二步失效。规则配置变更、账号/邮件删除、目录操作提交前都要检查/取消关联链，避免旧链在后台继续提交。

64. **`save` / `saveFolder` 在规则链里必须先完整落盘再归类**。复用 `archive_jobs` 时不要在规则事务外另开一个完整保存事务，否则游标回滚后可能留下「已保存但未归类」或重复保存。把 `complete_archive` 抽成 `complete_archive_in(&Connection, …)`，在规则引擎的同一事务里先 `queue_archive_in` → 标记 running → `complete_archive_in`，再更新邮件/游标。失败时整步回滚；`saveFolder` 已保存但用户改过文件夹时，任务置 `blocked` 并提示，而不是覆盖用户意图。

65. **更新历史是后端拉取 + 前端消毒渲染两条链**。Rust 侧只访问固定 GitHub API、SemVer 排序、限制页数/字节并缓存；不要信任响应里的任意分页 URL。前端 `marked` 的 HTML 必须经 DOMPurify 白名单，链接只允许 http(s)/mailto，图片只允许外部 URL，点击链接走 `open_mail_link`。我们本轮不跟全局代理，请求保持 `no_proxy()`；以后做代理时再把 `proxy::current()` 接回来，别把 `no_proxy` 和 `.proxy()` 同时留着。

66. **macOS 15 的后台应用可能拒绝 `NSApp.activateIgnoringOtherApps:`，全局快捷键恢复窗口不能只靠 `set_focus`**。表现：`⌘⌥` + 反引号后窗口 `AXMinimized=false`、`AXMain=true`，但进程 `frontmost=false`，前台仍是别的 App。修法分两层：① global shortcut handler 必须 `app.run_on_main_thread(...)` 后再 `show_main_window`，ObjC 激活调用不能留在插件的后台线程；② 主线程尝试 `NSRunningApplication.currentApplication activateWithOptions:` / `NSApplication.activate`，200ms 后**无条件**用 `/usr/bin/open -a <当前 .app>` 走 LaunchServices；不要用 `isActive` 判断，实测窗口已恢复、`isActive` 已为 true 时前台仍可能是 Finder。`open` 对已运行实例只发 reopen 事件，会再进单实例回调，但不会新建主窗口。另：`show_main_window` 里 `is_visible` 对「隐藏但未最小化」的窗口可能仍为 true，淡入判断要结合实际 `AXHidden`/`is_visible` 行为，避免恢复后停在 alpha 0。录制快捷键时还要先 `suspend_restore_shortcut` 注销当前全局键，否则按当前组合键会被全局热键先吞掉，设置按钮看起来“没反应”；取消/保存后由 `set_restore_shortcut` 重新注册。macOS 系统占用的组合键（如 ⌘ + 反引号 / ⌘⇧ + 反引号）无法录制，UI 要提示换一个；MacBook 上 ⌘⌥F2 实测录进去也不触发（F2 受 Fn/亮度层影响），默认不要用 F2。

67. **独立写信/阅读窗在前台时，Dock/托盘/全局快捷键必须完全无操作**。`show_main_window` 先查 `compose_windows` 和 `mail_windows` 里是否有 `is_focused()` 的窗口，有就直接返回，不能先 `emit` 再 `show`；否则会把写信窗挤到后面，用户看到的是「点 Dock 把窗口收起来了」。主窗隐藏再恢复时，悬浮条只由 `compose-windows-changed` / `mail-windows-changed` 的 `focused` 驱动，不要再用 `app-reopened` 把未聚焦项强行改成聚焦，否则恢复后「继续写信」会消失。悬浮条右侧 X：写信条在主窗弹「保存并关闭 / 不保存 / 取消」，空白邮件直接舍弃；阅读条调 `close_mail_window` 直接关。写信窗几何按主窗逻辑坐标（除以 `scale_factor`）居中，再用当前显示器工作区钳制，避免 Retina 下出屏。
