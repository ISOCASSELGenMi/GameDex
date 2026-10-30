/**
 * Metacritic 遊戲頁的測試 fixture：只保留 2026-10-29 在瀏覽器實際觀察到的與解析有關的結構（91 §Metacritic 實測），
 * 不是整頁拷貝。分數與評論則數是虛構的測試值。
 */
export function gamePageHtml(opts: { meta?: number | "tbd"; metaCount?: number; user?: number | "tbd"; userCount?: number; name?: string; year?: number } = {}): string {
  const { meta = 97, metaCount = 109, user = 8.9, userCount = 27453, name = "Fixture Quest", year = 2017 } = opts;
  const metaBlock =
    meta === "tbd"
      ? `<div data-testid="global-score-wrapper"><div data-testid="global-score-header">Metascore</div><div data-testid="global-score"><div data-testid="global-score-value-wrapper" title="Metascore tbd" aria-label="Metascore tbd"><span data-testid="global-score-value">tbd</span></div></div></div>`
      : `<div data-testid="global-score-wrapper"><div data-testid="global-score-header">Metascore</div><div data-testid="global-score-review-count"><a data-testid="global-score-review-count-link" href="/game/x/critic-reviews/">Based on ${metaCount.toLocaleString("en-US")} Critic Reviews</a></div><div data-testid="global-score"><div title="Metascore ${meta} out of 100" aria-label="Metascore ${meta} out of 100" data-testid="global-score-value-wrapper"><span data-testid="global-score-value">${meta}</span></div></div></div>`;
  const userBlock =
    user === "tbd"
      ? `<div data-testid="global-score-wrapper"><div data-testid="global-score-header">User score</div><div data-testid="global-score"><div data-testid="global-score-value-wrapper"><span data-testid="global-score-value">tbd</span></div></div></div>`
      : `<div data-testid="global-score-wrapper"><div data-testid="global-score-header">User score</div><div data-testid="global-score-review-count"><a data-testid="global-score-review-count-link" href="/game/x/user-reviews/">Based on ${userCount.toLocaleString("en-US")} User Ratings</a></div><div data-testid="global-score"><div title="User score ${user} out of 10" aria-label="User score ${user} out of 10" data-testid="global-score-value-wrapper"><span data-testid="global-score-value">${user}</span></div></div></div>`;
  return `<!DOCTYPE html><html><head><title>${name} Reviews - Metacritic</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoGame","name":"${name}","dateCreated":"${year}-03-03T00:00:00.000Z","datePublished":"${year}-03-03"}</script>
</head><body><div data-testid="product-score">${metaBlock}</div>
<section data-testid="user-reviews"><h2>User Reviews</h2>${userBlock}</section></body></html>`;
}

export const ROBOTS_TXT = `User-agent: AhrefsBot
Disallow: /

User-agent: *
Disallow: /search
Disallow: /signup
Disallow: /user
Disallow: /jl/

User-agent: AmazonAdBot
Allow: /

Sitemap: https://www.metacritic.com/games.xml
`;

export const SITEMAP_INDEX = `<sitemapindex><sitemap><loc>https://www.metacritic.com/games/1.xml</loc></sitemap><sitemap><loc>https://www.metacritic.com/games/2.xml</loc></sitemap></sitemapindex>`;
export const SITEMAP_SHARD = (slugs: string[]) =>
  `<urlset>${slugs.map((s) => `<url><loc>https://www.metacritic.com/game/${s}/</loc><changefreq>weekly</changefreq></url>`).join("")}</urlset>`;

/** 假的 fetch：依路徑回應；記錄所有請求（含 User-Agent）。 */
export function fakeMetacriticFetch(routes: Record<string, { status?: number; body?: string; headers?: Record<string, string> } | (() => { status?: number; body?: string; headers?: Record<string, string> })>) {
  const calls: Array<{ path: string; ua: string | null }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, ua: new Headers(init?.headers).get("user-agent") });
    const r = routes[url.pathname];
    const spec = typeof r === "function" ? r() : r;
    if (!spec) return new Response("not found", { status: 404 });
    return new Response(spec.body ?? "", { status: spec.status ?? 200, headers: spec.headers });
  }) as typeof fetch;
  return { impl, calls };
}
