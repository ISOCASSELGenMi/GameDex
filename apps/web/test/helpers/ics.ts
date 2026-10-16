/**
 * 最小的 ics 解析器（測試專用）：展開折行、切出 VEVENT、屬性名稱大寫、還原跳脫字元。
 * 只處理本專案產生的子集（單層 VCALENDAR／VEVENT，沒有巢狀 VALARM），不是通用解析器。
 */
export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface IcsEvent {
  /** 屬性名稱 → 第一個值（重複屬性取第一個）。 */
  get(name: string): string | undefined;
  props: IcsProp[];
}

export interface ParsedIcs {
  calendar: IcsProp[];
  events: IcsEvent[];
  raw: string;
}

export function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").split(/\r\n/).filter((l) => l.length > 0);
}

export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function parseLine(line: string): IcsProp {
  const colon = line.indexOf(":");
  const head = line.slice(0, colon);
  const [name, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: unescapeText(line.slice(colon + 1)) };
}

export function parseIcs(text: string): ParsedIcs {
  const lines = unfold(text);
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") throw new Error("不是完整的 VCALENDAR");
  const calendar: IcsProp[] = [];
  const events: IcsEvent[] = [];
  let current: IcsProp[] | null = null;
  for (const line of lines.slice(1, -1)) {
    if (line === "BEGIN:VEVENT") {
      current = [];
    } else if (line === "END:VEVENT") {
      const props = current ?? [];
      events.push({ props, get: (n) => props.find((p) => p.name === n.toUpperCase())?.value });
      current = null;
    } else {
      (current ?? calendar).push(parseLine(line));
    }
  }
  return { calendar, events, raw: text };
}

export const eventByUid = (ics: ParsedIcs, uid: string): IcsEvent | undefined => ics.events.find((e) => e.get("UID") === uid);

/** 全天事件的日期屬性 `VALUE=DATE:20270402` → `2027-04-02`；不是 DATE 值 → undefined。 */
export function dateValue(ev: IcsEvent, name: "DTSTART" | "DTEND"): string | undefined {
  const p = ev.props.find((x) => x.name === name);
  if (!p || p.params.VALUE !== "DATE") return undefined;
  return `${p.value.slice(0, 4)}-${p.value.slice(4, 6)}-${p.value.slice(6, 8)}`;
}
