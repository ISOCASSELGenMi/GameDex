/**
 * 公司頁 `/[locale]/companies/[slug]` 與系列頁 `/[locale]/franchises/[slug]`（06 §路由）。伺服器元件。
 * 公司頁可依角色篩選（`?role=`）；系列頁以 `?kind=franchise|collection` 區分同 slug 的兩種系列。
 */
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { cache, type ReactElement } from "react";
import { formatNumber, type Locale } from "@sok/i18n";
import type { CompanyPage, FranchisePage } from "../../domain/entities";
import { getCompanyPage } from "../../use-cases/read/get-company-page";
import { getFranchisePage } from "../../use-cases/read/get-franchise-page";
import { ExternalIcon } from "../icons";
import { joinList } from "../calendar/view-model";
import { getTranslator } from "../labels";
import { PageShell } from "../layout/page-shell";
import { companyHref, franchiseHref } from "../links";
import { rethrowForPage } from "../page-errors";
import { EntityGameList, EntityLogo, LinkTabs, Pager } from "./shared";
import type { EntitySearchParams } from "./platform-pages";
import {
  firstParam,
  pagingForPage,
  parseCompanyRole,
  parseFranchiseKind,
  parsePageParam,
  rolesWithCounts,
  safeDecode,
} from "./view-model";

// ── 公司 ────────────────────────────────────────────────────────────────

export const loadCompanyPage = cache(
  async (slug: string, locale: Locale, role: string, page: number): Promise<CompanyPage | null> => {
    await connection();
    try {
      return await getCompanyPage({ slug: safeDecode(slug), locale, role: role || null, ...pagingForPage(page) });
    } catch (err) {
      rethrowForPage(err);
    }
  },
);

function companyParams(sp: EntitySearchParams) {
  return { role: parseCompanyRole(firstParam(sp.role)), page: parsePageParam(firstParam(sp.page)) };
}

export async function companyPageTitle(slug: string, locale: Locale, sp: EntitySearchParams): Promise<string | null> {
  const { role, page } = companyParams(sp);
  const data = await loadCompanyPage(slug, locale, role ?? "", page);
  return data ? data.company.name : null;
}

