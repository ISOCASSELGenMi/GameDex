-- 搜尋用 trigram 索引需要 pg_trgm（06 §搜尋；games.search_text 的 GIN 索引依賴它）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
