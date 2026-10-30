/**
 * 遊戲瀏覽頁分組檢視（`/games?by=date|platform|publisher`）的查詢。**篩選條件與瀏覽共用 buildBrowseConditions**（不另寫一套），
 * 分組只是在同一批遊戲上多算一個「組 key」：
 *
 * - date：組＝games.release_group（預先計算：首發年月 `YYYY-MM`、季精度 `YYYY-Qn`、年精度 `YYYY`、日期未定 `tbd`；規則在
 *   domain/game-group-keys.ts，由寫入路徑與 backfill_game_groups 維護）。組序固定是時間順序，沒有組排序參數，`tbd` 永遠最後：
 *   沒有起算月（預設）＝當月起往未來由近到遠（涵蓋當月的季/年組算當月）→ 往過去由新到舊（依結束月）→ `tbd`（D88）；
 *   有起算月（groupFrom，`YYYY-MM`）＝期間結束月 ≥ 起算月的組由舊到新（涵蓋起算月的季/年組算起算月）→ `tbd`；更早的組不列（UI 用「往前看」連結換起算月）。
 * - platform：組＝平台 slug（不含 mobile；一款遊戲出現在它每個平台的組）。
 * - publisher：組＝games.publisher_group（預先計算的廠商欄索引，規則在 domain/publisher-groups.ts publisherGroupIndexOfGame；-1＝other）。
 *   平台與廠商的組序由使用者選（groupOrder：最新發售日／遊戲數／名稱，升降冪；預設最新發售日由新到舊），other 永遠最後。
 *   組數少（平台約百個、廠商約四十個），所以組清單一次取全部（含 max 發售日與總數），在 {@link sortGroupRows} 排序後再切頁；名稱排序要用介面語系的組名，SQL 做不到。
 *
 * 兩段查詢：(1) 組清單與每組總數（GROUP BY；date 在 SQL 排序分頁；date／publisher 走分組 index 的 index-only scan）；
 * (2) 只針對這些組，每組一個子查詢依排序鍵取 [offset, offset+limit)（index 已排好，LIMIT 提早結束）。
 * **組內排序固定＝發售日由新到舊**（未定日期最後），再依熱度、id 作平手條件，讓「顯示更多」的分頁穩定；不受瀏覽頁 sort 參數影響。
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  BrowseGameCard,
  GameGroup,
  GroupedBy,
  GroupOrder,
  ImageResolver,
  IsoDate,
  PlatformKind,
  ResolvedReleaseFilter,
} from "../domain/entities";
import { TBD_RELEASE_GROUP } from "../domain/game-group-keys";
import {
  OTHER_PUBLISHER_KEY,
  PUBLISHER_COLUMN_KEYS,
  publisherColumnKeyOfIndex,
  publisherColumnName,
  type PublisherColumnKey,
} from "../domain/publisher-groups";
import { browseCardColumns, browseRowToCard, buildBrowseConditions, type BrowseRow } from "./browse";
import { withReadTimeout, type ReadOptions } from "./read-tx";

export interface GameGroupFilter {
  filter: ResolvedReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  searchTokens?: string | null;
  locale: string;
  today: IsoDate;
}

export interface ReadGameGroupsInput extends GameGroupFilter {
  by: GroupedBy;
  /** 略過幾組、取幾組（組的分頁）。 */
  groupOffset: number;
  groupLimit: number;
  /** by=platform／publisher 的組排序（by=date 忽略）。 */
  groupOrder: GroupOrder;
  /** by=date：起算月 `YYYY-MM`（未給＝預設的「當月起」順序）。 */
  groupFrom?: string | null;
  /** 每組先取幾張。 */
  perGroup: number;
  resolveImage: ImageResolver;
}

export interface ReadGameGroupPageInput extends GameGroupFilter {
  by: GroupedBy;
  /** 組 key（格式依 by）。 */
  key: string;
  offset: number;
  limit: number;
  resolveImage: ImageResolver;
}

interface GroupRow extends Record<string, unknown> {
  gkey: string;
  /** by=platform：平台 id（卡片查詢用）。 */
  gid?: number | null;
  total: number;
  gname: string | null;
  gkind: PlatformKind | null;
  /** by=platform／publisher：組內最新的首發日（max first_release_date，YYYY-MM-DD；全組都沒有日期為 null）。 */
  latest?: string | null;
}

