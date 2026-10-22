import { addDays, addHours } from "date-fns";
import type { CalendarColor, CalendarEvent, CalendarRepeat } from "./types";

const COLORS: CalendarColor[] = ["blue", "green", "orange", "purple", "gray"];

const REPEAT_FREQ: Record<CalendarRepeat, string> = {
  none: "",
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

const FREQ_REPEAT: Record<string, CalendarRepeat> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function formatDuration(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  return `-PT${minutes}M`;
}

function parseTrigger(value: string): number | null {
  const match =
    /^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!match || !match[1]) return null;
  const days = Number(match[2] || 0);
  const hours = Number(match[3] || 0);
  const minutes = Number(match[4] || 0);
  const seconds = Number(match[5] || 0);
  return Math.round(days * 1440 + hours * 60 + minutes + seconds / 60);
}

function foldLine(line: string): string {
  const chunks: string[] = [];
  let current = "";
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > 73 && current) {
      chunks.push(current);
      current = ` ${char}`;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function dateOnlyToDate(event: Pick<CalendarEvent, "start" | "end">): {
  start: Date;
  end: Date;
} {
  const [sy, sm, sd] = event.start.split("-").map(Number);
  const [ey, em, ed] = event.end.split("-").map(Number);
  return {
    start: new Date(sy, sm - 1, sd),
    end: new Date(ey, em - 1, ed),
  };
}

export function eventsToIcs(events: CalendarEvent[]): string {
  const stamp = formatUtc(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yanxin//Calendar//CN",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(
      `UID:${escapeText(event.id || `${event.title}-${event.start}`)}@yanxin`,
    );
    lines.push(`DTSTAMP:${stamp}`);
    if (event.allDay) {
      const dates = dateOnlyToDate(event);
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(dates.start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(addDays(dates.end, 1))}`);
    } else {
      lines.push(`DTSTART:${formatUtc(new Date(event.start))}`);
      lines.push(`DTEND:${formatUtc(new Date(event.end))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    lines.push(`X-YANXIN-COLOR:${event.color}`);
    if (event.repeat !== "none") {
      lines.push(`RRULE:FREQ=${REPEAT_FREQ[event.repeat]}`);
    }
    if (event.reminderMinutes !== null) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${escapeText(event.title)}`);
      lines.push(`TRIGGER:${formatDuration(event.reminderMinutes)}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type IcsDate = {
  date: Date;
  allDay: boolean;
  timeZone?: string;
  wall: Wall;
};

type Recurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: IcsDate;
  byDay?: { weekday: number; ordinal?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
};

function inheritZone(date: IcsDate, timeZone?: string): IcsDate {
  if (!timeZone || date.timeZone || date.allDay) return date;
  return { ...date, timeZone, date: resolveWall(date.wall, timeZone) };
}

type ParsedIcsEvent = {
  uid: string;
  start: IcsDate;
  end: IcsDate | null;
  summary: string;
  location: string;
  notes: string;
  color: CalendarColor;
  reminder: number | null;
  specialDay: string;
  recurrence: Recurrence | null;
  repeat: CalendarRepeat;
  exdates: IcsDate[];
  rdates: IcsDate[];
};

export type IcsParseOptions = {
  expand?: { from: Date; to: Date };
};

const WEEKDAYS: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

const MAX_OCCURRENCES = 2000;

function wallToUtcDate(wall: Wall): Date {
  return new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    ),
  );
}

function wallFromUtcDate(date: Date): Wall {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function localWall(date: Date): Wall {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function addWallMinutes(wall: Wall, minutes: number): Wall {
  return wallFromUtcDate(
    new Date(wallToUtcDate(wall).getTime() + minutes * 60_000),
  );
}

function addWallDays(wall: Wall, days: number): Wall {
  return addWallMinutes(wall, days * 1440);
}

function dateKeyOfWall(wall: Wall): string {
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

function timeZoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return (asUtc - date.getTime()) / 60_000;
}

function resolveWall(wall: Wall, timeZone?: string): Date {
  if (!timeZone) {
    return new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
  }
  if (timeZone === "UTC") return wallToUtcDate(wall);
  try {
    const wallMs = wallToUtcDate(wall).getTime();
    let guess = wallMs;
    for (let index = 0; index < 2; index += 1) {
      guess = wallMs - timeZoneOffset(new Date(guess), timeZone) * 60_000;
    }
    return new Date(guess);
  } catch {
    return new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
  }
}

function parseIcsDate(
  value: string,
  params: Record<string, string>,
): IcsDate | null {
  const raw = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(raw)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (!match) return null;
    const wall = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: 0,
      minute: 0,
      second: 0,
    };
    return {
      date: new Date(wall.year, wall.month - 1, wall.day),
      allDay: true,
      wall,
    };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!match) return null;
  const values = match.slice(1, 7).map(Number);
  const wall = {
    year: values[0],
    month: values[1],
    day: values[2],
    hour: values[3],
    minute: values[4],
    second: values[5],
  };
  const isUtc = !!match[7];
  const timeZone = isUtc
    ? "UTC"
    : params.TZID?.replace(/^"|"$/g, "") || undefined;
  return {
    date: resolveWall(wall, timeZone),
    allDay: false,
    timeZone,
    wall,
  };
}

function parseRrule(value: string): Recurrence | null {
  const parts: Record<string, string> = {};
  for (const item of value.split(";")) {
    const [key, raw] = item.split("=");
    if (key) parts[key.toUpperCase()] = raw ?? "";
  }
  const freq = parts.FREQ?.toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq || "")) {
    return null;
  }
  const recurrence: Recurrence = {
    freq: freq as Recurrence["freq"],
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
  };
  if (parts.COUNT) recurrence.count = Math.max(1, Number(parts.COUNT));
  if (parts.UNTIL) {
    const until = parseIcsDate(parts.UNTIL, {});
    if (until) recurrence.until = until;
  }
  if (parts.BYMONTHDAY) {
    recurrence.byMonthDay = parts.BYMONTHDAY.split(",")
      .map(Number)
      .filter((day) => Number.isInteger(day) && day !== 0);
  }
  if (parts.BYMONTH) {
    recurrence.byMonth = parts.BYMONTH.split(",")
      .map(Number)
      .filter((month) => month >= 1 && month <= 12);
  }
  if (parts.BYDAY) {
    recurrence.byDay = parts.BYDAY.split(",").flatMap((item) => {
      const match = /^([+-]?\d+)?([A-Z]{2})$/.exec(item.trim().toUpperCase());
      if (!match || WEEKDAYS[match[2]] === undefined) return [];
      return [
        {
          weekday: WEEKDAYS[match[2]],
          ordinal: match[1] ? Number(match[1]) : undefined,
        },
      ];
    });
  }
  return recurrence;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(wall: Wall): number {
  return (wallToUtcDate(wall).getUTCDay() + 6) % 7;
}

function weekStart(wall: Wall): Wall {
  return addWallDays(wall, -weekdayOf(wall));
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): number | null {
  const total = daysInMonth(year, month);
  if (ordinal > 0) {
    const first = weekdayOf({
      year,
      month,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    const day = 1 + ((weekday - first + 7) % 7) + (ordinal - 1) * 7;
    return day <= total ? day : null;
  }
  const last = weekdayOf({
    year,
    month,
    day: total,
    hour: 0,
    minute: 0,
    second: 0,
  });
  const day = total - ((last - weekday + 7) % 7) + (ordinal + 1) * 7;
  return day >= 1 ? day : null;
}

function occurrenceWalls(
  start: IcsDate,
  recurrence: Recurrence,
  to: Date,
): Wall[] {
  const base = start.wall;
  const result: Wall[] = [];
  const untilMs = recurrence.until?.date.getTime();
  const untilKey = recurrence.until?.allDay
    ? dateKeyOfWall(recurrence.until.wall)
    : "";
  let generated = 0;
  let period = 0;

  const push = (wall: Wall) => {
    if (wallToUtcDate(wall).getTime() < wallToUtcDate(base).getTime()) return;
    if (generated >= MAX_OCCURRENCES) return;
    const actual = resolveWall(wall, start.timeZone);
    if (
      untilMs !== undefined &&
      !recurrence.until?.allDay &&
      actual.getTime() > untilMs
    )
      return;
    if (untilKey && dateKeyOfWall(wall) > untilKey) return;
    generated += 1;
    if (recurrence.count !== undefined && generated > recurrence.count) return;
    result.push(wall);
  };

  while (period < 5000 && result.length < MAX_OCCURRENCES) {
    if (recurrence.count !== undefined && generated >= recurrence.count) break;
    const periodStart =
      recurrence.freq === "DAILY"
        ? addWallDays(base, period * recurrence.interval)
        : recurrence.freq === "WEEKLY"
          ? addWallDays(base, period * recurrence.interval * 7)
          : recurrence.freq === "MONTHLY"
            ? {
                ...base,
                year:
                  base.year +
                  Math.floor(
                    (base.month - 1 + period * recurrence.interval) / 12,
                  ),
                month:
                  ((base.month - 1 + period * recurrence.interval) % 12) + 1,
              }
            : { ...base, year: base.year + period * recurrence.interval };

    if (recurrence.freq === "DAILY") {
      push(periodStart);
    } else if (recurrence.freq === "WEEKLY") {
      const week = weekStart(periodStart);
      const days = recurrence.byDay?.length
        ? recurrence.byDay.map((item) => item.weekday)
        : [weekdayOf(base)];
      for (const day of [...new Set(days)].sort((a, b) => a - b)) {
        push(addWallDays(week, day));
      }
    } else {
      const months =
        recurrence.freq === "YEARLY"
          ? recurrence.byMonth?.length
            ? recurrence.byMonth
            : [base.month]
          : [periodStart.month];
      const year =
        recurrence.freq === "YEARLY" ? periodStart.year : periodStart.year;
      for (const month of months) {
        const total = daysInMonth(year, month);
        let days: number[] = [];
        if (recurrence.byMonthDay?.length) {
          days = recurrence.byMonthDay
            .map((day) => (day < 0 ? total + day + 1 : day))
            .filter((day) => day >= 1 && day <= total);
        } else if (recurrence.byDay?.length) {
          days = recurrence.byDay.flatMap((item) => {
            if (item.ordinal) {
              const day = nthWeekdayOfMonth(
                year,
                month,
                item.weekday,
                item.ordinal,
              );
              return day ? [day] : [];
            }
            const first = weekdayOf({
              year,
              month,
              day: 1,
              hour: 0,
              minute: 0,
              second: 0,
            });
            const days: number[] = [];
            for (
              let day = 1 + ((item.weekday - first + 7) % 7);
              day <= total;
              day += 7
            )
              days.push(day);
            return days;
          });
        } else {
          days = [base.day].filter((day) => day <= total);
        }
        for (const day of [...new Set(days)].sort((a, b) => a - b)) {
          push({ ...base, year, month, day });
        }
      }
    }

    const periodEnd =
      recurrence.freq === "DAILY"
        ? addWallDays(base, period * recurrence.interval)
        : recurrence.freq === "WEEKLY"
          ? addWallDays(base, period * recurrence.interval * 7 + 7)
          : recurrence.freq === "MONTHLY"
            ? {
                ...base,
                year:
                  base.year +
                  Math.floor(
                    (base.month - 1 + (period + 1) * recurrence.interval) / 12,
                  ),
                month:
                  ((base.month - 1 + (period + 1) * recurrence.interval) % 12) +
                  1,
              }
            : { ...base, year: base.year + (period + 1) * recurrence.interval };
    if (
      recurrence.count === undefined &&
      !recurrence.until &&
      resolveWall(periodEnd, start.timeZone) > to
    )
      break;
    period += 1;
  }
  return result;
}

function startKey(date: IcsDate): string {
  return date.allDay ? dateKeyOfWall(date.wall) : date.date.toISOString();
}

function eventDurationDays(start: IcsDate, end: IcsDate | null): number {
  if (!end) return 0;
  return Math.max(
    0,
    Math.round(
      (wallToUtcDate(end.wall).getTime() -
        wallToUtcDate(start.wall).getTime()) /
        86_400_000,
    ) - 1,
  );
}

function eventDurationMinutes(start: IcsDate, end: IcsDate | null): number {
  if (!end) return 60;
  return Math.max(
    1,
    Math.round(
      (wallToUtcDate(end.wall).getTime() -
        wallToUtcDate(start.wall).getTime()) /
        60_000,
    ),
  );
}

function eventFromWalls(
  source: ParsedIcsEvent,
  startWall: Wall,
  id: string,
  expanded: boolean,
  durationDays: number,
  durationMinutes: number,
): CalendarEvent {
  const allDay = source.start.allDay;
  const timeZone = source.start.timeZone;
  const actualStart = resolveWall(startWall, timeZone);
  const endWall = allDay
    ? addWallDays(startWall, durationDays)
    : addWallMinutes(startWall, durationMinutes);
  const actualEnd = resolveWall(endWall, timeZone);
  return {
    id,
    title: source.summary || "未命名日程",
    start: allDay ? dateKeyOfWall(startWall) : actualStart.toISOString(),
    end: allDay ? dateKeyOfWall(endWall) : actualEnd.toISOString(),
    allDay,
    location: source.location,
    notes: source.notes,
    color: source.color,
    reminderMinutes: source.reminder,
    repeat: expanded ? "none" : source.repeat,
    createdAt: "",
    updatedAt: "",
    ...(source.specialDay ? { specialDay: source.specialDay } : {}),
  };
}

function expandEvent(
  source: ParsedIcsEvent,
  range: { from: Date; to: Date },
): CalendarEvent[] {
  if (!source.recurrence) {
    const id = source.uid
      ? source.uid
      : `ics-${source.summary}-${startKey(source.start)}`;
    return [
      eventFromWalls(
        source,
        source.start.wall,
        id,
        true,
        eventDurationDays(source.start, source.end),
        eventDurationMinutes(source.start, source.end),
      ),
    ];
  }
  const durationDays = eventDurationDays(source.start, source.end);
  const durationMinutes = eventDurationMinutes(source.start, source.end);
  const exdates = new Set(
    source.exdates.map((date) =>
      source.start.allDay ? dateKeyOfWall(date.wall) : date.date.toISOString(),
    ),
  );
  const walls = occurrenceWalls(source.start, source.recurrence, range.to);
  const output: CalendarEvent[] = [];
  const seen = new Set<string>();
  const baseId =
    source.uid || `ics-${source.summary}-${startKey(source.start)}`;
  for (const wall of walls) {
    const key = source.start.allDay
      ? dateKeyOfWall(wall)
      : resolveWall(wall, source.start.timeZone).toISOString();
    if (seen.has(key) || exdates.has(key)) continue;
    const start = resolveWall(wall, source.start.timeZone);
    const end = source.start.allDay
      ? new Date(`${dateKeyOfWall(addWallDays(wall, durationDays))}T00:00:00`)
      : resolveWall(
          addWallMinutes(wall, durationMinutes),
          source.start.timeZone,
        );
    if (start < range.from && end <= range.from) continue;
    if (start > range.to) continue;
    seen.add(key);
    output.push(
      eventFromWalls(
        source,
        wall,
        `${baseId}:${key}`,
        true,
        durationDays,
        durationMinutes,
      ),
    );
  }
  for (const extra of source.rdates) {
    const key = source.start.allDay
      ? dateKeyOfWall(extra.wall)
      : extra.date.toISOString();
    if (seen.has(key) || exdates.has(key)) continue;
    if (extra.date < range.from || extra.date > range.to) continue;
    seen.add(key);
    output.push(
      eventFromWalls(
        source,
        extra.wall,
        `${baseId}:${key}`,
        true,
        durationDays,
        durationMinutes,
      ),
    );
  }
  return output.sort((a, b) => a.start.localeCompare(b.start));
}

function parseProperty(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon).split(";");
  const name = left[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of left.slice(1)) {
    const [key, value] = part.split("=");
    if (key) params[key.toUpperCase()] = value ?? "";
  }
  return { name, params, value: line.slice(colon + 1) };
}

export function parseIcs(
  text: string,
  options: IcsParseOptions = {},
): CalendarEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: CalendarEvent[] = [];
  let inEvent = false;
  let inAlarm = false;
  let parsed: Partial<ParsedIcsEvent> = {};

  const reset = () => {
    parsed = {
      uid: "",
      start: undefined,
      end: null,
      summary: "",
      location: "",
      notes: "",
      color: "blue",
      reminder: null,
      specialDay: "",
      recurrence: null,
      repeat: "none",
      exdates: [],
      rdates: [],
    };
  };
  reset();

  for (const line of lines) {
    if (line.trim() === "BEGIN:VALARM") {
      inAlarm = true;
      continue;
    }
    if (line.trim() === "END:VALARM") {
      inAlarm = false;
      continue;
    }
    if (line.trim() === "BEGIN:VEVENT") {
      inEvent = true;
      reset();
      continue;
    }
    if (line.trim() === "END:VEVENT") {
      inEvent = false;
      if (!parsed.start) continue;
      const source = parsed as ParsedIcsEvent;
      const zone = source.start.timeZone;
      if (zone) {
        if (source.end) source.end = inheritZone(source.end, zone);
        source.exdates = source.exdates.map((date) => inheritZone(date, zone));
        source.rdates = source.rdates.map((date) => inheritZone(date, zone));
        if (source.recurrence?.until)
          source.recurrence.until = inheritZone(source.recurrence.until, zone);
      }
      if (!source.end) {
        source.end = null;
      }
      if (options.expand) {
        events.push(...expandEvent(source, options.expand));
      } else {
        const timedEnd =
          source.end &&
          !source.start.allDay &&
          source.end.date.getTime() > source.start.date.getTime()
            ? source.end.date
            : source.start.allDay
              ? source.start.date
              : addHours(source.start.date, 1);
        const allDayEnd = source.end?.allDay
          ? addDays(source.end.date, -1)
          : source.start.allDay
            ? source.start.date
            : timedEnd;
        events.push({
          id: "",
          title: source.summary || "未命名日程",
          start: source.start.allDay
            ? `${source.start.date.getFullYear()}-${pad(source.start.date.getMonth() + 1)}-${pad(source.start.date.getDate())}`
            : source.start.date.toISOString(),
          end: source.start.allDay
            ? `${allDayEnd.getFullYear()}-${pad(allDayEnd.getMonth() + 1)}-${pad(allDayEnd.getDate())}`
            : timedEnd.toISOString(),
          allDay: source.start.allDay,
          location: source.location,
          notes: source.notes,
          color: source.color,
          reminderMinutes: source.reminder,
          repeat: source.repeat,
          createdAt: "",
          updatedAt: "",
          ...(source.specialDay ? { specialDay: source.specialDay } : {}),
        });
      }
      continue;
    }
    if (!inEvent) continue;
    const property = parseProperty(line);
    if (!property) continue;
    switch (property.name) {
      case "UID":
        parsed.uid = unescapeText(property.value).trim();
        break;
      case "DTSTART":
        parsed.start =
          parseIcsDate(property.value, property.params) ?? undefined;
        break;
      case "DTEND":
        parsed.end = parseIcsDate(property.value, property.params);
        if (parsed.end)
          parsed.end = inheritZone(parsed.end, parsed.start?.timeZone);
        break;
      case "SUMMARY":
        parsed.summary = unescapeText(property.value).trim();
        break;
      case "LOCATION":
        parsed.location = unescapeText(property.value).trim();
        break;
      case "DESCRIPTION":
        if (!inAlarm) parsed.notes = unescapeText(property.value).trim();
        break;
      case "TRIGGER":
        parsed.reminder = parseTrigger(property.value);
        break;
      case "X-YANXIN-COLOR":
        if (COLORS.includes(property.value as CalendarColor)) {
          parsed.color = property.value as CalendarColor;
        }
        break;
      case "X-APPLE-SPECIAL-DAY":
        parsed.specialDay = property.value.trim();
        break;
      case "RRULE":
        parsed.recurrence = parseRrule(property.value);
        if (parsed.recurrence) {
          parsed.repeat = FREQ_REPEAT[parsed.recurrence.freq] ?? "none";
        }
        break;
      case "EXDATE":
        for (const value of property.value.split(",")) {
          const date = parseIcsDate(value, property.params);
          if (date)
            parsed.exdates?.push(inheritZone(date, parsed.start?.timeZone));
        }
        break;
      case "RDATE":
        for (const value of property.value.split(",")) {
          const date = parseIcsDate(value, property.params);
          if (date)
            parsed.rdates?.push(inheritZone(date, parsed.start?.timeZone));
        }
        break;
      default:
        break;
    }
  }
  return events;
}
