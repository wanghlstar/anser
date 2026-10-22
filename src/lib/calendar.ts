import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  max,
  min,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type {
  CalendarColor,
  CalendarOccurrence,
  CalendarRepeat,
} from "./types";

export type CalendarView = "month" | "week" | "day" | "list";

export const CALENDAR_COLORS: { value: CalendarColor; label: string }[] = [
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "orange", label: "橙色" },
  { value: "purple", label: "紫色" },
  { value: "gray", label: "灰色" },
];

export const REPEAT_OPTIONS: { value: CalendarRepeat; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "不提醒" },
  { value: 0, label: "日程开始时" },
  { value: 5, label: "提前 5 分钟" },
  { value: 15, label: "提前 15 分钟" },
  { value: 30, label: "提前 30 分钟" },
  { value: 60, label: "提前 1 小时" },
  { value: 1440, label: "提前 1 天" },
];

export const WEEKDAY_LABELS = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

export function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseEventStart(
  occurrence: Pick<CalendarOccurrence, "start" | "allDay">,
): Date {
  return occurrence.allDay
    ? parse(occurrence.start, "yyyy-MM-dd", new Date())
    : new Date(occurrence.start);
}

export function parseEventEnd(
  occurrence: Pick<CalendarOccurrence, "end" | "allDay">,
): Date {
  return occurrence.allDay
    ? parse(occurrence.end, "yyyy-MM-dd", new Date())
    : new Date(occurrence.end);
}

export function rangeForView(
  view: CalendarView,
  anchor: Date,
): { from: Date; to: Date } {
  if (view === "list") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 60) };
  }
  if (view === "month") {
    const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    return { from, to: addDays(from, 42) };
  }
  if (view === "week") {
    const from = startOfWeek(anchor, { weekStartsOn: 1 });
    return { from, to: addDays(from, 7) };
  }
  const from = startOfDay(anchor);
  return { from, to: addDays(from, 1) };
}

export function daysForView(view: CalendarView, anchor: Date): Date[] {
  const { from, to } = rangeForView(view, anchor);
  const days: Date[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function moveAnchor(
  view: CalendarView,
  anchor: Date,
  direction: -1 | 1,
): Date {
  if (view === "list") return addDays(anchor, direction * 30);
  if (view === "month") return addMonths(anchor, direction);
  if (view === "week") return addWeeks(anchor, direction);
  return addDays(anchor, direction);
}

export function occursOnDay(
  occurrence: CalendarOccurrence,
  day: Date,
): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const start = parseEventStart(occurrence);
  const end = parseEventEnd(occurrence);
  if (occurrence.allDay) return start < dayEnd && end >= dayStart;
  return start < dayEnd && end > dayStart;
}

export function eventsForDay(
  occurrences: CalendarOccurrence[],
  day: Date,
): CalendarOccurrence[] {
  return occurrences
    .filter((occurrence) => occursOnDay(occurrence, day))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return parseEventStart(a).getTime() - parseEventStart(b).getTime();
    });
}

export interface PositionedOccurrence {
  occurrence: CalendarOccurrence;
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
}

export function layoutDayEvents(
  occurrences: CalendarOccurrence[],
  day: Date,
): PositionedOccurrence[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const items = occurrences
    .filter((occurrence) => !occurrence.allDay && occursOnDay(occurrence, day))
    .map((occurrence) => {
      const start = max([parseEventStart(occurrence), dayStart]);
      const end = min([parseEventEnd(occurrence), dayEnd]);
      return {
        occurrence,
        startMinutes: (start.getTime() - dayStart.getTime()) / 60000,
        endMinutes: Math.max(
          (end.getTime() - dayStart.getTime()) / 60000,
          (start.getTime() - dayStart.getTime()) / 60000 + 15,
        ),
        column: 0,
        columns: 1,
      };
    })
    .sort(
      (a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes,
    );

  let index = 0;
  while (index < items.length) {
    const cluster = [items[index]];
    let clusterEnd = items[index].endMinutes;
    let next = index + 1;
    while (next < items.length && items[next].startMinutes < clusterEnd) {
      cluster.push(items[next]);
      clusterEnd = Math.max(clusterEnd, items[next].endMinutes);
      next += 1;
    }
    const columnEnds: number[] = [];
    for (const item of cluster) {
      let column = columnEnds.findIndex((end) => end <= item.startMinutes);
      if (column < 0) {
        column = columnEnds.length;
        columnEnds.push(item.endMinutes);
      } else {
        columnEnds[column] = item.endMinutes;
      }
      item.column = column;
    }
    for (const item of cluster) item.columns = Math.max(columnEnds.length, 1);
    index = next;
  }
  return items;
}

export function snapMinutes(minutes: number, step = 15): number {
  return Math.max(
    0,
    Math.min(24 * 60 - step, Math.round(minutes / step) * step),
  );
}

export function minutesFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function dateAtMinutes(day: Date, minutes: number): Date {
  const result = startOfDay(day);
  result.setMinutes(minutes);
  return result;
}

export function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(
    clamped % 60,
  ).padStart(2, "0")}`;
}

export function occurrenceLabel(
  occurrence: CalendarOccurrence,
  withDate = false,
): string {
  if (occurrence.allDay) return "全天";
  const start = parseEventStart(occurrence);
  const end = parseEventEnd(occurrence);
  const prefix = withDate ? `${format(start, "M月d日")} ` : "";
  if (isSameDay(start, end)) {
    return `${prefix}${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }
  return `${prefix}${format(start, "HH:mm")} – ${format(end, "M月d日 HH:mm")}`;
}

export function formatRangeTitle(view: CalendarView, anchor: Date): string {
  if (view === "list") return `${format(anchor, "yyyy年M月d日")} 起`;
  if (view === "month") return format(anchor, "yyyy年M月");
  if (view === "week") {
    const from = startOfWeek(anchor, { weekStartsOn: 1 });
    const to = addDays(from, 6);
    return `${format(from, "yyyy年M月d日")} – ${format(to, "M月d日")}`;
  }
  const weekday = WEEKDAY_LABELS[(anchor.getDay() + 6) % 7];
  return `${format(anchor, "yyyy年M月d日")} ${weekday}`;
}

export function allDaySpanLabel(occurrence: CalendarOccurrence): string {
  const start = parseEventStart(occurrence);
  const end = parseEventEnd(occurrence);
  if (isSameDay(start, end)) return format(start, "M月d日");
  return `${format(start, "M月d日")} – ${format(end, "M月d日")}`;
}
