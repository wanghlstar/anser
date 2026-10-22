# Foxmail 会议功能分析（2026-10-22）

分析对象：`/Applications/Foxmail.app`（macOS 版 Foxmail 1.17.5）。

目的：确认 Foxmail 会议能力的边界，为雁信后续的会议邀请、导入导出和回复流程提供参考。只借鉴数据模型与交互，不复制代码，不提交 Foxmail 二进制或大规模反编译代码。

## 结论摘要

Foxmail 已实现一套完整的会议/日历体系：

- 接收 `text/calendar` 邮件邀请，解析 VEVENT，并在邮件上显示接受、待定、拒绝。
- 接受/待定/拒绝时询问是否发送答复回执，再通过普通邮件或 Exchange ActiveSync 发送响应。
- 支持会议取消、更新、重新编辑、删除，取消/更新会发对应邮件。
- 支持重复会议、全天会议、时区、组织者、参与者、`UID`/`SEQUENCE`、提醒时间。
- 与 Exchange ActiveSync、CalDAV、EventKit/CalendarStore 集成。
- 会议浮窗和月视图支持查看邮件、编辑、取消、接受/待定/拒绝。

对用户给出的企业微信/腾讯会议纯文本邮件：

- Foxmail 的会议识别主路径是 MIME `text/calendar`、Exchange/ActiveSync 日历项和 libical。
- 二进制里能找到 `Content-Type: text/calendar`、`BEGIN:VCALENDAR`、`MeetingRequest` 等字符串，但没有找到“会议时间”“腾讯会议”“企业微信会议”或 `meeting.tencent.com` 的专用解析字符串。
- 因此 Foxmail 很可能不会把这类纯文本会议信息自动转成日程。这是雁信可以差异化的增强点：从正文解析时间、入会链接和会议号，生成带提醒的本地日程，并关联原邮件。

## 功能矩阵

| 能力                | Foxmail      | 说明                                                    |
| ------------------- | ------------ | ------------------------------------------------------- |
| 接收 ICS 会议邀请   | 是           | `text/calendar` + libical，`mailType` 为会议请求        |
| 接受 / 待定 / 拒绝  | 是           | 浮窗和日历操作，可发送答复回执                          |
| 发送响应邮件        | 是           | 普通邮件路径与 ActiveSync 路径                          |
| 会议取消            | 是           | 删除日程时按 `sequence`/协议决定是否发取消邮件          |
| 会议更新            | 是           | `isUpdateMeeting`、重新载入原邮件编辑                   |
| 重复会议            | 是           | `meetingRecurrence`、`meetingRecurrenceCode`            |
| 全天会议 / 时区     | 是           | `isAllDayEvent`、`meetingTimeZone`                      |
| 组织者 / 参与者     | 是           | 浮窗显示组织者、参与者；`ATTENDEE`/`PARTSTAT`           |
| 会议提醒            | 是           | 会议开始时、5/10/15/30/45 分钟、1/2/4/8/12 小时、1 天前 |
| Exchange ActiveSync | 是           | `CommandSendMeetingResponse`、`MeetingResponse` XML     |
| CalDAV              | 是           | `FOXTempCalDavCalendarEvent.mm`、`comp-filter`          |
| 纯文本会议链接解析  | 很可能不支持 | 未发现对应解析字符串；需实测                            |

## 邮件数据模型

二进制中可见 `mail_meeting_info` 表及以下字段（按 SQL/符号整理）：

```text
isOutOfDate
startTime
endTime
timeZone
duration
location
isCancelled
associateCalendarId
isResponseRequested
meetingResponse
isSetReminder
reminderMinutesBeforeStart
isAllDayEvent
meetingUid
organizer
dtstamp
calendarUid
recurrence
attendees
sequence
isChineseLunar
```

`FMMail` / `FMMailImpl` 提供同名属性，以及：

```text
+[FMMail mailForResponseMeeting:]
+[FMMail mailForCancelMeeting:]
+[FMMail mailForReedit:]
-[FMMail isUpdateMeeting]
-[FMMail setIsUpdateMeeting:]
```

会议邮件类型：

```text
EIT_MEETING_REQUEST
EIT_MEETING_CANCELLATION
EIT_MEETING_RESPONSE
ns3__MeetingRequestMessageType
MeetingRequestMessageType
MeetingResponseMessageType
MeetingCancellationMessageType
```