interface CardRow extends BrowseRow {
  gkey: string;
  rn: number;
}

/** 廠商欄 key → SQL 的欄位索引（other＝-1）；不是合法 key 回 null。 */
export function publisherKeyToIndex(key: string): number | null {
  const i = PUBLISHER_COLUMN_KEYS.indexOf(key as PublisherColumnKey);
  if (i < 0) return null;
  return key === OTHER_PUBLISHER_KEY ? -1 : i;
}

/** 日期組 key 的格式（YYYY-MM、YYYY-Qn、YYYY、tbd）。 */
export function isDateGroupKey(key: string): boolean {
  return key === TBD_RELEASE_GROUP || /^\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?$/.test(key);
}

/**
 * 一個組的遊戲來源（FROM games g ＋ 條件）。date／publisher 是預先計算的欄位（release_group、publisher_group），同一組的遊戲在
 * index（games_release_group_browse_idx、games_publisher_group_browse_idx）上相鄰，且組內排序鍵（熱度、名稱、id）與篩選用欄位都在 index 裡；
 * platform 以 game_platforms 的 EXISTS 過濾，並用熱度排序的 index（games_browse_pop_idx）依序掃描、遇到足夠筆數就停。
 * 平台 id 由呼叫端先查好、當成參數傳入，讓規劃器看得到實際平台大小（大平台沿熱度 index 掃、小平台直接從 game_platforms 取）。
 */
function groupSource(by: GroupedBy, key: string, platformId: number | null | undefined): SQL[] {
  if (by === "date") return [sql`g.release_group = ${key}`];
  if (by === "publisher") return [sql`g.publisher_group = ${Number(key)}`];
  const platform = platformId != null ? sql`${platformId}` : sql`(SELECT id FROM platforms WHERE slug = ${key} AND kind <> 'mobile')`;
  return [sql`EXISTS (SELECT 1 FROM game_platforms gpg WHERE gpg.game_id = g.id AND gpg.platform_id = ${platform})`];
}

/** release_group（YYYY-MM、YYYY-Qn、YYYY）→ 期間起始月 `YYYY-MM` 的 SQL 運算式（tbd 回 'tbd'，呼叫端另外排最後）。 */
function releaseGroupStartMonthSql(col: string): SQL {
  const c = sql.raw(col);
  return sql`(CASE
    WHEN ${c} ~ '^[0-9]{4}-Q[1-4]$' THEN substr(${c}, 1, 4) || '-' || lpad((((substr(${c}, 7, 1))::int - 1) * 3 + 1)::text, 2, '0')
    WHEN ${c} ~ '^[0-9]{4}$' THEN ${c} || '-01'
    ELSE ${c}
  END)`;
}

/** release_group → 期間結束月 `YYYY-MM`（月＝自己、季＝該季最後一個月、年＝12 月）。 */
function releaseGroupEndMonthSql(col: string): SQL {
  const c = sql.raw(col);
  return sql`(CASE
    WHEN ${c} ~ '^[0-9]{4}-Q[1-4]$' THEN substr(${c}, 1, 4) || '-' || lpad(((substr(${c}, 7, 1))::int * 3)::text, 2, '0')
    WHEN ${c} ~ '^[0-9]{4}$' THEN ${c} || '-12'
    ELSE ${c}
  END)`;
}

/** 組內排序（固定）：發售日由新到舊（未定最後）→ 熱度 → id。對應 index games_browse_date_desc_idx／games_release_group_date_idx／games_publisher_group_date_idx。 */
function cardOrder(a: string, dateCol: string): SQL {
  const c = (col: string) => sql.raw(`${a}.${col}`);
  return sql`${c(dateCol)} DESC NULLS LAST, ${c("popularity_score")} DESC NULLS LAST, ${c("id")} ASC`;
}

/** 平台／廠商組清單的一列（排序用的最小欄位）。 */
export interface SortableGroupRow {
  /** SQL 的組 key（平台 slug；廠商欄索引字串，-1＝other）。 */
  gkey: string;
  total: number;
  gname?: string | null;
  latest?: string | null;
}

