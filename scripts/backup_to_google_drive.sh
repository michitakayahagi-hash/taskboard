#!/usr/bin/env bash
# TaskBoard MySQL backup → Google Drive
# Uses the authenticated gws profile with drive.file scope. No credential values are written to output.
set -euo pipefail

APP_DIR="${TASKBOARD_APP_DIR:-/home/ubuntu/taskboard_deploy}"
BACKUP_DIR="${TASKBOARD_BACKUP_DIR:-/home/ubuntu/taskboard_backups}"
STATE_DIR="${TASKBOARD_BACKUP_STATE_DIR:-/home/ubuntu/.config/taskboard-backup}"
FOLDER_NAME="${TASKBOARD_BACKUP_FOLDER_NAME:-TaskBoard Database Backups}"

mkdir -p "$BACKUP_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

cd "$APP_DIR"
vars_file="$(mktemp)"
cnf_file="$(mktemp)"
cleanup() {
  rm -f "$vars_file" "$cnf_file"
}
trap cleanup EXIT
chmod 600 "$vars_file" "$cnf_file"

railway variable list --service MySQL --json > "$vars_file"
export TASKBOARD_BACKUP_VARS_FILE="$vars_file"
export TASKBOARD_BACKUP_CNF_FILE="$cnf_file"

backup_details="$(node <<'NODE'
const fs = require('fs');
const vars = JSON.parse(fs.readFileSync(process.env.TASKBOARD_BACKUP_VARS_FILE, 'utf8'));
if (!vars.MYSQL_PUBLIC_URL) throw new Error('MySQL public connection URL is not configured');
const url = new URL(vars.MYSQL_PUBLIC_URL);
const database = url.pathname.replace(/^\//, '');
if (!database) throw new Error('Database name is missing from MySQL connection URL');
const lines = [
  '[client]',
  `host=${url.hostname}`,
  `port=${url.port || '3306'}`,
  `user=${decodeURIComponent(url.username)}`,
  `password=${decodeURIComponent(url.password)}`,
];
fs.writeFileSync(process.env.TASKBOARD_BACKUP_CNF_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ database }));
NODE
)"
database="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).database)' "$backup_details")"

stamp="$(TZ=Asia/Tokyo date +%Y%m%dT%H%M%S%z)"
archive="$BACKUP_DIR/taskboard-db-$stamp.sql.gz"
checksum="$archive.sha256"
metadata="$BACKUP_DIR/taskboard-db-$stamp.metadata.json"

mysqldump --defaults-extra-file="$cnf_file" \
  --single-transaction --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF \
  "$database" | gzip -c > "$archive"
gzip -t "$archive"
sha256sum "$archive" > "$checksum"

export TASKBOARD_BACKUP_ARCHIVE="$archive"
export TASKBOARD_BACKUP_CHECKSUM="$checksum"
export TASKBOARD_BACKUP_METADATA="$metadata"
node <<'NODE'
const fs = require('fs');
const archive = process.env.TASKBOARD_BACKUP_ARCHIVE;
const checksum = fs.readFileSync(process.env.TASKBOARD_BACKUP_CHECKSUM, 'utf8').trim().split(/\s+/)[0];
const metadata = {
  format: 'mysql-mysqldump-gzip',
  createdAt: new Date().toISOString(),
  timezone: 'Asia/Tokyo',
  archive: require('path').basename(archive),
  sizeBytes: fs.statSync(archive).size,
  sha256: checksum,
  restore: 'Verify with sha256sum -c <archive>.sha256, then run: gunzip -c <archive> | mysql <database>',
};
fs.writeFileSync(process.env.TASKBOARD_BACKUP_METADATA, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
NODE

folder_id_file="$STATE_DIR/google-drive-folder-id"
if [[ -f "$folder_id_file" ]]; then
  folder_id="$(cat "$folder_id_file")"
else
  list_params="$(node <<'NODE'
console.log(JSON.stringify({
  q: "name = 'TaskBoard Database Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  fields: "files(id,name)",
  pageSize: 10,
}));
NODE
)"
  folder_list="$(gws drive files list --params "$list_params")"
  folder_id="$(node -e 'const input=JSON.parse(process.argv[1]); const files=input.files || []; process.stdout.write(files[0]?.id || "")' "$folder_list")"
  if [[ -z "$folder_id" ]]; then
    folder_payload="$(node -e 'console.log(JSON.stringify({name: "TaskBoard Database Backups", mimeType: "application/vnd.google-apps.folder"}))')"
    folder_created="$(gws drive files create --json "$folder_payload")"
    folder_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$folder_created")"
  fi
  printf '%s\n' "$folder_id" > "$folder_id_file"
  chmod 600 "$folder_id_file"
fi

upload_file() {
  local path="$1"
  local mime_type="$2"
  local name
  name="$(basename "$path")"
  local payload
  payload="$(node -e 'console.log(JSON.stringify({name: process.argv[1], parents: [process.argv[2]]}))' "$name" "$folder_id")"
  (
    cd "$BACKUP_DIR"
    gws drive files create --upload "$name" --upload-content-type "$mime_type" --json "$payload"
  )
}

archive_result="$(upload_file "$archive" "application/gzip")"
checksum_result="$(upload_file "$checksum" "text/plain")"
metadata_result="$(upload_file "$metadata" "application/json")"
export ARCHIVE_RESULT="$archive_result"
export CHECKSUM_RESULT="$checksum_result"
export METADATA_RESULT="$metadata_result"
export FOLDER_ID="$folder_id"

node - <<'NODE'
const fs = require('fs');
const archiveResult = JSON.parse(process.env.ARCHIVE_RESULT);
const checksumResult = JSON.parse(process.env.CHECKSUM_RESULT);
const metadataResult = JSON.parse(process.env.METADATA_RESULT);
const metadata = JSON.parse(fs.readFileSync(process.env.TASKBOARD_BACKUP_METADATA, 'utf8'));
console.log(JSON.stringify({
  status: 'backup-uploaded',
  archive: metadata.archive,
  sizeBytes: metadata.sizeBytes,
  sha256: metadata.sha256,
  folderId: process.env.FOLDER_ID,
  archiveFileId: archiveResult.id,
  checksumFileId: checksumResult.id,
  metadataFileId: metadataResult.id,
}));
NODE
