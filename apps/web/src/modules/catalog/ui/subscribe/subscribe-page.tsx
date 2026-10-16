/**
 * 訂閱頁 `/[locale]/subscribe`（06 §路由、08 §更新延遲要誠實）。伺服器元件。
 * 三種公開 feed 的 webcal://／https 網址＋複製按鈕、各客戶端步驟（Apple、Google 網頁版、Outlook）、誠實的延遲文案、
 * 想要即時通知者的引導（文案提到之後的 Email／Discord，不放連結）。私人 feed 屬 accounts（Phase 7），這裡只留 slot。
 */
import { connection } from "next/server";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@sok/i18n";
import { listPlatforms } from "../../use-cases/read/list-platforms";
import { getTranslator, platformKindLabel } from "../labels";
import { PageShell } from "../layout/page-shell";
import { rethrowForPage } from "../page-errors";
import { siteOrigin } from "../seo/site-url";
import { icalFeedPath } from "../links";
import { SubscribeClientsSection } from "./clients-section";
import { FeedCard, PlatformFeedCard, type PlatformGroupOption } from "./feed-card";

export interface SubscribeSlots {
  /** 私人 feed 區塊（accounts，Phase 7；未啟用時不傳）。 */
  privateFeed?: ReactNode;
}

export function subscribeTitle(locale: Locale): string {
  return getTranslator(locale).t("ui.subscribe.title");
}

export async function SubscribePage({
  locale,
  supportedLocales,
  slots,
  platform,
}: {
  locale: Locale;
  supportedLocales: readonly Locale[];
  slots?: SubscribeSlots;
  /** `?platform=` 預選的平台 slug（平台頁的入口帶來）。 */
  platform?: string | null;
}): Promise<ReactElement> {
  await connection();
  const t = getTranslator(locale);
  const s = (key: string) => t.t(`ui.subscribe.${key}`);
  let groups;
  try {
    groups = await listPlatforms({ locale });
  } catch (err) {
    rethrowForPage(err);
  }
  const platformGroups: PlatformGroupOption[] = groups
    .filter((g) => g.platforms.length > 0)
    .map((g) => ({
      label: platformKindLabel(t, g.kind),
      platforms: g.platforms.map((p) => ({ slug: p.slug, name: p.name })),
    }));
  const origin = siteOrigin();
  const strings = {
    url: s("feed.url"),
    open: s("feed.open"),
    copy: s("feed.copy"),
    copied: s("feed.copied"),
    copyFailed: s("feed.copyFailed"),
  };

  return (
    <PageShell locale={locale} supportedLocales={supportedLocales} path="/subscribe">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold">{s("title")}</h1>
        <p className="mt-2 max-w-3xl">{s("intro")}</p>

        <aside className="notice mt-4 max-w-3xl" aria-labelledby="subscribe-delay-title" data-section="delay">
          <h2 id="subscribe-delay-title" className="font-bold">
            {s("delay.title")}
          </h2>
          <p className="mt-1">{s("delay.body")}</p>
        </aside>

        <section aria-labelledby="subscribe-changes-title" className="mt-6 max-w-3xl" data-section="changes">
          <h2 id="subscribe-changes-title" className="text-xl font-bold">
            {s("changes.title")}
          </h2>
          <p className="mt-1">{s("changes.intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {(["postponed", "cancelled", "rescheduled"] as const).map((k) => (
              <li key={k}>{s(`changes.${k}`)}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="subscribe-feeds-title" className="mt-8">
          <h2 id="subscribe-feeds-title" className="text-xl font-bold">
            {s("feeds.title")}
          </h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FeedCard
              feedId="releases"
              title={s("feeds.releases.title")}
              description={s("feeds.releases.description")}
              path={icalFeedPath(locale, "releases")}
              siteOrigin={origin}
              strings={strings}
            />
            <FeedCard
              feedId="events"
              title={s("feeds.events.title")}
              description={s("feeds.events.description")}
              path={icalFeedPath(locale, "events")}
              siteOrigin={origin}
              strings={strings}
            />
            {platformGroups.length > 0 ? (
              <PlatformFeedCard
                feedId="platform"
                title={s("feeds.platform.title")}
                description={s("feeds.platform.description")}
                chooseLabel={s("feeds.platform.choose")}
                initialSlug={platform ?? undefined}
                pathTemplate={icalFeedPath(locale, "platform", "{slug}")}
                groups={platformGroups}
                siteOrigin={origin}
                strings={strings}
              />
            ) : null}
          </div>
        </section>

        {slots?.privateFeed ? <section data-slot="subscribe.private">{slots.privateFeed}</section> : null}

        <SubscribeClientsSection locale={locale} />

        <section aria-labelledby="subscribe-realtime-title" className="mt-8 max-w-3xl" data-section="realtime">
          <h2 id="subscribe-realtime-title" className="text-xl font-bold">
            {s("realtime.title")}
          </h2>
          <p className="mt-1">{s("realtime.body")}</p>
        </section>
      </div>
    </PageShell>
  );
}
