// 臨時：對 IGDB 送一個 Apicalypse 查詢並印出 JSON（實測欄位用，不印憑證）。
// npx tsx --import ./scripts/load-env.ts scripts/probe-igdb.ts <endpoint> "<body>"
import { IgdbClient, TwitchTokenCache } from "@/modules/catalog/providers/igdb";
import { RequestLimiter, TokenBucket } from "@/modules/catalog/providers/igdb/throttle";

async function main() {
  const [endpoint, body] = process.argv.slice(2);
  const id = process.env.IGDB_CLIENT_ID!;
  const client = new IgdbClient({
    clientId: id,
    tokens: new TwitchTokenCache(id, process.env.IGDB_CLIENT_SECRET!),
    limiter: new RequestLimiter([new TokenBucket(2)], 2),
  });
  const t = Date.now();
  const rows = await client.query<unknown>(endpoint, body);
  console.log(JSON.stringify(rows, null, 1));
  console.error(`${rows.length} rows, ${Date.now() - t} ms`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
