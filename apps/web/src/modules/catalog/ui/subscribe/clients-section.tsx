/**
 * 各日曆 App 的訂閱步驟（Apple、Google 網頁版、Outlook）。伺服器元件、無狀態。
 * 公開訂閱頁與帳號的私人行事曆頁共用同一份（文案只有 `ui.subscribe.clients.*` 一處）。
 */
import type { ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { getTranslator } from "../labels";

export function SubscribeClientsSection({ locale }: { locale: Locale }): ReactElement {
  const t = getTranslator(locale);
  const s = (key: string) => t.t(`ui.subscribe.${key}`);
  const steps = (client: "apple" | "google" | "outlook") => (
    <ol className="mt-2 list-decimal space-y-1 pl-6">
      {(["s1", "s2", "s3"] as const).map((k) => (
        <li key={k}>{s(`clients.${client}.${k}`)}</li>
      ))}
    </ol>
  );
  return (
    <section aria-labelledby="subscribe-clients-title" className="mt-8 max-w-3xl">
      <h2 id="subscribe-clients-title" className="text-xl font-bold">
        {s("clients.title")}
      </h2>
      <div className="mt-3 space-y-5">
        <section data-client="apple">
          <h3 className="font-bold">{s("clients.apple.title")}</h3>
          {steps("apple")}
        </section>
        <section data-client="google">
          <h3 className="font-bold">{s("clients.google.title")}</h3>
          {steps("google")}
          <p className="notice mt-2">{s("clients.google.note")}</p>
        </section>
        <section data-client="outlook">
          <h3 className="font-bold">{s("clients.outlook.title")}</h3>
          {steps("outlook")}
        </section>
      </div>
    </section>
  );
}
