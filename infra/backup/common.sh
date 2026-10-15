#!/usr/bin/env bash
# backup.sh／restore.sh 共用：設定載入、告警。由兩者 source，不單獨執行。
# shellcheck shell=bash

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$INFRA_DIR/docker-compose.yml}"
ENV_FILE="${BACKUP_ENV_FILE:-$INFRA_DIR/.env}"
DB_USER="${BACKUP_DB_USER:-sok}"
# shellcheck disable=SC2034  # 由 backup.sh／restore.sh 使用
DB_NAME="${BACKUP_DB_NAME:-sok_studio}"

# 取值優先序：行程環境變數 > infra/.env（只讀需要的那一行，不 source，避免值裡的特殊字元被當成指令）
get_cfg() {
  local name="$1" default="${2:-}" val
  val="${!name:-}"
  if [ -z "$val" ] && [ -f "$ENV_FILE" ]; then
    val="$(grep -E "^${name}=" "$ENV_FILE" | tail -n1 | sed -E "s/^${name}=//; s/[[:space:]]+#.*$//; s/^[\"']//; s/[\"']$//" || true)"
  fi
  printf '%s' "${val:-$default}"
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# JSON 字串跳脫（反斜線、雙引號）
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# 告警：POST 到 ALERT_WEBHOOK_URL（同時帶 content 與 text，Discord／Slack 型 webhook 都吃）。失敗只記 stderr，不再中斷。
alert() {
  local msg="$1" url esc json
  url="$(get_cfg ALERT_WEBHOOK_URL)"
  echo "ALERT: $msg" >&2
  [ -n "$url" ] || return 0
  esc="$(json_escape "$msg")"
  json="$(printf '{"content":"%s","text":"%s"}' "$esc" "$esc")"
  curl -fsS --max-time 15 -H 'Content-Type: application/json' -d "$json" "$url" >/dev/null || echo "（告警送出失敗）" >&2
}

# 各資料表筆數（public schema，精確 count）。輸出「表名<TAB>筆數」，依表名排序。
# $1＝資料庫名。備份時寫成 .counts.txt，還原演練時對照。
table_counts() {
  compose exec -T postgres psql -U "$DB_USER" -d "$1" -At -F $'\t' -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec
SQL
}
