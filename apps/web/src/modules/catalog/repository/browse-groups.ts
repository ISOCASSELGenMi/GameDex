/**
 * 遊戲瀏覽頁分組檢視（`/games?by=date|platform|publisher`）的查詢。**篩選條件與瀏覽共用 buildBrowseConditions**（不另寫一套），
 * 分組只是在同一批遊戲上多算一個「組 key」：
 *
 * - date：組＝首發年月（日／月精度 `YYYY-MM`、季精度 `YYYY-Qn`、年精度 `YYYY`、日期未定 `tbd`）。組序：依首發日期（sort=release_date 由舊到新，
 *   其餘由新到舊），`tbd` 永遠最後。
 * - platform：組＝平台 slug（不含 mobile；一款遊戲出現在它每個平台的組）。組序由 Use Case 傳入（平台總覽的分組與排序）。
 * - publisher：組＝廠商欄索引（domain/publisher-groups.ts 的規則寫成 SQL：開發商優先、發行商次之、都不在名單歸 other＝-1；
 *   多個欄位並列取欄位順序最後者）。id 清單只存在 domain 常數，這裡用 unnest 產生對照表；不預先計算、不加欄位。
 *
 * 兩段查詢：(1) 組清單與每組總數（GROUP BY，分頁取一頁的組）；(2) 只針對這些組取每組前 N 張（window function 算組內名次，
 * 組 key 條件推進 base，不掃其他組）。組內排序＝瀏覽的排序（sort），並以 id 作最後的平手條件，讓「顯示更多」的分頁穩定。
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  BrowseGameCard,
  BrowseSort,
  GameGroup,
  GroupedBy,
  ImageResolver,
  IsoDate,
  PlatformKind,
  ResolvedReleaseFilter,
} from "../domain/entities";
import { OTHER_PUBLISHER_KEY, PUBLISHER_COLUMN_KEYS, publisherColumnKeyOfIndex, publisherGroupSqlMap, type PublisherColumnKey } from "../domain/publisher-groups";
import { browseCardColumns, browseRowToCard, buildBrowseConditions, type BrowseRow } from "./browse";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export interface GameGroupFilter {
  filter: ResolvedReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  searchTokens?: string | null;
  sort: BrowseSort;
  locale: string;
  today: IsoDate;
}

export interface ReadGameGroupsInput extends GameGroupFilter {
  by: GroupedBy;
  /** 略過幾組、取幾組（組的分頁）。 */
  groupOffset: number;
  groupLimit: number;
  /** by=platform：平台 slug 的順序（沒列到的排最後）。 */
  platformOrder?: readonly string[];
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
  total: number;
  gname: string | null;
  gkind: PlatformKind | null;
}

interface CardRow extends BrowseRow {
  gkey: string;
  total: number;
  rn: number;
}

/** 日期組 key 的 SQL 運算式（games 別名 g）。 */
const DATE_KEY_SQL = sql`CASE
  WHEN g.first_release_date IS NULL OR g.first_release_precision IS NULL OR g.first_release_precision = 'tbd' THEN 'tbd'
  WHEN g.first_release_precision = 'year' THEN to_char(g.first_release_date, 'YYYY')
  WHEN g.first_release_precision = 'quarter' THEN to_char(g.first_release_date, 'YYYY') || '-Q' || to_char(g.first_release_date, 'Q')
  ELSE to_char(g.first_release_date, 'YYYY-MM') END`;
const DATE_VALUE_SQL = sql`CASE WHEN g.first_release_date IS NULL OR g.first_release_precision IS NULL OR g.first_release_precision = 'tbd' THEN NULL ELSE g.first_release_date END`;

/** 廠商欄 key → SQL 的欄位索引字串（other＝"-1"）；不是合法 key 回 null。 */
export function publisherKeyToIndex(key: string): number | null {
  const i = PUBLISHER_COLUMN_KEYS.indexOf(key as PublisherColumnKey);
  if (i < 0) return null;
  return key === OTHER_PUBLISHER_KEY ? -1 : i;
}

/** 日期組 key 的格式（YYYY-MM、YYYY-Qn、YYYY、tbd）。 */
export function isDateGroupKey(key: string): boolean {
  return key === "tbd" || /^\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?$/.test(key);
}

interface BaseParts {
  /** WITH 的前置 CTE（逗號結尾）；沒有為空。 */
  pre: SQL;
  /** base CTE 的本體：id, gkey, gdate, gname, gkind, popularity_score, name, rdate。 */
  base: SQL;
}

