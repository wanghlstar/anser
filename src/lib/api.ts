import {
  conversationIndex,
  conversationMessages,
  conversationSummaries,
} from "./conversations";
import { ruleMatches } from "./rule-match";
import { DemoPager, inInboxScope, inboxScopeFolders } from "./mail-pages";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { logPerf, perfQueryMeta } from "./perf-log";
import type {
  Account,
  Snapshot,
  Query,
  Mail,
  Rule,
  Detail,
  Compose,
  MailPage,
  MailNeighbor,
  RemoteFolder,
} from "./types";
import { makeDemo } from "./demo";
import { emptySignature } from "./signatures";
import { parseAddresses } from "./addresses";
import { addDays, parse, startOfWeek } from "date-fns";
import type {
  Address,
  Contact,
  ContactCandidate,
  ContactImportResult,
  OutboxRecord,
} from "./types";
import type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarSubscription,
} from "./types";
export const native = isTauri();
const key = "mail-desktop-demo-v1";
let demo: Snapshot | null = null;
const demoPager = new DemoPager();
export function isDemo() {
  return demo !== null;
}
export function enterDemo() {
  demo = makeDemo();
  demoPager.changed();
  localStorage.setItem(key, JSON.stringify(demo));
}
export function leaveDemo() {
  demo = null;
  demoPager.changed();
  localStorage.removeItem(key);
  localStorage.removeItem(key + "-drafts");
  localStorage.removeItem(key + "-contacts");
  localStorage.removeItem(key + "-preferences");
  localStorage.removeItem(key + "-outbox");
  localStorage.removeItem(key + "-calendar");
  localStorage.removeItem(key + "-calendar-exceptions");
  localStorage.removeItem(key + "-calendar-subscriptions");
  localStorage.removeItem(key + "-calendar-subscription-events");
  localStorage.removeItem(key + "-auto-start");
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const stored = localStorage.key(i);
    if (stored?.startsWith(key + "-signature-"))
      localStorage.removeItem(stored);
  }
}
export function restoreDemo() {
  try {
    const data = localStorage.getItem(key);
    if (data) {
      demo = JSON.parse(data);
      demoPager.changed();
    }
  } catch {
    localStorage.removeItem(key);
  }
}
const empty = (): Snapshot => ({
  accounts: [],
  messages: [],
  rules: [],
  folders: [],
  stats: { total: 0, unread: 0, saved: 0, bytes: 0 },
  logs: [],
  dataDir: "请在桌面客户端中管理本地存档",
  matched: 0,
});
export async function snapshot(query: Query): Promise<Snapshot> {
  if (demo) {
    const all = demo.messages;
    const inboxScope = inboxScopeFolders(demo.accounts);
    const messages = all.filter(
      (m) =>
        (!query.accountId || m.accountId === query.accountId) &&
        (!query.folder || m.localFolder === query.folder) &&
        (!query.remoteFolder || m.sourceFolder === query.remoteFolder) &&
        (query.view !== "local" || m.savedLocally !== false) &&
        (query.view === "trash"
          ? m.trashed
          : query.remoteFolder === "Trash" || !m.trashed) &&
        (!query.unreadOnly || !m.isRead) &&
        (!query.starredOnly || m.starred) &&
        (!query.attachmentsOnly || m.hasAttachments) &&
        ((query.view !== "all" && query.view !== "unread") ||
          inInboxScope(inboxScope, m)) &&
        (query.view !== "unread" || !m.isRead) &&
        (query.view !== "starred" || m.starred) &&
        (query.view !== "sent" || m.sourceFolder === "Sent") &&
        (query.searchField &&
        ["subject", "sender", "recipients", "body"].includes(query.searchField)
          ? m[query.searchField as "subject" | "sender" | "recipients" | "body"]
          : `${m.subject} ${m.sender} ${m.recipients} ${m.body}`
        )
          .toLowerCase()
          .includes(query.search.toLowerCase()),
    );
    messages.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const summaries =
      query.listMode === "messages"
        ? messages.map((mail) => ({
            ...mail,
            conversationId: undefined,
            conversationCount: 1,
          }))
        : conversationSummaries(messages, all);
    return {
      ...structuredClone({ ...demo, messages: [] }),
      messages: structuredClone(summaries.slice(0, query.limit)),
      matched: summaries.length,
      folders: [...new Set(all.map((m) => m.localFolder))].filter(
        (f) => f !== "全部存档",
      ),
      stats: {
        total: all.length,
        saved: all.filter((m) => m.savedLocally !== false).length,
        unread: all.filter((m) => !m.isRead && !m.trashed).length,
        bytes: all
          .filter((m) => m.savedLocally !== false)
          .reduce((n, m) => n + m.size, 0),
      },
    };
  }
  return native ? invoke("snapshot", { query }) : empty();
}
function pageRequest(query: Query, cursor = "") {
  return {
    query,
    cursor,
    dateFrom: query.dateFrom || "",
    dateBefore: query.dateBefore || "",
  };
}
export async function cachedPage(): Promise<MailPage | null> {
  if (!native) return null;
  try {
    return await invoke<MailPage | null>("cached_page");
  } catch {
    return null;
  }
}
export async function mailPage(query: Query, cursor = ""): Promise<MailPage> {
  if (demo) return demoPager.page(demo, query, cursor);
  if (native) {
    const started = performance.now();
    try {
      const result = await invoke<MailPage>("mail_page", {
        request: pageRequest(query, cursor),
      });
      logPerf(
        "mail_page",
        {
          ...perfQueryMeta(query),
          cursor: !!cursor,
          messages: result.messages.length,
          matched: result.matched,
        },
        performance.now() - started,
      );
      return result;
    } catch (error) {
      logPerf(
        "mail_page_error",
        { ...perfQueryMeta(query), error: String(error) },
        performance.now() - started,
      );
      throw error;
    }
  }
  return {
    ...empty(),
    nextCursor: null,
    revision: 0,
    reset: false,
    bodyCoverage: { known: 0, unknown: 0 },
  };
}
export async function mailNeighbor(
  query: Query,
  id: string,
  direction: "previous" | "next",
): Promise<MailNeighbor> {
  if (demo) return demoPager.neighbor(demo, query, id, direction);
  if (native) {
    const started = performance.now();
    try {
      const result = await invoke<MailNeighbor>("mail_neighbor", {
        request: pageRequest(query),
        id,
        direction,
      });
      logPerf(
        "mail_neighbor",
        { ...perfQueryMeta(query), direction, found: !!result.mail },
        performance.now() - started,
      );
      return result;
    } catch (error) {
      logPerf(
        "mail_neighbor_error",
        { ...perfQueryMeta(query), direction, error: String(error) },
        performance.now() - started,
      );
      throw error;
    }
  }
  return { mail: null, revision: 0 };
}
const calendarKey = key + "-calendar";

