import type { ReactElement } from "react";
import { serializeJsonLd, type JsonLd } from "./json-ld";

/** 輸出一段 JSON-LD。內容經 serializeJsonLd 跳脫（`<` 等），不可繞過。 */
export function JsonLdScript({ data }: { data: JsonLd | null }): ReactElement | null {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
