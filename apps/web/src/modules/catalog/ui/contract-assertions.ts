/**
 * 編譯期一致性斷言：packages（不能 import apps）裡複製的 enum 值，必須與 catalog domain 完全相同。
 * 任何一邊增減值，`npm run typecheck` 就會失敗。執行期沒有任何作用。
 */
import type { FILTER_PLATFORM_KINDS, FILTER_RELEASE_STAGES, FilterPlatformKind, FilterReleaseStage } from "@sok/api-contract";
import type { RELEASE_DATE_PRECISIONS, ReleaseDatePrecision } from "@sok/i18n";
import type { DATE_PRECISIONS, DatePrecision, PLATFORM_KINDS, PlatformKind, RELEASE_STAGES, ReleaseStage } from "../domain/entities";

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type ContractAssertions = [
  Assert<Equals<FilterPlatformKind, PlatformKind>>,
  Assert<Equals<FilterReleaseStage, ReleaseStage>>,
  Assert<Equals<ReleaseDatePrecision, DatePrecision>>,
  // 值陣列的順序也一致（tuple 相等）
  Assert<Equals<typeof FILTER_PLATFORM_KINDS, typeof PLATFORM_KINDS>>,
  Assert<Equals<typeof FILTER_RELEASE_STAGES, typeof RELEASE_STAGES>>,
  Assert<Equals<typeof RELEASE_DATE_PRECISIONS, typeof DATE_PRECISIONS>>,
];