/**
 * 平台／廠商的組排序（純函式，單元測試覆蓋）。latest＝組內 max 首發日（沒有日期的組永遠最後，不論升降冪）、count＝組內遊戲數、name＝組名稱（依介面語系）；
 * 平手依序比：遊戲數多的在前、名稱、key。「獨立／其他」（廠商 -1）永遠最後。
 */
export function sortGroupRows<T extends SortableGroupRow>(rows: readonly T[], by: Exclude<GroupedBy, "date">, order: GroupOrder, locale: string): T[] {
  const nameOf = (r: T): string => (by === "platform" ? (r.gname ?? r.gkey) : publisherColumnName(publisherColumnKeyOfIndex(Number(r.gkey)), locale));
  const names = new Map(rows.map((r) => [r.gkey, nameOf(r)]));
  const sign = order.dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => names.get(a.gkey)!.localeCompare(names.get(b.gkey)!, locale) || (a.gkey < b.gkey ? -1 : a.gkey > b.gkey ? 1 : 0);
  const isOther = (r: T) => by === "publisher" && Number(r.gkey) < 0;
  return [...rows].sort((a, b) => {
    if (isOther(a) !== isOther(b)) return isOther(a) ? 1 : -1;
    if (order.sort === "latest") {
      const x = a.latest ?? null;
      const y = b.latest ?? null;
      if ((x === null) !== (y === null)) return x === null ? 1 : -1;
      if (x !== null && y !== null && x !== y) return (x < y ? -1 : 1) * sign;
      return b.total - a.total || byName(a, b);
    }
    if (order.sort === "count") return (a.total - b.total) * sign || byName(a, b);
    return byName(a, b) * sign;
  });
}

/**
 * 組清單查詢（匯出供效能量測與單元測試用）。date：已排序並分頁（一頁的組＋每組符合條件的總數）；
 * platform／publisher：**全部的組**（不排序、不分頁；每組總數與 latest＝組內 max 首發日），由 {@link sortGroupRows} 排序後切頁。
 */
export function buildGroupListQuery(input: Omit<ReadGameGroupsInput, "resolveImage" | "perGroup">): SQL {
  const conds = buildBrowseConditions(input);
  const page = sql`LIMIT ${Math.max(0, Math.floor(input.groupLimit)) + 1} OFFSET ${Math.max(0, Math.floor(input.groupOffset))}`;
  if (input.by === "date" && input.groupFrom) {
    // 指定起算月：期間結束月 ≥ 起算月的組（含涵蓋起算月的季／年組）由舊到新，日期未定最後；更早的組不列
    const start = releaseGroupStartMonthSql("g.release_group");
    const end = releaseGroupEndMonthSql("g.release_group");
    const from = input.groupFrom;
    return sql`
      SELECT g.release_group AS gkey, count(*)::int AS total, NULL::text AS gname, NULL::text AS gkind
      FROM games g WHERE ${sql.join(conds, sql` AND `)}
      GROUP BY g.release_group
      HAVING g.release_group = ${TBD_RELEASE_GROUP} OR ${end} >= ${from}::text
      ORDER BY (g.release_group = ${TBD_RELEASE_GROUP}) ASC,
        greatest(${start}, ${from}::text) ASC,
        (CASE WHEN g.release_group ~ '^[0-9]{4}-[0-9]{2}$' THEN 0 WHEN g.release_group ~ '^[0-9]{4}-Q' THEN 1 ELSE 2 END) ASC,
        g.release_group ASC
      ${page}
    `;
  }
  if (input.by === "date") {
    // 預設順序（D88）：當月起往未來由近到遠 → 再往過去由新到舊 → 日期未定最後。組的期間 [起始月, 結束月] 由 release_group 字串推得
    // （月 YYYY-MM；季 YYYY-Qn；年 YYYY）。期間涵蓋當月的季／年組視為「當月」；完全在未來的依起始月排進未來段；完全在過去的依結束月排進過去段。
    // 同一時間點的組，精度細的在前（月 → 季 → 年）。
    const start = releaseGroupStartMonthSql("g.release_group");
    const end = releaseGroupEndMonthSql("g.release_group");
    const month = input.today.slice(0, 7);
    const isPast = sql`(${end} < ${month}::text)`;
    return sql`
      SELECT g.release_group AS gkey, count(*)::int AS total, NULL::text AS gname, NULL::text AS gkind
      FROM games g WHERE ${sql.join(conds, sql` AND `)}
      GROUP BY g.release_group
      ORDER BY (g.release_group = ${TBD_RELEASE_GROUP}) ASC,
        ${isPast} ASC,
        CASE WHEN NOT ${isPast} THEN greatest(${start}, ${month}::text) END ASC,
        CASE WHEN ${isPast} THEN ${end} END DESC,
        (CASE WHEN g.release_group ~ '^[0-9]{4}-[0-9]{2}$' THEN 0 WHEN g.release_group ~ '^[0-9]{4}-Q' THEN 1 ELSE 2 END) ASC,
        g.release_group ASC
      ${page}
    `;
  }
  if (input.by === "platform") {
    // 先用整數 platform_id 分組（hash aggregate），再 join 平台資料；對 slug 字串分組排序在 30 萬列上要排序 1~2 秒
    return sql`
      WITH t AS (
        SELECT gpg.platform_id AS pid, count(*)::int AS total, max(g.first_release_date)::text AS latest
        FROM games g JOIN game_platforms gpg ON gpg.game_id = g.id
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY gpg.platform_id
      )
      SELECT plg.slug AS gkey, plg.id AS gid, t.total, t.latest, plg.name AS gname, plg.kind::text AS gkind
      FROM t JOIN platforms plg ON plg.id = t.pid
      WHERE plg.kind <> 'mobile'
    `;
  }
  return sql`
    SELECT g.publisher_group::text AS gkey, count(*)::int AS total, max(g.first_release_date)::text AS latest, NULL::text AS gname, NULL::text AS gkind
    FROM games g WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY g.publisher_group
  `;
}

