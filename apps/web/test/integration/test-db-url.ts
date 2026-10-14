/**
 * 測試資料庫網址：TEST_DATABASE_URL，可用 TEST_DATABASE_NAME 換掉資料庫名稱
 * （多個工作同時跑整合測試時各用一個資料庫；名稱同樣必須以 _test 結尾）。
 */
export function resolveTestDatabaseUrl(): string | undefined {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return undefined;
  const name = process.env.TEST_DATABASE_NAME;
  if (!name) return raw;
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url.toString();
}
