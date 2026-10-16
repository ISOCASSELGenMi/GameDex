import { describe, expect, it } from "vitest";
import { CatalogQueryTimeoutError } from "@/modules/catalog/domain/entities";
import {
  CACHED_TIMEOUT,
  QUERY_TIMEOUT_DIGEST,
  QueryTimeoutPageError,
  rethrowForPage,
  timeoutMarkerOrRethrow,
  unwrapCachedForPage,
} from "@/modules/catalog/ui/page-errors";

// `use cache` 函式丟出的錯誤跨過快取邊界後型別會遺失（實測：digest 變成隨機值，頁面顯示一般錯誤）。
// 所以快取函式內改回傳標記值，外層還原成帶固定 digest 的錯誤。這裡驗證那條轉換鏈。
describe("page-errors：use cache 邊界的逾時轉換", () => {
  it("rethrowForPage：逾時 → QueryTimeoutPageError（固定 digest）；其他錯誤原樣丟出", () => {
    expect(() => rethrowForPage(new CatalogQueryTimeoutError(3000))).toThrow(QueryTimeoutPageError);
    try {
      rethrowForPage(new CatalogQueryTimeoutError(3000));
    } catch (err) {
      expect((err as QueryTimeoutPageError).digest).toBe(QUERY_TIMEOUT_DIGEST);
    }
    const other = new Error("boom");
    expect(() => rethrowForPage(other)).toThrow(other);
  });

  it("timeoutMarkerOrRethrow：逾時 → 標記值；其他錯誤原樣丟出", () => {
    expect(timeoutMarkerOrRethrow(new CatalogQueryTimeoutError(3000))).toBe(CACHED_TIMEOUT);
    const other = new Error("boom");
    expect(() => timeoutMarkerOrRethrow(other)).toThrow(other);
  });

  it("標記值經序列化（快取邊界）後，unwrapCachedForPage 仍能還原成 QueryTimeoutPageError", () => {
    const crossed = JSON.parse(JSON.stringify(timeoutMarkerOrRethrow(new CatalogQueryTimeoutError(3000))));
    expect(() => unwrapCachedForPage(crossed)).toThrow(QueryTimeoutPageError);
    // 頁面層 catch → rethrowForPage 不會改寫它，digest 保持固定
    try {
      unwrapCachedForPage(crossed);
    } catch (err) {
      expect(() => rethrowForPage(err)).toThrow(QueryTimeoutPageError);
      expect((err as QueryTimeoutPageError).digest).toBe(QUERY_TIMEOUT_DIGEST);
    }
  });

  it("unwrapCachedForPage：一般結果（含 null、物件）原樣回傳", () => {
    expect(unwrapCachedForPage(null)).toBeNull();
    const v = { a: 1 };
    expect(unwrapCachedForPage(v)).toBe(v);
  });
});