function demoCalendarEvents(): CalendarEvent[] {
  const stored = localStorage.getItem(calendarKey);
  if (stored) return JSON.parse(stored) as CalendarEvent[];
  const base = startOfWeek(new Date(), { weekStartsOn: 1 });
  const at = (day: number, hour: number, minute = 0) => {
    const date = addDays(base, day);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const now = new Date().toISOString();
  const events: CalendarEvent[] = [
    {
      id: "demo-calendar-weekly",
      title: "项目周会",
      start: at(0, 10),
      end: at(0, 11),
      allDay: false,
      location: "线上会议",
      notes: "同步本周进度与风险。",
      color: "blue",
      reminderMinutes: 15,
      repeat: "none",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-calendar-design",
      title: "设计评审",
      start: at(2, 14),
      end: at(2, 15, 30),
      allDay: false,
      location: "会议室 A",
      notes: "日历首版交互走查。",
      color: "purple",
      reminderMinutes: 30,
      repeat: "none",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-calendar-focus",
      title: "专注时间",
      start: at(3, 9),
      end: at(3, 12),
      allDay: false,
      location: "",
      notes: "",
      color: "green",
      reminderMinutes: null,
      repeat: "none",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-calendar-holiday",
      title: "团队活动日",
      start: at(5, 0).slice(0, 10),
      end: at(5, 0).slice(0, 10),
      allDay: true,
      location: "西山",
      notes: "全天活动。",
      color: "orange",
      reminderMinutes: 1440,
      repeat: "none",
      createdAt: now,
      updatedAt: now,
    },
  ];
  localStorage.setItem(calendarKey, JSON.stringify(events));
  return events;
}

function saveDemoCalendar(events: CalendarEvent[]) {
  localStorage.setItem(calendarKey, JSON.stringify(events));
}

function demoCalendarExceptions(): Record<string, string[]> {
  try {
    return JSON.parse(
      localStorage.getItem(calendarKey + "-exceptions") || "{}",
    ) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function saveDemoCalendarExceptions(value: Record<string, string[]>) {
  localStorage.setItem(calendarKey + "-exceptions", JSON.stringify(value));
}

const subscriptionKey = key + "-calendar-subscriptions";
const subscriptionEventKey = key + "-calendar-subscription-events";

function demoCalendarSubscriptions(): CalendarSubscription[] {
  try {
    return JSON.parse(
      localStorage.getItem(subscriptionKey) || "[]",
    ) as CalendarSubscription[];
  } catch {
    return [];
  }
}

function saveDemoCalendarSubscriptions(list: CalendarSubscription[]) {
  localStorage.setItem(subscriptionKey, JSON.stringify(list));
}

function demoSubscriptionEvents(): CalendarEvent[] {
  try {
    return JSON.parse(
      localStorage.getItem(subscriptionEventKey) || "[]",
    ) as CalendarEvent[];
  } catch {
    return [];
  }
}

function saveDemoSubscriptionEvents(events: CalendarEvent[]) {
  localStorage.setItem(subscriptionEventKey, JSON.stringify(events));
}

function demoHolidayIcs() {
  const events = [
    ["20260101", "一月一日"],
    ["20260217", "农历年初一"],
    ["20260403", "耶稣受难节"],
    ["20260701", "香港特别行政区成立纪念日"],
    ["20261001", "国庆日"],
    ["20261225", "圣诞节"],
  ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anser Demo//HK Holidays//EN",
    ...events.flatMap(([day, title]) => [
      "BEGIN:VEVENT",
      `UID:${day}@demo.hk`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${day}`,
      `SUMMARY:${title}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

function demoChinaHolidayIcs() {
  const events = [
    ["20260101", "20260104", "元旦（休）", "WORK-HOLIDAY"],
    ["20260215", "20260224", "春节（休）", "WORK-HOLIDAY"],
    ["20260214", "20260215", "春节（班）", "ALTERNATE-WORKDAY"],
    ["20260404", "20260407", "清明（休）", "WORK-HOLIDAY"],
    ["20260501", "20260506", "劳动节（休）", "WORK-HOLIDAY"],
    ["20260619", "20260622", "端午（休）", "WORK-HOLIDAY"],
    ["20260925", "20260928", "中秋（休）", "WORK-HOLIDAY"],
    ["20261001", "20261008", "国庆（休）", "WORK-HOLIDAY"],
    ["20260105", "20260106", "小寒", ""],
  ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anser Demo//CN Holidays//ZH",
    ...events.flatMap(([start, end, title, special]) => [
      "BEGIN:VEVENT",
      `UID:${start}-${title}@demo.cn`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${title}`,
      ...(special ? [`X-APPLE-SPECIAL-DAY:${special}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

function demoCalendarInRange(
  events: CalendarEvent[],
  from: string,
  to: string,
): CalendarOccurrence[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const exceptions = demoCalendarExceptions();
  const enabled = new Set(
    demoCalendarSubscriptions()
      .filter((item) => item.enabled)
      .map((item) => item.id),
  );
  const all = [
    ...events,
    ...demoSubscriptionEvents().filter(
      (event) => event.subscriptionId && enabled.has(event.subscriptionId),
    ),
  ];
  return all
    .flatMap((event) => {
      if ((exceptions[event.id] || []).includes(event.start)) return [];
      const start = event.allDay
        ? parse(event.start, "yyyy-MM-dd", new Date())
        : new Date(event.start);
      const end = event.allDay
        ? parse(event.end, "yyyy-MM-dd", new Date())
        : new Date(event.end);
      const endExclusive = event.allDay ? addDays(end, 1) : end;
      if (start >= toDate || endExclusive <= fromDate) return [];
      return [
        {
          key: `${event.id}@${event.start}`,
          event,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
        },
      ];
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

export async function call<T = void>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (demo) {
    let result: unknown;
    switch (command) {
      case "mail_signature":
        result =
          JSON.parse(
            localStorage.getItem(key + "-signature-" + args.accountId) ||
              "null",
          ) || emptySignature();
        break;
      case "save_mail_signature":
        localStorage.setItem(
          key + "-signature-" + args.accountId,
          JSON.stringify(args.signature),
        );
        result = null;
        break;
      case "save_inbox_folders": {
        const account = demo.accounts.find((a) => a.id === args.accountId);
        if (!account) throw new Error("账号不存在");
        const folders = (args.folders as string[] | null) ?? [];
        account.inboxFolders = folders.length ? folders : null;
        result = structuredClone(account);
        break;
      }
      case "account_folders": {
        const names = new Set([
          "INBOX",
          "Sent",
          "Drafts",
          // 删除跟随账号：示例数据也提供一个服务器废纸篓，删除后落到这里
          "Trash",
          ...demo.messages
            .filter((m) => m.accountId === args.id)
            .map((m) => m.sourceFolder),
        ]);
        result = [...names].map((name) => ({
          accountId: String(args.id),
          name,
          displayName:
            (
              {
                INBOX: "收件箱",
                Sent: "已发送",
                Drafts: "草稿",
                Trash: "已删除",
              } as Record<string, string>
            )[name] || name,
          delimiter: "/",
          selectable: true,
          // 与真实账号一致的角色标记：已发送/草稿没有未读概念，草稿文件夹列本地草稿
          roles: (
            {
              INBOX: ["inbox"],
              Sent: ["sent"],
              Drafts: ["drafts"],
              Trash: ["trash"],
            } as Record<string, string[]>
          )[name] as RemoteFolder["roles"],
        }));
        break;
      }
      case "sync_remote_folder":
        result = 0;
        break;
      case "server_trash_count": {
        const folder = String(args.folder || "Trash");
        result = demo.messages.filter(
          (m) => m.accountId === args.accountId && m.sourceFolder === folder,
        ).length;
        break;
      }
      case "trash_clear_summary": {
        const folder = String(args.folder || "Trash");
        result = {
          server: demo.messages.filter(
            (m) => m.accountId === args.accountId && m.sourceFolder === folder,
          ).length,
          local: demo.messages.filter(
            (m) =>
              m.accountId === args.accountId &&
              m.trashed &&
              m.sourceFolder !== folder,
          ).length,
        };
        break;
      }
      case "empty_server_trash": {
        const folder = String(args.folder || "Trash");
        const server = demo.messages.filter(
          (m) => m.accountId === args.accountId && m.sourceFolder === folder,
        ).length;
        const local = demo.messages.filter(
          (m) =>
            m.accountId === args.accountId &&
            m.trashed &&
            m.sourceFolder !== folder,
        ).length;
        demo.messages = demo.messages.filter(
          (m) =>
            !(
              m.accountId === args.accountId &&
              (m.sourceFolder === folder ||
                (m.trashed && m.sourceFolder !== folder))
            ),
        );
        result = { server, local };
        break;
      }

      case "mail_conversation": {
        const selected = demo.messages.find((m) => m.id === args.id);
        if (!selected) throw new Error("邮件不存在");
        result = structuredClone(conversationMessages(demo.messages, selected));
        break;
      }
      case "mail_metadata":
      case "mail_detail":
        result = {
          mail: {
            ...structuredClone(demo.messages.find((m) => m.id === args.id)!),
            conversationId: conversationIndex(demo.messages).get(
              String(args.id),
            ),
            conversationCount: conversationMessages(
              demo.messages,
              demo.messages.find((m) => m.id === args.id)!,
            ).length,
          },
          html: "",
          attachments: [],
        } satisfies Detail;
        if (command === "mail_metadata")
          result = { ...(result as Detail).mail, body: "" };
        break;
      case "update_mail": {
        const selected = demo.messages.find((m) => m.id === args.id)!;
        if (args.action === "delete") {
          demo.messages = demo.messages.filter(
            (m) =>
              m.id !== selected.id &&
              !(
                !!selected.messageId &&
                m.messageId === selected.messageId &&
                m.accountId === selected.accountId
              ),
          );
          break;
        }
        for (const m of demo.messages.filter(
          (m) =>
            m.id === selected.id ||
            (!!selected.messageId &&
              m.messageId === selected.messageId &&
              m.accountId === selected.accountId),
        )) {
          if (args.action === "read") m.isRead = args.value === "true";
          if (args.action === "star") m.starred = args.value === "true";
          if (args.action === "trash") {
            const trashed = args.value === "true";
            m.trashed = trashed;
            // 演示数据也跟随账号：删除后落到服务器废纸篓，恢复回收件箱
            if (trashed && m.sourceFolder !== "Trash") m.sourceFolder = "Trash";
            if (!trashed && m.sourceFolder === "Trash")
              m.sourceFolder = "INBOX";
          }
          if (args.action === "folder") m.localFolder = String(args.value);
        }
        break;
      }
      case "save_rules":
        demo.rules = args.rules as Rule[];
        break;
      case "folder_settings":
        result = { folders: await call("account_folders", args), mappings: [] };
        break;
      case "archive_jobs":
        result = [];
        break;
      case "queue_archives":
      case "archive_job_action":
        throw new Error(
          "演示模式不下载服务器原件，请在桌面客户端中使用真实邮箱测试补存",
        );
      case "cancel_retention_inspection":
        return undefined as T;
      case "inspect_retention_budget":
        throw new Error(
          "示例邮箱不连接真实服务器或读取磁盘，请在桌面客户端中检查预算",
        );
      case "retention_settings": {
        const account = demo.accounts.find((a) => a.id === args.id);
        if (!account) throw new Error("账号不存在");
        const folders = await call<import("./types").RemoteFolder[]>(
          "account_folders",
          args,
        );
        const overrides = JSON.parse(
          localStorage.getItem(`${key}:retention:${args.id}`) || "[]",
        ) as import("./types").FolderRetention[];
        const mails = demo.messages.filter((m) => m.accountId === account.id);
        const saved = mails.filter((m) => m.savedLocally !== false);
        const wanted = folders
          .filter((f) => f.selectable)
          .filter((f) => {
            const override = overrides.find((o) => o.folder === f.name);
            return (
              (override?.saveLocally ?? account.saveLocally !== false) &&
              (!(f.roles || []).some((r) => ["junk", "trash"].includes(r)) ||
                override?.saveLocally === true)
            );
          });
        result = {
          account,
          defaultSave: account.saveLocally !== false,
          folders,
          overrides,
          summary: {
            dataDir: demo.dataDir,
            known: mails.length,
            saved: saved.length,
            savedBytes: saved.reduce((n, m) => n + m.size, 0),
            pending: mails.filter(
              (m) =>
                m.savedLocally === false &&
                wanted.some((f) => f.name === m.sourceFolder),
            ).length,
            failedJobs: 0,
            lastSync: account.lastSync,
            receiveError: account.error,
            warning: null,
          },
        };
        break;
      }
      case "save_retention": {
        const account = args.account as Account;
        const days = account.serverRetentionDays;
        if (
          days != null &&
          (!Number.isInteger(days) || days < 1 || days > 3650)
        )
          throw new Error("服务器保留期请填写 1–3650 天，未知时留空");
        localStorage.setItem(
          `${key}:retention:${account.id}`,
          JSON.stringify(args.overrides),
        );
        const current = demo.accounts.find((a) => a.id === account.id);
        if (current) current.serverRetentionDays = days ?? null;
        break;
      }
      case "preview_rule": {
        const rule = args.rule as Rule;
        const actions = rule.action.split(/[+,,;；]/).map((a) => a.trim());
        const isRemote = actions.some(
          (a) => a === "serverCopy" || a === "serverMove",
        );
        result = demo.messages
          .filter(
            (m) =>
              ruleMatches({ ...rule, enabled: true }, m) &&
              (!isRemote ||
                !rule.sourceFolder ||
                m.sourceFolder === rule.sourceFolder),
          )
          .map((m) => m.subject);
        break;
      }
      case "run_rules": {
        const actionsOf = (r: Rule) =>
          r.action
            .split(/[+,,;；]/)
            .map((a) => a.trim())
            .filter(Boolean);
        if (
          demo.rules.some(
            (r) =>
              r.enabled &&
              actionsOf(r).some(
                (a) => a === "serverCopy" || a === "serverMove",
              ),
          )
        )
          throw new Error("演示模式不执行服务器规则，请在真实桌面预览中测试");
        let count = 0;
        for (const m of demo.messages) {
          for (const r of demo.rules) {
            if (ruleMatches(r, m)) {
              for (const action of actionsOf(r)) {
                if (action === "folder") m.localFolder = r.destination;
                if (action === "read") m.isRead = true;
                if (action === "unread") m.isRead = false;
                if (action === "star") m.starred = true;
                if (action === "trash") m.trashed = true;
              }
              count++;
              if (r.stop) break;
            }
          }
        }
        result = count;
        break;
      }
      case "save_draft": {
        const list = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        const draft = args.draft as Compose;
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify([draft, ...list.filter((d) => d.id !== draft.id)]),
        );
        break;
      }
      case "list_drafts":
        result = JSON.parse(localStorage.getItem(key + "-drafts") || "[]");
        break;
      case "delete_draft": {
        const list = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify(list.filter((d) => d.id !== args.id)),
        );
        break;
      }
      case "clear_drafts": {
        const list = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        const ids = new Set(
          (args.drafts as Compose[]).map((draft) => draft.id),
        );
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify(list.filter((draft) => !ids.has(draft.id))),
        );
        result = { deleted: ids.size, cleanupPending: 0 };
        break;
      }
      case "freeze_account": {
        const a = demo.accounts.find((a) => a.id === args.id);
        if (a) {
          a.readOnly = true;
          a.enabled = false;
          a.frozenAt = new Date().toISOString();
        }
        break;
      }
      case "unfreeze_account": {
        const a = demo.accounts.find((a) => a.id === args.id);
        if (a) {
          a.readOnly = false;
          a.frozenAt = null;
        }
        break;
      }
      case "create_segment": {
        const source = demo.accounts.find((a) => a.id === args.sourceId);
        if (!source) throw new Error("账号不存在");
        const segment = structuredClone(source);
        segment.id = `segment-${Date.now()}`;
        segment.name = String(args.name || `${source.name} 新分段`);
        segment.enabled = true;
        segment.readOnly = false;
        segment.frozenAt = null;
        segment.syncSince = (args.syncSince as string | null) || null;
        segment.lastSync = null;
        segment.error = null;
        demo.accounts.push(segment);
        result = structuredClone(segment);
        break;
      }
      case "account_action":
        if (args.remove) {
          demo.accounts = demo.accounts.filter((a) => a.id !== args.id);
          if (args.purge)
            demo.messages = demo.messages.filter(
              (m) => m.accountId !== args.id,
            );
        } else {
          const a = demo.accounts.find((a) => a.id === args.id);
          if (a) a.enabled = !a.enabled;
        }
        break;
      case "edit_account": {
        const account = args.account as Snapshot["accounts"][number];
        const index = demo.accounts.findIndex((a) => a.id === account.id);
        if (index < 0) throw new Error("账号不存在");
        if (demo.accounts[index].email !== account.email)
          throw new Error("修改邮箱地址请添加新账号");
        demo.accounts[index] = structuredClone(account);
        break;
      }
      case "list_contacts":
        result = JSON.parse(localStorage.getItem(key + "-contacts") || "[]");
        break;
      case "contact_history":
        result = [] satisfies ContactCandidate[];
        break;
      case "contact_blacklist":
        result = JSON.parse(
          localStorage.getItem(key + "-contact-blacklist") || "[]",
        );
        break;
      case "set_contact_ignored": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contact-blacklist") || "[]",
        ) as string[];
        const email = String(args.email || "")
          .trim()
          .toLowerCase();
        const next = new Set(list);
        if (args.ignored) next.add(email);
        else next.delete(email);
        localStorage.setItem(
          key + "-contact-blacklist",
          JSON.stringify([...next].sort()),
        );
        break;
      }
      case "import_contacts": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const candidates = args.candidates as ContactCandidate[];
        const existing = new Set(list.map((c) => c.email.toLowerCase()));
        const blocked = new Set(
          JSON.parse(
            localStorage.getItem(key + "-contact-blacklist") || "[]",
          ) as string[],
        );
        let imported = 0;
        let skipped = 0;
        for (const candidate of candidates) {
          const email = candidate.email.trim().toLowerCase();
          if (!email || existing.has(email) || blocked.has(email)) {
            skipped += 1;
            continue;
          }
          existing.add(email);
          list.push({
            id: crypto.randomUUID(),
            name: candidate.name || candidate.email,
            email: candidate.email,
          });
          imported += 1;
        }
        localStorage.setItem(key + "-contacts", JSON.stringify(list));
        result = { imported, skipped } satisfies ContactImportResult;
        break;
      }
      case "save_contact": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const c = args.contact as Contact;
        if (
          list.some(
            (x) =>
              x.id !== c.id && x.email.toLowerCase() === c.email.toLowerCase(),
          )
        )
          throw new Error("该邮箱已存在于通讯录中");
        localStorage.setItem(
          key + "-contacts",
          JSON.stringify([c, ...list.filter((x) => x.id !== c.id)]),
        );
        break;
      }
      case "delete_contact": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        localStorage.setItem(
          key + "-contacts",
          JSON.stringify(list.filter((x) => x.id !== args.id)),
        );
        break;
      }
      case "list_calendar_events":
        result = demoCalendarInRange(
          demoCalendarEvents(),
          args.from as string,
          args.to as string,
        );
        break;
      case "save_calendar_event": {
        const event = args.event as CalendarEvent;
        const events = demoCalendarEvents();
        const id = event.id || crypto.randomUUID();
        const existing = events.find((item) => item.id === id);
        const saved: CalendarEvent = {
          ...event,
          id,
          title: event.title.trim(),
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (!saved.title) throw new Error("请填写日程标题");
        saveDemoCalendar([saved, ...events.filter((item) => item.id !== id)]);
        result = saved;
        break;
      }
      case "save_meeting_event": {
        const event = args.event as CalendarEvent;
        const events = demoCalendarEvents();
        const existing = events.find(
          (item) =>
            item.sourceMailId && item.sourceMailId === event.sourceMailId,
        );
        const id = existing?.id || event.id || crypto.randomUUID();
        const saved: CalendarEvent = {
          ...event,
          id,
          title: event.title.trim(),
          createdAt:
            existing?.createdAt || event.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (!saved.title) throw new Error("请填写日程标题");
        if (!saved.sourceMailId) throw new Error("会议日程缺少原邮件");
        saveDemoCalendar([saved, ...events.filter((item) => item.id !== id)]);
        result = saved;
        break;
      }
      case "delete_calendar_event": {
        const events = demoCalendarEvents().filter(
          (item) => item.id !== args.id,
        );
        saveDemoCalendar(events);
        break;
      }
      case "all_calendar_events":
        result = demoCalendarEvents();
        break;
      case "skip_calendar_occurrence": {
        const exceptions = demoCalendarExceptions();
        const eventId = String(args.eventId);
        const start = String(args.occurrenceStart);
        exceptions[eventId] = [...(exceptions[eventId] || []), start];
        saveDemoCalendarExceptions(exceptions);
        break;
      }
      case "list_calendar_subscriptions":
        result = demoCalendarSubscriptions();
        break;
      case "save_calendar_subscription": {
        const input = args.subscription as CalendarSubscription;
        const list = demoCalendarSubscriptions();
        const existing = list.find((item) => item.id === input.id);
        const id = input.id || crypto.randomUUID();
        const now = new Date().toISOString();
        const saved: CalendarSubscription = {
          ...input,
          id,
          name: input.name.trim(),
          url: input.url.trim(),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          lastSyncedAt: existing?.lastSyncedAt || "",
          lastError: existing?.lastError || "",
        };
        if (!saved.name) throw new Error("请填写订阅名称");
        saveDemoCalendarSubscriptions([
          saved,
          ...list.filter((item) => item.id !== id),
        ]);
        result = saved;
        break;
      }
      case "set_calendar_subscription_enabled": {
        const list = demoCalendarSubscriptions();
        const id = String(args.id);
        saveDemoCalendarSubscriptions(
          list.map((item) =>
            item.id === id
              ? {
                  ...item,
                  enabled: Boolean(args.enabled),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        break;
      }
      case "delete_calendar_subscription": {
        const id = String(args.id);
        saveDemoCalendarSubscriptions(
          demoCalendarSubscriptions().filter((item) => item.id !== id),
        );
        saveDemoSubscriptionEvents(
          demoSubscriptionEvents().filter(
            (event) => event.subscriptionId !== id,
          ),
        );
        break;
      }
      case "replace_calendar_subscription_events": {
        const id = String(args.id);
        const now = new Date().toISOString();
        const imported = (args.events as CalendarEvent[]).map(
          (event, index) => ({
            ...event,
            id: `${id}:${event.id || index}`,
            subscriptionId: id,
            createdAt: now,
            updatedAt: now,
          }),
        );
        saveDemoSubscriptionEvents([
          ...demoSubscriptionEvents().filter(
            (event) => event.subscriptionId !== id,
          ),
          ...imported,
        ]);
        saveDemoCalendarSubscriptions(
          demoCalendarSubscriptions().map((item) =>
            item.id === id
              ? { ...item, lastSyncedAt: now, lastError: "", updatedAt: now }
              : item,
          ),
        );
        result = imported.length;
        break;
      }
      case "mark_calendar_subscription_error": {
        const id = String(args.id);
        saveDemoCalendarSubscriptions(
          demoCalendarSubscriptions().map((item) =>
            item.id === id
              ? {
                  ...item,
                  lastError: String(args.message),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        break;
      }
      case "fetch_calendar_subscription":
        if (
          String(args.url).trim().replace(/\/+$/, "") ===
          "https://calendars.icloud.com/holidays/cn_zh.ics"
        ) {
          result = demoChinaHolidayIcs();
          break;
        }
        if (String(args.url).includes("1823.gov.hk")) {
          result = demoHolidayIcs();
          break;
        }
        throw new Error(
          "演示模式只提供香港和中国大陆节假日示例订阅，请连接桌面客户端后添加其他地址。",
        );
      case "apple_calendar_status":
        result = "unavailable";
        break;
      case "connect_apple_calendar":
      case "list_apple_calendars":
      case "list_apple_calendar_events":
        throw new Error("演示模式不支持读取 Apple 日历，请使用桌面客户端。");
      case "contact_suggestions": {
        const saved = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const addresses = [
          ...demo.messages.flatMap((m) => parseAddresses(m.sender)),
          ...saved,
        ];
        result = [
          ...new Map(addresses.map((a) => [a.email.toLowerCase(), a])).values(),
        ] satisfies Address[];
        break;
      }
      case "folder_health":
      case "directory_operations":
      case "rule_executions":
      case "rule_runs":
        result = [];
        break;
      case "copy_sources":
        result = [
          demo.messages.find((m) => m.id === args.id)?.sourceFolder,
        ].filter(Boolean);
        break;
      case "queue_server_copy":
      case "queue_server_move":
      case "directory_operation_action":
      case "retry_rule_execution":
        throw new Error(
          "演示模式不执行服务器文件夹操作，请在真实桌面预览中测试",
        );
      case "server_operations":
        result = { pending: 0, blocked: 0, completed: 0, items: [] };
        break;
      case "list_outbox":
        result = JSON.parse(localStorage.getItem(key + "-outbox") || "[]");
        break;
      case "delete_outbox": {
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        const target = records.find((r) => r.id === args.id);
        if (!target) throw new Error("发送记录不存在或已删除，请刷新后重试");
        if (
          ["sending", "scheduled", "overdue", "paused"].includes(target.status)
        )
          throw new Error("这封邮件还在发送流程中，请先取消计划或等待结果");
        localStorage.setItem(
          key + "-outbox",
          JSON.stringify(records.filter((r) => r.id !== args.id)),
        );
        break;
      }
      case "clear_sent_outbox": {
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        let deleted = 0;
        for (const record of records) if (record.status === "sent") deleted++;
        localStorage.setItem(
          key + "-outbox",
          JSON.stringify(records.filter((r) => r.status !== "sent")),
        );
        result = deleted;
        break;
      }
      case "schedule_mail": {
        const draft = args.draft as Compose;
        if (
          new Date(args.scheduledAt as string).getTime() <= Date.now() ||
          !Number.isFinite(new Date(args.scheduledAt as string).getTime())
        )
          throw new Error("请选择未来的发送时间");
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        if (records.some((r) => r.id === draft.id))
          throw new Error("已有发送计划，请在发送记录中检查");
        records.unshift({
          id: draft.id,
          draft,
          status: "scheduled",
          scheduledAt: args.scheduledAt as string,
          updatedAt: new Date().toISOString(),
          archived: false,
          error: "",
        });
        localStorage.setItem(key + "-outbox", JSON.stringify(records));
        const drafts = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify(drafts.filter((d) => d.id !== draft.id)),
        );
        break;
      }
      case "reschedule_mail":
      case "cancel_schedule": {
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        const record = records.find((r) => r.id === args.id);
        if (
          !record ||
          !["scheduled", "overdue", "paused"].includes(record.status)
        )
          throw new Error("此计划不可修改");
        if (command === "cancel_schedule") {
          record.status = "cancelled";
          result = { ...record.draft, id: crypto.randomUUID() };
          const drafts = JSON.parse(
            localStorage.getItem(key + "-drafts") || "[]",
          ) as Compose[];
          localStorage.setItem(
            key + "-drafts",
            JSON.stringify([result, ...drafts]),
          );
        } else {
          const at = new Date(args.scheduledAt as string);
          if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now())
            throw new Error("请选择未来的发送时间");
          record.scheduledAt = at.toISOString();
          record.status = "scheduled";
          record.error = "";
        }
        record.updatedAt = new Date().toISOString();
        localStorage.setItem(key + "-outbox", JSON.stringify(records));
        break;
      }
      case "desktop_settings":
        result = {
          autoStart: localStorage.getItem(key + "-auto-start") === "true",
          autoStartAvailable: true,
        };
        break;
      case "set_auto_start":
        localStorage.setItem(key + "-auto-start", String(args.enabled));
        break;
      case "test_notification":
        break;
      case "archive_tier_info":
        result = {
          externalDir: "",
          importLocation: "internal",
          retentionDays: 30,
          indexEnabled: true,
          pending: 0,
          pendingBytes: 0,
          externalReachable: false,
        };
        break;
      case "normalize_archive_paths":
      case "tier_recall":
        result = 0;
        break;
      case "save_archive_tier_settings":
        result = {
          externalDir: String(args.externalDir ?? ""),
          importLocation:
            args.importLocation === "external" && args.externalDir
              ? "external"
              : "internal",
          retentionDays: Number(args.retentionDays ?? 30),
          indexEnabled: args.indexEnabled !== false,
          pending: 0,
          pendingBytes: 0,
          externalReachable: false,
        };
        break;
      case "tier_archives_now":
        result = {
          moved: 0,
          movedBytes: 0,
          pending: 0,
          pendingBytes: 0,
          indexWritten: true,
          skipped: false,
          errors: [],
        };
        break;
      case "archive_tier_log":
        result = {
          total: 3,
          totalBytes: 12 * 1024 * 1024,
          entries: [
            {
              subject: "项目对账邮件",
              sender: "alice@example.com",
              date: "2026-09-28T10:00:00+08:00",
              archivedAt: "2026-10-01T02:00:00+00:00",
            },
            {
              subject: "第二封周报",
              sender: "bob@example.com",
              date: "2026-09-20T09:30:00+08:00",
              archivedAt: "2026-09-25T03:10:00+00:00",
            },
            {
              subject: "服务器续费提醒",
              sender: "noreply@idc.example.com",
              date: "2026-09-11T21:05:00+08:00",
              archivedAt: "2026-09-18T01:20:00+00:00",
            },
          ],
        };
        break;
      case "local_archive_tree":
        result = [
          {
            accountId: "demo",
            accountEmail: "demo@example.com",
            folders: [
              { name: "INBOX", displayName: "收件箱" },
              { name: "Sent", displayName: "已发送" },
            ],
          },
        ];
        break;
      case "check_data_dir":
        result = {
          path: String(args.path ?? ""),
          isCurrent: false,
          hasData: false,
          writable: true,
          error: "",
          migrationFiles: 0,
          migrationBytes: 0,
        };
        break;
      case "migrate_data_dir":
        result = {
          path: String(args.path ?? ""),
          source: "file",
          configPath: "",
          overridden: false,
        };
        break;
      case "data_dir_info":
        result = {
          path: "演示模式不保存本地存档",
          source: "default",
          configPath: "",
          overridden: false,
        };
        break;
      case "set_data_dir":
      case "reset_data_dir":
        result = {
          path: "演示模式不保存本地存档",
          source: "default",
          configPath: "",
          overridden: false,
        };
        break;
      case "get_preferences":
        result = JSON.parse(
          localStorage.getItem(key + "-preferences") ||
            '{"syncIntervalMinutes":5,"newMailNotifications":true,"sendResultNotifications":true,"sendCountdownSeconds":5}',
        );
        break;
      case "save_preferences":
        localStorage.setItem(
          key + "-preferences",
          JSON.stringify(args.preferences),
        );
        break;
      case "suspend_restore_shortcut":
        result = null;
        break;
      case "set_restore_shortcut": {
        const stored = JSON.parse(
          localStorage.getItem(key + "-preferences") || "{}",
        );
        localStorage.setItem(
          key + "-preferences",
          JSON.stringify({
            ...stored,
            restoreShortcut: args.shortcut as string,
          }),
        );
        break;
      }
      case "archive_deletion_preview": {
        const mails = demo.messages.filter(
          (m) =>
            m.savedLocally !== false &&
            (!args.accountId || m.accountId === args.accountId),
        );
        const scopes = new Map<
          string,
          { accountId: string; name: string; email: string; count: number }
        >();
        for (const m of mails) {
          const scope = scopes.get(m.accountId) || {
            accountId: m.accountId,
            name:
              demo.accounts.find((a) => a.id === m.accountId)?.name ||
              "已移除账号",
            email: m.accountEmail,
            count: 0,
          };
          scope.count++;
          scopes.set(m.accountId, scope);
        }
        result = {
          count: mails.length,
          bytes: mails.reduce((n, m) => n + m.size, 0),
          offlineOnly: mails.filter(
            (m) =>
              !demo!.accounts.some((a) => a.id === m.accountId) ||
              m.sourceFolder === "Sent",
          ).length,
          reviewToken: JSON.stringify(
            mails
              .map((m) => [
                m.id,
                m.hash,
                !demo!.accounts.some((a) => a.id === m.accountId) ||
                  m.sourceFolder === "Sent",
              ])
              .sort(),
          ),
          accounts: [...scopes.values()],
        };
        break;
      }
      case "delete_local_archives": {
        const mails = demo.messages.filter(
          (m) =>
            m.savedLocally !== false &&
            (!args.accountId || m.accountId === args.accountId),
        );
        const token = JSON.stringify(
          mails
            .map((m) => [
              m.id,
              m.hash,
              !demo!.accounts.some((a) => a.id === m.accountId) ||
                m.sourceFolder === "Sent",
            ])
            .sort(),
        );
        if (mails.length !== args.expectedCount || token !== args.expectedToken)
          throw new Error("存档范围已变化，请重新查看删除范围后确认");
        if (!mails.length) throw new Error("所选范围没有本地存档");
        let offlineRemoved = 0;
        const offline = new Set<string>();
        for (const m of mails) {
          if (
            !demo.accounts.some((a) => a.id === m.accountId) ||
            m.sourceFolder === "Sent"
          ) {
            offline.add(m.id);
            offlineRemoved++;
          } else {
            m.savedLocally = false;
            m.body = "";
          }
        }
        demo.messages = demo.messages.filter((m) => !offline.has(m.id));
        if (args.stopSaving)
          for (const a of demo.accounts)
            if (!args.accountId || a.id === args.accountId)
              a.saveLocally = false;
        result = {
          deleted: mails.length,
          offlineRemoved,
          freedBytes: mails.reduce((n, m) => n + m.size, 0),
          cleanupPending: false,
        };
        break;
      }
      case "archive_health":
        result = {
          checked: demo.messages.length,
          healthy: demo.messages.length,
          problems: [],
          checkedAt: new Date().toISOString(),
        };
        break;
      default:
        throw new Error(
          command === "send_mail"
            ? "演示模式不会发送真实邮件，请连接你的邮箱后使用。"
            : "此功能需要退出演示，在 macOS 桌面客户端中使用。",
        );
    }
    if (
      ![
        "mail_conversation",
        "mail_detail",
        "mail_metadata",
        "account_folders",
        "sync_remote_folder",
        "list_drafts",
        "clear_drafts",
        "list_contacts",
        "contact_history",
        "contact_blacklist",
        "list_calendar_events",
        "get_preferences",
        "list_outbox",
        "delete_outbox",
        "clear_sent_outbox",
        "server_operations",
        "folder_health",
        "directory_operations",
        "rule_executions",
        "folder_settings",
        "retention_settings",
        "archive_jobs",
        "copy_sources",
        "empty_server_trash",
      ].includes(command)
    )
      localStorage.setItem(key, JSON.stringify(demo));
    if (
      [
        "update_mail",
        "run_rules",
        "account_action",
        "edit_account",
        "queue_archives",
        "archive_job_action",
        "save_retention",
        "save_inbox_folders",
        "empty_server_trash",
      ].includes(command)
    )
      demoPager.changed();
    return result as T;
  }
  if (!native) throw new Error("请在 macOS 桌面客户端中使用此功能。");
  if (command.startsWith("perf_log_")) return invoke<T>(command, args);
  const started = performance.now();
  try {
    const result = await invoke<T>(command, args);
    logPerf(
      "command",
      {
        command,
        ...(command === "sync_remote_folder"
          ? { folder: String(args.folder ?? "") }
          : {}),
      },
      performance.now() - started,
    );
    return result;
  } catch (error) {
    logPerf(
      "command_error",
      { command, error: String(error) },
      performance.now() - started,
    );
    throw error;
  }
}
export function initialSnapshot() {
  return empty();
}
export function newDraft(accountId: string): Compose {
  return {
    id: crypto.randomUUID(),
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
  };
}
export type { Mail };
