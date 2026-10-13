/** e2e fixture 的固定值（seed.ts 寫入、測試斷言共用；不 import 任何 DB 程式）。 */
export const FIXTURE_MONTH = "2036-05";
export const FIXTURE = {
  month: FIXTURE_MONTH,
  prevMonth: "2036-04",
  nextMonth: "2036-06",
  multiPlatformDay: "2036-05-15",
  busyDay: "2036-05-08",
  busyCount: 8,
  eventDay: "2036-05-12",
  hero: { slug: "e2e-aurora-odyssey", name: "Aurora Odyssey", zhName: "極光奧德賽" },
  monthPrecision: { slug: "e2e-month-precision", name: "Misty Month Game" },
  event: { name: "E2E Showcase 2036" },
  platformPs5: "e2e-ps5",
  platformSwitch: "e2e-switch",
  genreRpg: "role-playing-rpg",
  genreShooter: "shooter",
} as const;
