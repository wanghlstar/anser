import { describe, expect, it } from "vitest";
import {
  dateAtMinutes,
  dateKey,
  eventsForDay,
  formatMinutes,
  layoutDayEvents,
  moveAnchor,
  rangeForView,
  snapMinutes,
} from "./calendar";
import type { CalendarEvent, CalendarOccurrence } from "./types";

function occurrence(
  id: string,
  start: string,
  end: string,
  allDay = false,
): CalendarOccurrence {
  const event: CalendarEvent = {
    id,
    title: id,
    start,
    end,
    allDay,
    location: "",
    notes: "",
    color: "blue",
    reminderMinutes: null,
    repeat: "none",
    createdAt: "",
    updatedAt: "",
  };
  return { key: `${id}@${start}`, event, start, end, allDay };
}

describe("calendar ranges", () => {
  it("starts month grids on Monday and covers six weeks", () => {
    const anchor = new Date(2026, 9, 21, 12);
    const range = rangeForView("month", anchor);
    expect(dateKey(range.from)).toBe("2026-09-28");
    expect(dateKey(range.to)).toBe("2026-11-09");
  });

  it("moves anchors by view", () => {
    const anchor = new Date(2026, 9, 21, 12);
    expect(dateKey(moveAnchor("week", anchor, -1))).toBe("2026-10-14");
    expect(dateKey(moveAnchor("day", anchor, 1))).toBe("2026-10-22");
    expect(dateKey(moveAnchor("list", anchor, 1))).toBe("2026-11-20");
  });

  it("loads sixty days for the agenda list", () => {
    const anchor = new Date(2026, 9, 21, 12);
    const range = rangeForView("list", anchor);
    expect(dateKey(range.from)).toBe("2026-10-21");
    expect(dateKey(range.to)).toBe("2026-12-20");
  });
});

describe("calendar day layout", () => {
  it("clamps timed events to the day and keeps all-day separate", () => {
    const day = new Date(2026, 9, 21, 12);
    const items = eventsForDay(
      [
        occurrence("morning", "2026-10-21T01:00:00Z", "2026-10-21T02:00:00Z"),
        occurrence("holiday", "2026-10-21", "2026-10-21", true),
        occurrence("previous", "2026-10-20T01:00:00Z", "2026-10-20T02:00:00Z"),
      ],
      day,
    );
    expect(items.map((item) => item.event.id)).toEqual(["holiday", "morning"]);
  });

  it("assigns overlapping events to columns", () => {
    const day = new Date(2026, 9, 21, 12);
    const start = new Date(2026, 9, 21, 9, 0);
    const at = (minutes: number) => dateAtMinutes(day, minutes).toISOString();
    const layout = layoutDayEvents(
      [
        occurrence("a", at(9 * 60), at(11 * 60)),
        occurrence("b", at(10 * 60), at(12 * 60)),
        occurrence("c", at(11 * 60), at(12 * 60)),
      ],
      day,
    );
    expect(
      layout.find((item) => item.occurrence.event.id === "a")?.column,
    ).toBe(0);
    expect(
      layout.find((item) => item.occurrence.event.id === "b")?.column,
    ).toBe(1);
    expect(
      layout.find((item) => item.occurrence.event.id === "c")?.column,
    ).toBe(0);
    expect(layout[0].startMinutes).toBe(9 * 60);
    expect(start.getHours()).toBe(9);
  });
});

describe("calendar time helpers", () => {
  it("snaps and formats minutes", () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
    expect(snapMinutes(-20)).toBe(0);
    expect(snapMinutes(24 * 60)).toBe(24 * 60 - 15);
    expect(formatMinutes(9 * 60 + 5)).toBe("09:05");
  });
});
