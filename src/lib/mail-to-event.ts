import { addHours, startOfHour } from "date-fns";
import type { CalendarEvent, Mail } from "./types";

export function nextEventHour(now: Date): Date {
  return addHours(startOfHour(now), 1);
}

export function eventDraftFromMail(
  mail: Mail,
  now = new Date(),
): CalendarEvent {
  const start = nextEventHour(now);
  const details = [
    `发件人：${mail.sender}`,
    `邮件时间：${new Date(mail.date).toLocaleString("zh-CN")}`,
    "",
    mail.preview.trim(),
  ]
    .filter((line, index) => index < 3 || line.length > 0)
    .join("\n");
  return {
    id: "",
    title: mail.subject || "邮件日程",
    start: start.toISOString(),
    end: addHours(start, 1).toISOString(),
    allDay: false,
    location: "",
    notes: details,
    color: "blue",
    reminderMinutes: 15,
    repeat: "none",
    createdAt: "",
    updatedAt: "",
  };
}
