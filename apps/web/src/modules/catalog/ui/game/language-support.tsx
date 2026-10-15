/**
 * 語言支援區塊（伺服器元件）。內容的判斷在 language-support-view.ts；這裡只負責 HTML。
 * 絕不出現「不支援」：沒資料的格子是空白（螢幕閱讀器念「無資料」），整欄沒資料寫「未提供資料」。
 */
import type { ReactElement } from "react";
import type { Locale, Translator } from "@sok/i18n";
import type { GameLanguageSupport } from "../../domain/entities";
import { buildLanguageSupportView } from "./language-support-view";

export function LanguageSupportBody({ support, locale, t, headingId }: { support: GameLanguageSupport; locale: Locale; t: Translator; headingId: string }): ReactElement {
  const view = buildLanguageSupportView(support, locale);
  if (view.state === "no_data") {
    return (
      <>
        <p className="font-semibold">{t.t("ui.langSupport.sectionNoData")}</p>
        <p className="text-sm text-[var(--muted)]">{t.t("ui.langSupport.sectionNoDataNote")}</p>
      </>
    );
  }
  const rowCount = view.rows.length;
  return (
    <>
      <p className="text-sm text-[var(--muted)]">{t.t("ui.langSupport.onlyListed")}</p>
      {/* 列很多或窄螢幕時會水平溢出：可捲動區域要能用鍵盤聚焦（axe scrollable-region-focusable） */}
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-labelledby={headingId}>
        <table className="release-table" data-language-table>
          <caption className="sr-only">{t.t("ui.langSupport.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t("ui.langSupport.language")}</th>
              {view.columns.map((c) => (
                <th key={c.type} scope="col">
                  {t.t(`enums.languageSupportType.${c.type}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, i) => (
              <tr key={row.code}>
                <th scope="row" className="font-medium">
                  {row.name}
                  {row.nativeName ? (
                    <>
                      {" "}
                      <span className="text-sm font-normal text-[var(--muted)]" lang={row.code}>
                        {t.t("ui.common.parenthetical", { text: row.nativeName })}
                      </span>
                    </>
                  ) : null}
                </th>
                {view.columns.map((c) => {
                  if (c.state === "no_data") {
                    // 整欄沒資料：第一列放一格「未提供資料」跨全部列，其餘列不再輸出這一格
                    return i === 0 ? (
                      <td key={c.type} rowSpan={rowCount} className="text-sm text-[var(--muted)]">
                        {t.t("ui.langSupport.columnNoData")}
                      </td>
                    ) : null;
                  }
                  return (
                    <td key={c.type}>
                      {row.has[c.type] ? (
                        <>
                          <span aria-hidden="true">✓</span>
                          <span className="sr-only">{t.t("ui.langSupport.yes")}</span>
                        </>
                      ) : (
                        <span className="sr-only">{t.t("ui.langSupport.cellNoData")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