/**
 * 某幾組各自 [offset, offset+limit) 的卡片（匯出供效能量測與單元測試用）。keys 為 SQL 用的組 key（廠商欄是索引字串）；
 * by=platform 時 platformIds 與 keys 一一對應（沒給就在 SQL 內用 slug 查）。
 */
export function buildGroupCardsQuery(
  q: GameGroupFilter & { by: GroupedBy; keys: readonly string[]; platformIds?: readonly number[]; offset: number; limit: number },
): SQL {
  const conds = buildBrowseConditions(q);
  const offset = Math.max(0, Math.floor(q.offset));
  const limit = Math.max(0, Math.floor(q.limit));
  // 每組一個子查詢（UNION ALL，各自帶實際的組 key 規劃）：用組的 index 依排序鍵取 [offset, offset+limit)（熱度排序時 index 已排好，
  // LIMIT 提早結束）；不掃其他組、不對整組排序
  const perKey = q.keys.map(
    (key, i) => sql`(
      SELECT ${key}::text AS gkey, g.id, g.popularity_score, g.name, g.first_release_date AS rdate
      FROM games g
      WHERE ${sql.join([...groupSource(q.by, key, q.platformIds?.[i]), ...conds], sql` AND `)}
      ORDER BY ${cardOrder("g", "first_release_date")}
      OFFSET ${offset} LIMIT ${limit}
    )`,
  );
  return sql`
    WITH picked AS (
      SELECT u.gkey, u.id, row_number() OVER (PARTITION BY u.gkey ORDER BY ${cardOrder("u", "rdate")})::int AS rn
      FROM (${sql.join(perKey, sql` UNION ALL `)}) u
    )
    SELECT r.gkey, r.rn, ${browseCardColumns(q.locale)}
    FROM picked r JOIN games g ON g.id = r.id
    ORDER BY r.gkey, r.rn
  `;
}

/** 單一組符合條件的總數（「顯示更多」API 用；組清單查詢已經有總數）。 */
export function buildGroupCountQuery(q: GameGroupFilter & { by: GroupedBy; key: string; platformId?: number | null }): SQL {
  const conds = buildBrowseConditions(q);
  return sql`SELECT count(*)::int AS total FROM games g WHERE ${sql.join([...groupSource(q.by, q.key, q.platformId), ...conds], sql` AND `)}`;
}

function platformIdsOf(by: GroupedBy, rows: readonly GroupRow[]): { platformIds?: number[] } {
  return by === "platform" && rows.every((r) => r.gid != null) ? { platformIds: rows.map((r) => r.gid as number) } : {};
}

function sqlKey(by: GroupedBy, key: string): string | null {
  if (by === "publisher") {
    const i = publisherKeyToIndex(key);
    return i === null ? null : String(i);
  }
  return key;
}

