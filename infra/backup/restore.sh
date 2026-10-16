#!/usr/bin/env bash
# 還原（演練或災難復原）：下載 → age 解密 → pg_restore 到「指定的新資料庫」→ 各表筆數對照。
# 用法：
#   restore.sh --latest --identity ~/age-key.txt --target sok_restore_check
#   restore.sh --object daily/sok_studio-20261015T031700Z.dump.age --identity ~/age-key.txt --target sok_restore_check
# 預設拒絕還原到正式資料庫（sok_studio）；災難復原時（資料庫已毀）才加 --allow-production。
# 已存在的目標資料庫不會被覆寫，除非加 --drop-existing。
# 私鑰檔（--identity）請臨時放到執行還原的機器上，用完刪除；不要留在 VM。
set -Eeuo pipefail

# shellcheck source=common.sh
# shellcheck source-path=SCRIPTDIR
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

REMOTE="$(get_cfg BACKUP_RCLONE_REMOTE)"
OBJECT=""
LATEST=0
IDENTITY=""
TARGET=""
ALLOW_PROD=0
DROP_EXISTING=0

usage() { sed -n '2,9p' "$0"; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --latest) LATEST=1 ;;
    --object) OBJECT="${2:?}"; shift ;;
    --identity) IDENTITY="${2:?}"; shift ;;
    --target) TARGET="${2:?}"; shift ;;
    --allow-production) ALLOW_PROD=1 ;;
    --drop-existing) DROP_EXISTING=1 ;;
    -h|--help) usage ;;
    *) echo "未知參數：$1" >&2; usage ;;
  esac
  shift
done

[ -n "$REMOTE" ] || { echo "BACKUP_RCLONE_REMOTE 未設定" >&2; exit 2; }
[ -f "$IDENTITY" ] || { echo "找不到 age 私鑰檔（--identity）" >&2; exit 2; }
[ -n "$TARGET" ] || { echo "必須指定 --target <資料庫名>" >&2; exit 2; }
if [ "$TARGET" = "$DB_NAME" ] && [ "$ALLOW_PROD" != 1 ]; then
  echo "拒絕還原到正式資料庫 $DB_NAME（演練請用別的名稱；災難復原才加 --allow-production）" >&2
  exit 2
fi
if [ "$LATEST" = 1 ]; then
  OBJECT="daily/$(rclone lsf "$REMOTE/daily" --files-only | grep -E '\.dump\.age$' | sort | tail -n1)"
fi
if [ -z "$OBJECT" ] || [ "$OBJECT" = "daily/" ]; then
  echo "沒有指定或找不到備份物件（--latest 或 --object）" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
START="$(date +%s)"

echo "== 下載 $OBJECT"
rclone copyto "$REMOTE/$OBJECT" "$TMP/backup.dump.age"
rclone copyto "$REMOTE/$OBJECT.counts.txt" "$TMP/expected.counts.txt" || echo "（沒有筆數清單，略過對照）" >&2

echo "== 建立資料庫 $TARGET"
if [ "$DROP_EXISTING" = 1 ]; then
  compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$TARGET"
fi
# 沒有 --drop-existing 且資料庫已存在 → createdb 失敗並中止，不會覆寫
compose exec -T postgres createdb -U "$DB_USER" --encoding=UTF8 --locale=C.UTF-8 --template=template0 "$TARGET"

echo "== 解密並還原（pg_restore）"
age -d -i "$IDENTITY" "$TMP/backup.dump.age" \
  | compose exec -T postgres pg_restore -U "$DB_USER" -d "$TARGET" --no-owner --exit-on-error

echo "== 各表筆數對照"
table_counts "$TARGET" > "$TMP/actual.counts.txt"
STATUS=0
if [ -s "$TMP/expected.counts.txt" ]; then
  if diff -u "$TMP/expected.counts.txt" "$TMP/actual.counts.txt"; then
    echo "筆數完全一致（$(wc -l < "$TMP/actual.counts.txt") 張表）"
  else
    # 筆數清單是 pg_dump 之後才取的；兩者之間的寫入（例如排程同步）會造成少量差異，請人工判讀
    echo "筆數有差異（見上方 diff）。若只是少量增減且來自同步排程，屬預期；表缺漏或大幅減少則視為失敗。" >&2
    STATUS=3
  fi
else
  cat "$TMP/actual.counts.txt"
fi

END="$(date +%s)"
echo "== 還原耗時 $((END - START)) 秒（演練請記進 README 的 RTO 表；完整 RTO 還要加上建 VM、部署、DNS 的時間）"
echo "下一步（演練）：把 web 暫時指到 $TARGET 跑 smoke（/readyz、當月月曆、/ical/zh-Hant/releases.ics），完成後 dropdb 掉 $TARGET。"
exit "$STATUS"
