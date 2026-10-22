export type MeetingProvider = "wecom" | "tencent";

export interface MeetingInfo {
  provider: MeetingProvider;
  start: string;
  end: string;
  url: string;
  code: string;
}

const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  wecom: "企业微信会议",
  tencent: "腾讯会议",
};

export function meetingProviderLabel(provider: MeetingProvider): string {
  return PROVIDER_LABELS[provider];
}

function explicitOffset(text: string): number | null {
  const match = text.match(/(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (match) {
    const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === "-" ? -minutes : minutes;
  }
  if (/中国标准时间|北京时间|Asia\/Shanghai/i.test(text)) return 8 * 60;
  return null;
}

function localDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  offset: number | null,
): Date {
  if (offset === null) return new Date(year, month - 1, day, hour, minute);
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(utc - offset * 60_000);
}

function normalizeCode(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value
    .replace(/[^\d-]/g, "")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function meetingLink(text: string): string {
  const match = text.match(
    /https?:\/\/(?:work\.weixin\.qq\.com\/webapp\/tm\/|meeting\.tencent\.com\/dm\/)[^\s<>"'）)]*/i,
  );
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

function meetingCode(text: string): string {
  const match = text.match(
    /#\s*(?:企业微信会议|腾讯会议)\s*[:：]\s*([\d\s-]{7,})/,
  );
  return match ? normalizeCode(match[1]) : "";
}

function providerFor(text: string, url: string): MeetingProvider | null {
  if (/meeting\.tencent\.com|腾讯会议/i.test(url || text)) return "tencent";
  if (/work\.weixin\.qq\.com|企业微信会议/i.test(url || text)) return "wecom";
  return null;
}

export function parseMeeting(text: string): MeetingInfo | null {
  const normalized = text.replace(/\r/g, "");
  const time = normalized.match(
    /会议时间\s*[:：]\s*(\d{4})[/年-](\d{1,2})[/月-](\d{1,2})日?\s+(\d{1,2})\s*:\s*(\d{2})\s*[-–—~至]\s*(\d{1,2})\s*:\s*(\d{2})/,
  );
  if (!time) return null;

  const year = Number(time[1]);
  const month = Number(time[2]);
  const day = Number(time[3]);
  const startHour = Number(time[4]);
  const startMinute = Number(time[5]);
  const endHour = Number(time[6]);
  const endMinute = Number(time[7]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const url = meetingLink(normalized);
  const code = meetingCode(normalized);
  if (!url && !code) return null;
  const provider = providerFor(normalized, url);
  if (!provider) return null;

  const offset = explicitOffset(normalized);
  const start = localDate(year, month, day, startHour, startMinute, offset);
  let end = localDate(year, month, day, endHour, endMinute, offset);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }

  return {
    provider,
    start: start.toISOString(),
    end: end.toISOString(),
    url,
    code,
  };
}

export function meetingTimeLabel(info: MeetingInfo): string {
  const start = new Date(info.start);
  const end = new Date(info.end);
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  const endTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(end);
  return `${date}–${endTime}`;
}

export function meetingNotes(
  info: MeetingInfo,
  sender: string,
  date: string,
): string {
  return [
    meetingProviderLabel(info.provider),
    info.code ? `会议号：${info.code}` : "",
    info.url ? `入会链接：${info.url}` : "",
    `发件人：${sender}`,
    `邮件时间：${new Date(date).toLocaleString("zh-CN")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function meetingKey(info: MeetingInfo): string {
  return `${info.start}:${info.end}:${info.url}:${info.code}`;
}