`meetingUid` 用于查找原邮件（`-[FMMailService queryMailWithMeetingUid:withBlock:]`）；`sequence` 用于判断更新/取消是否过期。

## 响应流程

浮窗控制器 `MeetingFloatWindowController` 暴露：

```text
clickAccept:
clickTentative:
clickDecline:
clickCancelMeeting:
clickViewMail:
clickEdit:
responseToMeeting:
isTimeOutMeeting
getOrganizerName
getAttendeesShowName:
updateStateButton
```

响应前会询问是否发送答复回执：

```text
是否发送答复回执
需要发送答复回执给会议发起人吗？
发送 / 不发送
```

响应邮件格式（本地化确认）：

```text
已接受: %@
已拒绝: %@
暂时接受: %@

%@ 已接受此会议邀请。
%@ 已谢绝此会议邀请。
%@ 已暂时接受此会议邀请。
```

响应路径有两条：

```text
-[CalendarMonthDayView onMeetingFloatWindowResponseMeetingViaMail:withResponseType:]
-[CalendarMonthDayView onMeetingFloatWindowResponseMeetingViaActiveSync:withResponseType:]
```

ActiveSync 相关类型：

```text
FCActiveSyncMeetingResponseInfo
FCActiveSyncMeetingResponseResult
CommandSendMeetingResponse
CommandSendMeetingInvitation
<MeetingResponse>
http://synce.org/formats/airsync_wm5/meetingresponse
```

## 取消与更新

`CalendarMonthDayView` 的会议操作类型：

```text
0 = 查看邮件
1 = 编辑
2 = 删除
```

删除日程时：

- 先删除本地日历事件。
- 若 `sequence > 0` 或 `protocolType != 2`（2 为 Exchange），通过 `mailForCancelMeeting` 发送取消邮件。
- 取消邮件主题使用 `已取消: %@`（`calendar_editevent_window_has_canceled`）。
- 更新邮件主题使用 `已更新: %@`（`calendar_editevent_window_has_updated`）。

编辑会议时重新载入原邮件内容，设置 `isUpdateMeeting`，再打开写信窗口。

## 提醒

`meeting_alarm_entries` 的本地化取值：

```text
无
会议开始时
5分钟前
10分钟前
15分钟前
30分钟前
45分钟前
1小时前
2小时前
4小时前
8小时前
12小时前
1天前
```

## Exchange / ActiveSync / CalDAV

Foxmail 链接了 EventKit、CalendarStore，并包含 CalDAV/ActiveSync 代码。相关字符串包括：

```text
calendar:IsOnlineMeeting
calendar:MeetingWorkspaceUrl
meeting:IsOutOfDate
meeting:ResponseType
meeting:AssociatedCalendarItemId
OnlineMeetingConfLink
OnlineMeetingExternalLink
ErrorCalendarIsNotOrganizer
ErrorCalendarIsOrganizerForAccept
ErrorCalendarIsOrganizerForDecline
ErrorCalendarMeetingRequestIsOutOfDate
```

`FOXActiveSyncSyncCalendarEventTask` 还包含腾讯会议相关过滤方法名：

```text
getFilterNoTencentMeetingTime
saveFilterNoTencentMeetingTime:
removeNotTencentMeeting:
fox_filterCanceledMeeting:
```

这些方法说明 Foxmail 对 ActiveSync 日历项做过腾讯会议兼容处理，但不代表它解析纯文本会议邮件。

## 纯文本会议邮件（用户样例）

用户提供的典型正文：

```text
会议时间：2026/10/19 16:10-17:10 (GMT+08:00)

点击链接直接加入会议：
https://work.weixin.qq.com/webapp/tm/oraqwVNKFNh

#企业微信会议：876-510-038
```

```text
会议时间：2026/10/16 14:31-15:31 (GMT+08:00) 中国标准时间 - 北京

点击链接直接加入会议：
https://meeting.tencent.com/dm/lW9AXeR8BUpk

#腾讯会议：849-511-867

复制该信息，打开手机腾讯会议即可参与
```

判断：