function displayKey(by: GroupedBy, sqlKeyValue: string): string {
  return by === "publisher" ? publisherColumnKeyOfIndex(Number(sqlKeyValue)) : sqlKeyValue;
}

function groupsFromRows(by: GroupedBy, rows: readonly CardRow[], meta: ReadonlyMap<string, GroupRow>, resolveImage: ImageResolver): Map<string, GameGroup> {
  const groups = new Map<string, GameGroup>();
  for (const r of rows) {
    const key = displayKey(by, r.gkey);
    let group = groups.get(key);
    if (!group) {
      const m = meta.get(r.gkey);
      group = { key, total: m?.total ?? 0, cards: [] };
      if (by === "platform" && m?.gname && m.gkind) group.platform = { slug: key, name: m.gname, kind: m.gkind };
      groups.set(key, group);
    }
    group.cards.push(browseRowToCard(r, resolveImage) satisfies BrowseGameCard);
  }
  return groups;
}

/**
 * 一頁的組（已排序）＋每組前 perGroup 張；hasMoreGroups＝後面還有組。沒有符合的組不會出現。
 */
export async function readGameGroups(input: ReadGameGroupsInput, opts: ReadOptions = {}): Promise<{ groups: GameGroup[]; hasMoreGroups: boolean }> {
  const list = await withReadTimeout((tx) => tx.execute<GroupRow>(buildGroupListQuery(input)), opts);
  // date 已在 SQL 排序並分頁（多取一組判斷有沒有下一頁）；platform／publisher 取回全部的組，這裡排序後切頁
  const rows =
    input.by === "date"
      ? list.rows
      : sortGroupRows(list.rows, input.by, input.groupOrder, input.locale).slice(
          Math.max(0, Math.floor(input.groupOffset)),
          Math.max(0, Math.floor(input.groupOffset)) + Math.max(0, Math.floor(input.groupLimit)) + 1,
        );
  const hasMoreGroups = rows.length > input.groupLimit;
  const pageRows = rows.slice(0, input.groupLimit);
  if (pageRows.length === 0) return { groups: [], hasMoreGroups };
  const meta = new Map(pageRows.map((r) => [r.gkey, r]));
  const cards = await withReadTimeout(
    (tx) => tx.execute<CardRow>(buildGroupCardsQuery({ ...input, keys: pageRows.map((r) => r.gkey), ...platformIdsOf(input.by, pageRows), offset: 0, limit: input.perGroup })),
    opts,
  );
  const byKey = groupsFromRows(input.by, cards.rows, meta, input.resolveImage);
  return {
    hasMoreGroups,
    groups: pageRows.map((r): GameGroup => {
      const key = displayKey(input.by, r.gkey);
      return byKey.get(key) ?? { key, total: r.total, cards: [] };
    }),
  };
}

/** 某一組的一段卡片（「顯示更多」）。組 key 不合法或沒有資料回 null。 */
export async function readGameGroupPage(input: ReadGameGroupPageInput, opts: ReadOptions = {}): Promise<GameGroup | null> {
  const key = sqlKey(input.by, input.key);
  if (key === null) return null;
  const { cards, total } = await withReadTimeout(async (tx) => {
    let platformId: number | null | undefined;
    if (input.by === "platform") {
      const p = await tx.execute<{ id: number }>(sql`SELECT id FROM platforms WHERE slug = ${key} AND kind <> 'mobile'`);
      platformId = p.rows[0]?.id ?? null;
      if (platformId === null) return { cards: { rows: [] as CardRow[] }, total: 0 };
    }
    const platformIds = platformId != null ? { platformIds: [platformId] } : {};
    const cards = await tx.execute<CardRow>(buildGroupCardsQuery({ ...input, keys: [key], ...platformIds }));
    if (cards.rows.length === 0) return { cards, total: 0 };
    const count = await tx.execute<{ total: number }>(buildGroupCountQuery({ ...input, key, platformId }));
    return { cards, total: count.rows[0]?.total ?? 0 };
  }, opts);
  if (cards.rows.length === 0) return null;
  return groupsFromRows(input.by, cards.rows, new Map([[key, { gkey: key, total, gname: null, gkind: null }]]), input.resolveImage).get(input.key) ?? null;
}
