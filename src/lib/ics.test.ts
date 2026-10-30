import { describe, expect, it } from "vitest";
import { eventsToIcs, parseIcs } from "./ics";
import type { CalendarEvent } from "./types";

function timed(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "项目周会",
    start: "2026-10-21T01:00:00.000Z",
    end: "2026-10-21T02:00:00.000Z",
    allDay: false,
    location: "会议室 A",
    notes: "同步进度；确认风险,然后分工。\n第二行",
    color: "purple",
    reminderMinutes: 15,
    repeat: "weekly",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("ics", () => {
  it("round trips timed events with repeat and escaped text", () => {
    const parsed = parseIcs(eventsToIcs([timed()]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("项目周会");
    expect(parsed[0].start).toBe("2026-10-21T01:00:00.000Z");
    expect(parsed[0].end).toBe("2026-10-21T02:00:00.000Z");
    expect(parsed[0].allDay).toBe(false);
    expect(parsed[0].repeat).toBe("weekly");
    expect(parsed[0].color).toBe("purple");
    expect(parsed[0].reminderMinutes).toBe(15);
    expect(parsed[0].location).toBe("会议室 A");
    expect(parsed[0].notes).toBe("同步进度；确认风险,然后分工。\n第二行");
  });

  it("round trips all-day events using exclusive ICS end dates", () => {
    const event = timed({
      id: "event-2",
      title: "团队活动日",
      start: "2026-10-24",
      end: "2026-10-25",
      allDay: true,
      repeat: "none",
    });
    const ics = eventsToIcs([event]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261024");
    expect(ics).toContain("DTEND;VALUE=DATE:20261026");
    const parsed = parseIcs(ics);
    expect(parsed[0].start).toBe("2026-10-24");
    expect(parsed[0].end).toBe("2026-10-25");
    expect(parsed[0].allDay).toBe(true);
  });

  it("unfolds long summaries and reads external events", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:external-1",
      "DTSTART:20261021T090000Z",
      "DTEND:20261021T100000Z",
      "SUMMARY:这是一个很长的日程标题，用来验证 ICS 行折",
      " 叠后仍能完整还原",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe(
      "这是一个很长的日程标题，用来验证 ICS 行折叠后仍能完整还原",
    );
    expect(parsed[0].end).toBe("2026-10-21T10:00:00.000Z");
    expect(parsed[0].reminderMinutes).toBeNull();
  });

  it("reads Apple special-day markers", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:holiday",
      "DTSTART;VALUE=DATE:20261001",
      "DTEND;VALUE=DATE:20261002",
      "SUMMARY:国庆（休）",
      "X-APPLE-SPECIAL-DAY:WORK-HOLIDAY",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:term",
      "DTSTART;VALUE=DATE:20261008",
      "DTEND;VALUE=DATE:20261009",
      "SUMMARY:寒露",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(text);
    expect(parsed[0].specialDay).toBe("WORK-HOLIDAY");
    expect(parsed[1].specialDay).toBeUndefined();
  });

  it("ignores calendars without events", () => {
    expect(
      parseIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"),
    ).toEqual([]);
  });
  it("converts TZID wall times to UTC across DST", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:tz-1",
      "DTSTART;TZID=America/New_York:20260308T013000",
      "DTEND;TZID=America/New_York:20260308T023000",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:跨夏令时",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(text, {
      expand: { from: new Date("2026-03-01"), to: new Date("2026-03-12") },
    });
    expect(parsed.map((event) => event.start)).toEqual([
      "2026-03-08T06:30:00.000Z",
      "2026-03-09T05:30:00.000Z",
    ]);
    expect(parsed.every((event) => event.repeat === "none")).toBe(true);
    expect(new Set(parsed.map((event) => event.id)).size).toBe(2);
  });

  it("expands interval, byday, count, exdate and rdate", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:repeat-1",
      "DTSTART;TZID=Asia/Shanghai:20261006T090000",
      "DTEND;TZID=Asia/Shanghai:20261006T100000",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=3",
      "EXDATE;TZID=Asia/Shanghai:20261020T090000",
      "RDATE;TZID=Asia/Shanghai:20261023T090000",
      "SUMMARY:双周会",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(text, {
      expand: { from: new Date("2026-09-01"), to: new Date("2027-01-01") },
    });
    expect(parsed.map((event) => event.start)).toEqual([
      "2026-10-06T01:00:00.000Z",
      "2026-10-23T01:00:00.000Z",
      "2026-11-03T01:00:00.000Z",
    ]);
  });

  it("keeps inclusive all-day ends when expanding repeat", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:allday-1",
      "DTSTART;VALUE=DATE:20261024",
      "DTEND;VALUE=DATE:20261027",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:三天活动",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(text, {
      expand: { from: new Date("2026-10-01"), to: new Date("2026-11-01") },
    });
    expect(parsed.map((event) => [event.start, event.end])).toEqual([
      ["2026-10-24", "2026-10-26"],
      ["2026-10-25", "2026-10-27"],
    ]);
  });
});