export async function CompanyDetailPage({
  locale,
  supportedLocales,
  slug,
  searchParams,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slug: string;
  searchParams: EntitySearchParams;
}): Promise<ReactElement> {
  const { role, page } = companyParams(searchParams);
  const data = await loadCompanyPage(slug, locale, role ?? "", page);
  if (!data) notFound();
  const t = getTranslator(locale);
  const c = data.company;
  const roleLabel = (r: string) => t.t(`enums.gameCompanyRole.${r}`);
  const tabs = [
    {
      key: "all",
      href: companyHref(locale, c.slug),
      text: t.t("ui.common.withCount", { label: t.t("ui.companies.allRoles"), count: formatNumber(data.total, locale) }),
      current: data.role === null,
    },
    ...rolesWithCounts(data.roleCounts).map((r) => ({
      key: r,
      href: companyHref(locale, c.slug, 1, { role: r }),
      text: t.t("ui.common.withCount", { label: roleLabel(r), count: formatNumber(data.roleCounts[r], locale) }),
      current: data.role === r,
    })),
  ];
  const query = [data.role ? `role=${data.role}` : "", page > 1 ? `page=${page}` : ""].filter(Boolean).join("&");

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/companies/${c.slug}`} query={query}>
      <div className="flex flex-wrap items-center gap-4">
        <EntityLogo logo={c.logo} name={c.name} />
        <h1 className="text-3xl font-bold [overflow-wrap:anywhere]">{c.name}</h1>
      </div>
      {c.websiteUrl ? (
        <p className="mt-2">
          <a className="ext-link" href={c.websiteUrl} target="_blank" rel="noopener noreferrer">
            {t.t("ui.companies.website")} <ExternalIcon />
            <span className="sr-only">{t.t("a11y.opensInNewWindow")}</span>
          </a>
        </p>
      ) : null}
      <h2 className="mt-6 text-xl font-semibold">{t.t("ui.companies.worksTitle")}</h2>
      <LinkTabs label={t.t("ui.companies.roleFilter")} items={tabs} />
      <p role="status" className="mt-2 text-sm text-[var(--muted)]">
        {t.t("ui.entities.shownOnPage", { count: data.works.items.length })}
      </p>
      {data.works.items.length === 0 ? (
        <p className="mt-4">{t.t("ui.companies.empty")}</p>
      ) : (
        <EntityGameList
          items={data.works.items}
          locale={locale}
          t={t}
          extra={(it) => {
            const roles = (it as { roles?: string[] }).roles ?? [];
            return roles.length > 0 ? <span className="text-sm">{joinList(locale, roles.map(roleLabel))}</span> : null;
          }}
        />
      )}
      <Pager
        t={t}
        page={page}
        hasMore={data.works.hasMore}
        hrefFor={(n) => companyHref(locale, c.slug, n, { role: data.role })}
        label={t.t("ui.entities.pagination")}
      />
    </PageShell>
  );
}

// ── 系列 ────────────────────────────────────────────────────────────────

export const loadFranchisePage = cache(
  async (slug: string, locale: Locale, kind: string, page: number): Promise<FranchisePage | null> => {
    await connection();
    try {
      return await getFranchisePage({ slug: safeDecode(slug), locale, kind: kind || null, ...pagingForPage(page) });
    } catch (err) {
      rethrowForPage(err);
    }
  },
);

function franchiseParams(sp: EntitySearchParams) {
  return { kind: parseFranchiseKind(firstParam(sp.kind)), page: parsePageParam(firstParam(sp.page)) };
}

export async function franchisePageTitle(slug: string, locale: Locale, sp: EntitySearchParams): Promise<string | null> {
  const { kind, page } = franchiseParams(sp);
  const data = await loadFranchisePage(slug, locale, kind ?? "", page);
  return data ? data.franchise.name : null;
}

export async function FranchiseDetailPage({
  locale,
  supportedLocales,
  slug,
  searchParams,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slug: string;
  searchParams: EntitySearchParams;
}): Promise<ReactElement> {
  const { kind, page } = franchiseParams(searchParams);
  const data = await loadFranchisePage(slug, locale, kind ?? "", page);
  if (!data) notFound();
  const t = getTranslator(locale);
  const f = data.franchise;
  const kindLabel = (k: string) => t.t(`ui.franchises.kind.${k}`);
  const query = [f.kind === "collection" ? "kind=collection" : "", page > 1 ? `page=${page}` : ""].filter(Boolean).join("&");

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path={`/franchises/${f.slug}`} query={query}>
      <h1 className="text-3xl font-bold [overflow-wrap:anywhere]">{f.name}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="chip">{kindLabel(f.kind)}</span>
        <span>{t.t("ui.franchises.total", { count: formatNumber(data.total, locale) })}</span>
      </p>
      {f.otherKinds.length > 0 ? (
        <nav aria-label={t.t("ui.franchises.otherKindsLabel")} className="mt-3">
          <p className="text-sm text-[var(--muted)]">{t.t("ui.franchises.otherKindsHint")}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {f.otherKinds.map((k) => (
              <li key={k}>
                <a className="btn-secondary" href={franchiseHref(locale, f.slug, k)}>
                  {t.t("ui.franchises.switchTo", { kind: kindLabel(k) })}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <h2 className="mt-6 text-xl font-semibold">{t.t("ui.franchises.worksTitle")}</h2>
      <p className="text-sm text-[var(--muted)]">{t.t("ui.franchises.orderNote")}</p>
      <p role="status" className="mt-1 text-sm text-[var(--muted)]">
        {t.t("ui.entities.shownOnPage", { count: data.games.items.length })}
      </p>
      {data.games.items.length === 0 ? (
        <p className="mt-4">{t.t("ui.franchises.empty")}</p>
      ) : (
        <EntityGameList items={data.games.items} locale={locale} t={t} />
      )}
      <Pager
        t={t}
        page={page}
        hasMore={data.games.hasMore}
        hrefFor={(n) => franchiseHref(locale, f.slug, f.kind, n)}
        label={t.t("ui.entities.pagination")}
      />
    </PageShell>
  );
}