- 在 Foxmail 二进制中没有找到针对这些文本格式的解析字符串。
- 能找到的会议识别入口是 `text/calendar`、libical、Exchange/ActiveSync。
- 这类邮件大概率只会作为普通邮件显示，不会自动生成日程。
- 若雁信支持，需要自行解析：时间、时区、入会链接、会议号、主题/发件人，并用邮件 ID 或链接做去重和更新匹配。

建议的解析规则（后续实现时再细化）：

```text
时间：会议时间：YYYY/M/D HH:mm-HH:mm
时区：(GMT+08:00) 或 中国标准时间 - 北京
链接：work.weixin.qq.com/webapp/tm/...
      meeting.tencent.com/dm/...
会议号：#企业微信会议：ddd-ddd-ddd
        #腾讯会议：ddd-ddd-ddd
```

生成的本地日程建议：

- 标题优先使用邮件主题（去掉“会议邀请”等前缀），没有则用“企业微信会议/腾讯会议”。
- 地点或备注保存入会链接和会议号。
- `UID` 由邮件 ID 或入会链接派生，保证重复收取/更新时不重复创建。
- 默认提醒沿用本地日程的“提前 15 分钟”，允许用户修改。
- 原邮件与日程双向关联，便于“查看邮件”。

## 对雁信导入导出的借鉴

1. ICS 会议邀请仍应使用标准 `VEVENT`，至少保留 `UID`、`SEQUENCE`、`DTSTAMP`、`ORGANIZER`、`ATTENDEE`、`PARTSTAT`、`RRULE`、`EXDATE`。
2. 回复邮件主题/正文可沿用 Foxmail 的格式，便于与其他客户端互通：
   - `已接受: 原主题`
   - `已拒绝: 原主题`
   - `暂时接受: 原主题`
3. 更新/取消用 `SEQUENCE` 递增，避免过期响应覆盖新状态。
4. 导入导出时保留会议元数据，但不要把纯文本会议链接强行写成标准 ICS 会议邀请；纯文本会议更适合作为本地日程 + 原邮件链接。
5. 会议提醒不依赖订阅日历的 VALARM；本地日程使用雁信自己的提醒轮询。

## 证据文件

`evidence/` 下保留了本轮分析产物：

| 文件                            | 内容                            |
| ------------------------------- | ------------------------------- |
| `analyze.json`                  | REA 对 Foxmail 二进制的总体分析 |
| `snapshot.json`                 | Hopper 快照元数据               |
| `strings-meeting.txt`           | 含 `meeting` 的 333 条字符串    |
| `zh-Hans-meeting.json`          | 简体中文本地化键值              |
| `search-protocol-meeting.json`  | 会议邮件协议格式键              |
| `search-procs-meeting.json`     | 271 个会议相关过程              |
| `decomp-handle-meeting.json`    | 会议操作入口伪代码              |
| `decomp-response-mail.json`     | 邮件响应入口伪代码              |
| `decomp-response-dispatch.json` | 响应分发入口伪代码              |
| `pseudo-handle-mails.txt`       | 会议邮件处理伪代码摘录          |

未提交：Foxmail 二进制、完整 `.app`、Hopper 数据库、大规模反编译源码。

## 复现命令

```bash
REA_HOPPER_STARTUP_TIMEOUT_MS=600000 npx -y rea-agents@latest analyze \
  /Applications/Foxmail.app \
  --snapshot /tmp/foxmail-rea/snapshot.json \
  --format json

npx -y rea-agents@latest search /Applications/Foxmail.app \
  --pattern meeting --kind procedures --format json

npx -y rea-agents@latest search /Applications/Foxmail.app \
  --pattern protocol_meeting --kind strings --format json
```

注意：REA/Hopper 调用可能留下 `cleanup_incomplete`。下一次调用前可执行：

```bash
killall "Hopper Disassembler" 2>/dev/null || true
rm -rf /tmp/rea-*
```

## 限制

- 结论来自二进制字符串、Objective-C 符号、本地化字符串和部分伪代码，不是完整源码审计。
- Hopper 的部分反编译返回 `cleanup_incomplete`，伪代码只作辅助证据。
- “Foxmail 不解析纯文本会议邮件”是基于缺少相关字符串和主路径的判断，最终应以实际邮件测试确认。
- Foxmail 版本、账号协议（IMAP/Exchange）不同，会议入口可能不同。
