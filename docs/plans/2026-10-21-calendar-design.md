# 雁信日历（首版）设计

日期：2026-10-21
分支：`feat/calendar`
范围确认：纯本地 SQLite；月/周/日三视图 + 完整拖拽；简单重复 + 分段提醒；仅邮件转日程。

## 目标

在雁信内提供独立的日历页面，交互参考 Foxmail：左侧迷你月历与颜色分类，右侧月/周/日视图，支持新建、编辑、删除、拖拽改期与系统提醒。不触碰现有邮件双栏布局。

## 非目标

CalDAV / Google / Microsoft 同步、ICS 导入导出、会议邀请与参与人、单次例外或跳过、多日历账户、应用未运行时的后台提醒。

## 数据

`calendar_events`：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID |
| `title` | 必填，去首尾空白 |
| `start` / `end` | 定时事件为 RFC3339 UTC；全天事件为 `YYYY-MM-DD` |
| `all_day` | 0/1 |
| `location` / `notes` | 可空字符串 |
| `color` | `blue`/`green`/`orange`/`purple`/`gray` |
| `reminder_minutes` | NULL 表示不提醒 |
| `repeat` | `none`/`daily`/`weekly`/`monthly`/`yearly` |
| `created_at` / `updated_at` | RFC3339 UTC |

全天事件的 `end` 为包含当天的日期；定时事件 `end > start`。

`calendar_reminder_log(event_id, occurrence_start, fired_at, PRIMARY KEY(event_id, occurrence_start))` 用于防止同一实例重复提醒。

## 后端

- `calendar.rs`：`CalendarEvent`、`CalendarOccurrence`、范围查询、保存校验、删除、重复展开、到期提醒。
- 重复展开按原事件的本地时间递增（`chrono::Months` 处理月末回退），在 `from..to` 范围内返回实例；`key = "{id}@{occurrence_start}"`。
- 编辑与删除作用于整条系列；拖动重复实例时移动整条系列，并在前端确认一次。
- 命令：`list_calendar_events(from, to)`、`save_calendar_event(event)`、`delete_calendar_event(id)`。
- 后台线程每 30 秒检查到期提醒，复用 `notifications::show("日程提醒", ...)`；启动补查只提示 60 分钟内错过的实例，更早的写入日志后静默。
- 全天事件提醒时间为当天本地 09:00。

## 前端

- `CalendarPage` 独立页面，侧栏入口在「通讯录」之前。
- 左侧：shadcn `Calendar` 迷你月历 + 五个颜色勾选；勾选状态存 localStorage。
- 顶部：新建日程、今天、上一页/下一页、范围标题、日/周/月切换。
- 月视图：6×7 网格，事件色条，最多 3 条 + 「还有 N 项」，双击空白按 09:00–10:00 新建。
- 周/日视图：全天行 + 24 小时时间轴，15 分钟吸附，当前时间线，空白拖拽新建、事件拖动改期、上下拉改结束。
- 编辑弹窗使用 shadcn `Dialog`/`Input`/`Textarea`/`Select`/`Calendar`+`Popover`；字段：标题、全天、开始/结束、地点、备注、颜色、提醒、重复。
- 邮件阅读工具栏增加「创建日程」：带入主题、发件人与正文摘要，默认下一个整点，跳到日历并打开弹窗。
- 演示模式用 localStorage 保存示例事件，保持与真实命令同一套 `api.ts` 封装。

## 测试

- Rust：保存校验、范围重叠、全天事件、重复展开（日/周/月/年、月末）、提醒去重。
- 前端：日期网格与时间吸附工具函数、弹窗校验、演示数据读写。
- 门禁：`npx tsc --noEmit`、`npm run check:ui`、目标 vitest、目标 cargo test、`npm run build`。

## 风险

- 拖拽与缩放涉及 Pointer Events，需在演示模式和真实窗口分别验证。
- 全天事件不做 UTC 转换，跨时区显示以本地日期为准。
- 提醒依赖应用运行；应用关闭时不提醒，与首版范围一致。
