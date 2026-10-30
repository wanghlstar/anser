import { describe, expect, it } from "vitest";
import { lunarInfo } from "./lunar";

function date(year: number, month: number, day: number) {
  return new Date(year, month - 1, day);
}

describe("lunar calendar labels", () => {
  it("shows the lunar day for a normal date", () => {
    const info = lunarInfo(date(2026, 10, 22));
    expect(info.label).toBe("十三");
    expect(info.tone).toBe("normal");
    expect(info.full).toContain("农历九月十三");
    expect(info.full).toContain("丙午马年");
  });

  it("prefers the solar term on its date", () => {
    const info = lunarInfo(date(2026, 10, 23));
    expect(info.label).toBe("霜降");
    expect(info.tone).toBe("term");
  });

  it("prefers a festival over the lunar day", () => {
    const info = lunarInfo(date(2026, 2, 17));
    expect(info.label).toBe("春节");
    expect(info.tone).toBe("festival");
  });

  it("shows the lunar month on the first day", () => {
    const info = lunarInfo(date(2026, 3, 19));
    expect(info.label).toBe("二月");
  });
});
