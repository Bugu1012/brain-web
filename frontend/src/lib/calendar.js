import { Solar } from "lunar-javascript";

export function lunarInfo(d) {
  const s = Solar.fromDate(d);
  const l = s.getLunar();
  const lunar = l.getYearInGanZhi() + "年" + l.getMonthInChinese() + "月" + l.getDayInChinese();
  const festivals = [...s.getFestivals(), ...l.getFestivals()];
  const other = [...s.getOtherFestivals(), ...l.getOtherFestivals()];
  const festival = festivals[0] || other[0] || "";
  const jieqi = l.getJieQi();
  return { lunar, festival, jieqi };
}