function baseParts(by: GroupedBy, q: GameGroupFilter, keys?: readonly string[]): BaseParts {
  const conds = buildBrowseConditions(q);
  const common = sql`g.id, g.popularity_score, g.name, g.first_release_date AS rdate`;
  if (by === "date") {
    const where = keys ? [...conds, sql`(${DATE_KEY_SQL}) = ANY(${pgArray(keys)}::text[])`] : conds;
    return {
      pre: sql``,
      base: sql`SELECT ${common}, (${DATE_KEY_SQL}) AS gkey, (${DATE_VALUE_SQL}) AS gdate, NULL::text AS gname, NULL::text AS gkind
        FROM games g WHERE ${sql.join(where, sql` AND `)}`,
    };
  }
  if (by === "platform") {
    const where = [...conds, sql`plg.kind <> 'mobile'`, ...(keys ? [sql`plg.slug = ANY(${pgArray(keys)}::text[])`] : [])];
    return {
      pre: sql``,
      base: sql`SELECT ${common}, plg.slug AS gkey, NULL::date AS gdate, plg.name AS gname, plg.kind::text AS gkind
        FROM games g JOIN game_platforms gpg ON gpg.game_id = g.id JOIN platforms plg ON plg.id = gpg.platform_id
        WHERE ${sql.join(where, sql` AND `)}`,
    };
  }
  const { igdbIds, groupIdx } = publisherGroupSqlMap();
  const gkey = sql`COALESCE(mp.idx, -1)::text`;
  const where = keys ? [...conds, sql`${gkey} = ANY(${pgArray(keys)}::text[])`] : conds;
  return {
    // 先由對照表找出名單內的公司，再反查它們的遊戲（只掃名單公司的 game_companies，不是每款遊戲都做一次 lateral）
    pre: sql`mapped AS (
      SELECT gc.game_id,
        COALESCE(MAX(m.idx) FILTER (WHERE gc.role = 'developer'), MAX(m.idx) FILTER (WHERE gc.role = 'publisher')) AS idx
      FROM unnest(${pgArray(igdbIds)}::int[], ${pgArray(groupIdx)}::int[]) AS m(igdb_id, idx)
      JOIN companies co ON co.igdb_id = m.igdb_id
      JOIN game_companies gc ON gc.company_id = co.id AND gc.role IN ('developer', 'publisher')
      GROUP BY gc.game_id
    ),`,
    base: sql`SELECT ${common}, ${gkey} AS gkey, NULL::date AS gdate, NULL::text AS gname, NULL::text AS gkind
      FROM games g LEFT JOIN mapped mp ON mp.game_id = g.id WHERE ${sql.join(where, sql` AND `)}`,
  };
}

function cardOrder(sort: BrowseSort, a: string): SQL {
  const c = (col: string) => sql.raw(`${a}.${col}`);
  return sort === "name"
    ? sql`${c("name")} ASC, ${c("id")} ASC`
    : sort === "release_date"
      ? sql`${c("rdate")} ASC NULLS LAST, ${c("popularity_score")} DESC, ${c("id")} ASC`
      : sql`${c("popularity_score")} DESC, ${c("name")} ASC, ${c("id")} ASC`;
}

/** 組清單查詢（匯出供效能量測與單元測試用）。 */
export function buildGroupListQuery(input: Omit<ReadGameGroupsInput, "resolveImage" | "perGroup">): SQL {
  const { pre, base } = baseParts(input.by, input);
  let order: SQL;
  if (input.by === "date") {
    const dir = input.sort === "release_date" ? sql`ASC` : sql`DESC`;
    order = sql`min(gdate) ${dir} NULLS LAST, gkey ${dir}`;
  } else if (input.by === "platform") {
    order = sql`COALESCE(array_position(${pgArray([...(input.platformOrder ?? [])])}::text[], gkey), 100000), gkey`;
  } else {
    order = sql`(gkey = '-1') ASC, gkey::int ASC`;
  }
  return sql`
    WITH ${pre} base AS (${base})
    SELECT gkey, count(*)::int AS total, max(gname) AS gname, max(gkind) AS gkind
    FROM base
    GROUP BY gkey
    ORDER BY ${order}
    LIMIT ${Math.max(0, Math.floor(input.groupLimit)) + 1} OFFSET ${Math.max(0, Math.floor(input.groupOffset))}
  `;
}

/** 組內卡片查詢（匯出供效能量測與單元測試用）。keys 為 SQL 用的組 key（廠商欄是索引字串）。 */
export function buildGroupCardsQuery(
  q: GameGroupFilter & { by: GroupedBy; keys: readonly string[]; offset: number; limit: number },
): SQL {
  const { pre, base } = baseParts(q.by, q, q.keys);
  const offset = Math.max(0, Math.floor(q.offset));
  const limit = Math.max(0, Math.floor(q.limit));
  // base 只掃一次（MATERIALIZED）：先算每組總數，再對每組各取 [offset, offset+limit) 的 top-N（比對整組做 window 排序便宜）
  return sql`
    WITH ${pre} base AS MATERIALIZED (${base}),
    tot AS (SELECT gkey, count(*)::int AS total FROM base GROUP BY gkey),
    picked AS (
      SELECT t.gkey, t.total, p.id,
        row_number() OVER (PARTITION BY t.gkey ORDER BY ${cardOrder(q.sort, "p")})::int AS rn
      FROM tot t
      CROSS JOIN LATERAL (
        SELECT b.id, b.popularity_score, b.name, b.rdate FROM base b WHERE b.gkey = t.gkey
        ORDER BY ${cardOrder(q.sort, "b")} OFFSET ${offset} LIMIT ${limit}
      ) p
    )
    SELECT r.gkey, r.total, r.rn, ${browseCardColumns(q.locale)}
    FROM picked r JOIN games g ON g.id = r.id
    ORDER BY r.gkey, r.rn
  `;
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
      group = { key, total: r.total, cards: [] };
      const m = meta.get(r.gkey);
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
  const hasMoreGroups = list.rows.length > input.groupLimit;
  const pageRows = list.rows.slice(0, input.groupLimit);
  if (pageRows.length === 0) return { groups: [], hasMoreGroups };
  const meta = new Map(pageRows.map((r) => [r.gkey, r]));
  const cards = await withReadTimeout(
    (tx) => tx.execute<CardRow>(buildGroupCardsQuery({ ...input, keys: pageRows.map((r) => r.gkey), offset: 0, limit: input.perGroup })),
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
  const res = await withReadTimeout(
    (tx) => tx.execute<CardRow>(buildGroupCardsQuery({ ...input, keys: [key] })),
    opts,
  );
  return groupsFromRows(input.by, res.rows, new Map(), input.resolveImage).get(input.key) ?? null;
}
