/** UTC 今天（YYYY-MM-DD）的唯一實作（「今天」一律用 UTC 日期，見 handoff 已定案）。零外部依賴。 */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
