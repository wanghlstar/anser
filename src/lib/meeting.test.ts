import { describe, expect, it } from "vitest";
import { meetingNotes, meetingProviderLabel, parseMeeting } from "./meeting";

describe("parseMeeting", () => {
  it("parses a WeCom invitation", () => {
    const info = parseMeeting(`会议时间：2026/10/19 16:10-17:10 (GMT+08:00)

点击链接直接加入会议：
https://work.weixin.qq.com/webapp/tm/oraqwVNKFNh

#企业微信会议：876-510-038`);
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("wecom");
    expect(info!.start).toBe("2026-10-19T08:10:00.000Z");
    expect(info!.end).toBe("2026-10-19T09:10:00.000Z");
    expect(info!.url).toBe("https://work.weixin.qq.com/webapp/tm/oraqwVNKFNh");
    expect(info!.code).toBe("876-510-038");
    expect(meetingProviderLabel(info!.provider)).toBe("企业微信会议");
  });

  it("parses a Tencent Meeting invitation", () => {
    const info =
      parseMeeting(`会议时间：2026/10/16 14:31-15:31 (GMT+08:00) 中国标准时间 - 北京

点击链接直接加入会议：
https://meeting.tencent.com/dm/lW9AXeR8BUpk

#腾讯会议：849-511-867`);
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("tencent");
    expect(info!.start).toBe("2026-10-16T06:31:00.000Z");
    expect(info!.end).toBe("2026-10-16T07:31:00.000Z");
    expect(info!.code).toBe("849-511-867");
  });

  it("ignores ordinary mail with a time but no meeting link", () => {
    expect(parseMeeting("会议时间：2026/10/19 16:10-17:10")).toBeNull();
    expect(parseMeeting("明天下午开会，请准时参加。")).toBeNull();
  });

  it("builds notes with link, code and source details", () => {
    const info = parseMeeting(`会议时间：2026/10/19 16:10-17:10 (GMT+08:00)
https://meeting.tencent.com/dm/abc
#腾讯会议：123-456-789`)!;
    const notes = meetingNotes(
      info,
      "张三 <a@example.com>",
      "2026-10-18T00:00:00Z",
    );
    expect(notes).toContain("腾讯会议");
    expect(notes).toContain("会议号：123-456-789");
    expect(notes).toContain("入会链接：https://meeting.tencent.com/dm/abc");
    expect(notes).toContain("发件人：张三 <a@example.com>");
  });
});
