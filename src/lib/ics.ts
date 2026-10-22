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

type IcsDate = { date: Date; allDay: boolean };

function parseIcsDate(
  value: string,
  params: Record<string, string>,
): IcsDate | null {
  const raw = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(raw)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (!match) return null;
    return {
      date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      allDay: true,
    };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!match) return null;
  const values = match.slice(1, 7).map(Number);
  const date = match[7]
    ? new Date(
        Date.UTC(
          values[0],
          values[1] - 1,
          values[2],
          values[3],
          values[4],
          values[5],
        ),
      )
    : new Date(
        values[0],
        values[1] - 1,
        values[2],
        values[3],
        values[4],
        values[5],
      );
  return { date, allDay: false };
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

export function parseIcs(text: string): CalendarEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: CalendarEvent[] = [];
  let inEvent = false;
  let inAlarm = false;
  let start: IcsDate | null = null;
  let end: IcsDate | null = null;
  let summary = "";
  let location = "";
  let notes = "";
  let repeat: CalendarRepeat = "none";
  let color: CalendarColor = "blue";
  let reminder: number | null = null;

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
      start = null;
      end = null;
      summary = "";
      location = "";
      notes = "";
      repeat = "none";
      color = "blue";
      reminder = null;
      continue;
    }
    if (line.trim() === "END:VEVENT") {
      inEvent = false;
      if (!start) continue;
      const timedEnd =
        end && !start.allDay && end.date.getTime() > start.date.getTime()
          ? end.date
          : start.allDay
            ? start.date
            : addHours(start.date, 1);
      const allDayEnd = end?.allDay
        ? addDays(end.date, -1)
        : start.allDay
          ? start.date
          : timedEnd;
      events.push({
        id: "",
        title: summary || "未命名日程",
        start: start.allDay
          ? `${start.date.getFullYear()}-${pad(start.date.getMonth() + 1)}-${pad(start.date.getDate())}`
          : start.date.toISOString(),
        end: start.allDay
          ? `${allDayEnd.getFullYear()}-${pad(allDayEnd.getMonth() + 1)}-${pad(allDayEnd.getDate())}`
          : timedEnd.toISOString(),
        allDay: start.allDay,
        location,
        notes,
        color,
        reminderMinutes: reminder,
        repeat,
        createdAt: "",
        updatedAt: "",
      });
      continue;
    }
    if (!inEvent) continue;
    const property = parseProperty(line);
    if (!property) continue;
    switch (property.name) {
      case "DTSTART":
        start = parseIcsDate(property.value, property.params);
        break;
      case "DTEND":
        end = parseIcsDate(property.value, property.params);
        break;
      case "SUMMARY":
        summary = unescapeText(property.value).trim();
        break;
      case "LOCATION":
        location = unescapeText(property.value).trim();
        break;
      case "DESCRIPTION":
        if (!inAlarm) notes = unescapeText(property.value).trim();
        break;
      case "TRIGGER":
        reminder = parseTrigger(property.value);
        break;
      case "X-YANXIN-COLOR":
        if (COLORS.includes(property.value as CalendarColor)) {
          color = property.value as CalendarColor;
        }
        break;
      case "RRULE": {
        const freq = /(?:^|;)FREQ=([A-Z]+)/i
          .exec(property.value)?.[1]
          ?.toUpperCase();
        repeat = freq ? (FREQ_REPEAT[freq] ?? "none") : "none";
        break;
      }
      default:
        break;
    }
  }
  return events;
}
