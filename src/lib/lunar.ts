import { Solar } from "lunar-typescript";

export type LunarTone = "normal" | "festival" | "term";

export type LunarInfo = {
  label: string;
  tone: LunarTone;
  full: string;
};

export function lunarInfo(date: Date): LunarInfo {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  const term = lunar.getJieQi();
  const festivals = [
    ...new Set([...solar.getFestivals(), ...lunar.getFestivals()]),
  ];
  const month = `${lunar.getMonthInChinese()}月`;
  const day = lunar.getDayInChinese();
  const label = term || festivals[0] || (lunar.getDay() === 1 ? month : day);
  const suffix = [
    term,
    festivals.length ? festivals.join("、") : "",
    `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`,
  ].filter(Boolean);
  return {
    label,
    tone: term ? "term" : festivals.length ? "festival" : "normal",
    full: [`农历${month}${day}`, ...suffix].join(" · "),
  };
}
