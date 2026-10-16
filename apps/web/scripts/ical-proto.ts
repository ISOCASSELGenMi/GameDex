// iCal 原型驗證（08、15 Phase 5）：切換 /ical/_proto/{a,b}.ics 的情境，並把每一步寫進 .local/ical-proto/log.md。
//   npm -w apps/web run ical:proto -- init        建立初始狀態（會覆寫舊的 state.json；log.md 不清除，接著寫）
//   npm -w apps/web run ical:proto -- region      同 UID 換地區屬性與日期
//   npm -w apps/web run ical:proto -- tbd         一款延期成 tbd
//   npm -w apps/web run ical:proto -- cancel      一款取消；restore 復原
//   npm -w apps/web run ical:proto -- seq-only    只改標題，SEQUENCE（a）+1
//   npm -w apps/web run ical:proto -- no-seq      日期改變但 SEQUENCE 不動
//   npm -w apps/web run ical:proto -- show [a|b]  印出目前的 ics（預設兩個都印）
//   npm -w apps/web run ical:proto -- status      目前進度
// 不碰資料庫。需要伺服器以 ICAL_PROTO_ENABLED=true 執行，且對外網址可被行事曆服務存取（docs/ical-prototype.md）。
import {
  PROTO_FEEDS,
  PROTO_STEPS,
  applyProtoStep,
  icalUidDomain,
  isProtoFeedName,
  isProtoStep,
  parseProtoState,
  renderProtoFeed,
  type ProtoState,
} from "@/modules/catalog/use-cases/ical";
import { appendProtoLog, protoDir, readProtoStateRaw, writeProtoStateRaw } from "@/modules/catalog/providers/ical-proto-store";

function renderOpts() {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  const origin = new URL(site).origin;
  return {
    locale: (process.env.DEFAULT_LOCALE?.trim() || "zh-Hant") as "zh-Hant" | "en" | "ja",
    uidDomain: icalUidDomain(process.env.NEXT_PUBLIC_SITE_URL),
    links: { game: (slug: string) => `${origin}/games/${slug}`, event: (slug: string) => `${origin}/events/${slug}` },
  };
}

async function load(): Promise<ProtoState | null> {
  const raw = await readProtoStateRaw();
  return raw === null ? null : parseProtoState(raw);
}

function usage(): never {
  console.error(`用法：npm -w apps/web run ical:proto -- <${[...PROTO_STEPS, "show", "status"].join("|")}>`);
  process.exit(1);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd) usage();
  const prev = await load();

  if (cmd === "status") {
    console.log(prev ? `目前：第 ${prev.stepNo} 步（${prev.step}），${prev.at.toISOString()}\n目錄：${protoDir()}` : "尚未 init");
    return;
  }
  if (cmd === "show") {
    if (!prev) throw new Error("尚未 init");
    const which = process.argv[3];
    const feeds = which ? (isProtoFeedName(which) ? [which] : usage()) : [...PROTO_FEEDS];
    for (const f of feeds) {
      console.log(`===== ${f}.ics =====`);
      console.log(renderProtoFeed(prev, f, renderOpts()));
    }
    return;
  }
  if (!isProtoStep(cmd)) usage();

  const now = new Date();
  const result = applyProtoStep(prev, cmd, now);
  await writeProtoStateRaw(result.state);
  const stamp = now.toISOString();
  await appendProtoLog(
    [
      `## 第 ${result.state.stepNo} 步：${cmd}（${stamp}）`,
      "",
      `- 動作：${result.change}`,
      `- 預期客戶端行為：${result.expect}`,
      "- 實際觀察：請填在 docs/ical-prototype.md 的紀錄表（Apple、Google 各一列），或直接寫在這裡。",
      "",
    ].join("\n"),
  );
  console.log(`第 ${result.state.stepNo} 步 ${cmd}（${stamp}）`);
  console.log(`動作：${result.change}`);
  console.log(`預期：${result.expect}`);
  console.log(`已寫入 ${protoDir()}（state.json、log.md）。之後到行事曆「重新整理／同步」，再對照上面的預期。`);
}

main().catch((err) => {
  console.error("[ical-proto] 失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
