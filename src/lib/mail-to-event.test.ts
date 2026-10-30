import { describe, expect, it } from "vitest";
import { eventDraftFromMail, nextEventHour } from "./mail-to-event";
import type { Mail } from "./types";

const mail = {
  sender: "Lin Chen <lin@example.com>",
  subject: "周三设计评审",
  preview: "想约你一起看看第一版设计。",
  date: "2026-10-21T01:00:00Z",
} as Mail;

describe("create calendar event from mail", () => {
  it("starts at the next full hour", () => {
    expect(nextEventHour(new Date(2026, 9, 21, 14, 20)).getHours()).toBe(15);
    expect(nextEventHour(new Date(2026, 9, 21, 14, 0)).getHours()).toBe(15);
  });

  it("copies the subject and mail context", () => {
    const event = eventDraftFromMail(mail, new Date(2026, 9, 21, 9, 10));
    expect(event.title).toBe("周三设计评审");
    expect(event.notes).toContain("Lin Chen <lin@example.com>");
    expect(event.notes).toContain("想约你一起看看第一版设计。");
    expect(
      new Date(event.end).getTime() - new Date(event.start).getTime(),
    ).toBe(60 * 60 * 1000);
    expect(event.reminderMinutes).toBe(15);
  });
});
