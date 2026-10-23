/** 首頁近期活動區的空狀態（D86：進行中＋30 天內開始的活動都沒有時）。獨立成小元件，方便不經頁面就做渲染測試。 */
import type { ReactElement } from "react";
import type { Translator } from "@sok/i18n";
import { HOME_EVENT_DAYS } from "../../domain/home-dashboard";

export function HomeEventsEmpty({ t }: { t: Translator }): ReactElement {
  return (
    <p className="mt-3" data-home-empty="">
      {t.t("ui.home.events.emptyWindow", { days: HOME_EVENT_DAYS })}
    </p>
  );
}
