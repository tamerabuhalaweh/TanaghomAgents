#!/bin/sh
set -eu

UNIT=/etc/systemd/system/gemma4-26b-a4b-vllm-canary.service
KEY_FILE=/etc/smartlabs/gemma4_canary_api_key
BACKUP_DIR=/etc/smartlabs/credential-rotation-backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$UNIT" "$BACKUP_DIR/gemma-unit.$stamp"
cp -a "$KEY_FILE" "$BACKUP_DIR/gemma-key.$stamp"
chmod 600 "$BACKUP_DIR/gemma-unit.$stamp" "$BACKUP_DIR/gemma-key.$stamp"

rollback() {
  cp -a "$BACKUP_DIR/gemma-unit.$stamp" "$UNIT"
  cp -a "$BACKUP_DIR/gemma-key.$stamp" "$KEY_FILE"
  systemctl daemon-reload
  systemctl restart gemma4-26b-a4b-vllm-canary.service || true
}
trap rollback EXIT HUP INT TERM

umask 077
new_key=$(openssl rand -base64 48 | tr -d '\n')
printf '%s\n' "$new_key" > "$KEY_FILE.new"
python3 - "$UNIT" "$KEY_FILE.new" <<'PY'
import pathlib, re, sys
unit = pathlib.Path(sys.argv[1])
key = pathlib.Path(sys.argv[2]).read_text().strip()
text = unit.read_text()
updated, count = re.subn(r'(--api-key\s+)\S+', lambda m: m.group(1) + key, text)
if count != 1:
    raise SystemExit('expected exactly one --api-key in Gemma unit')
tmp = unit.with_suffix(unit.suffix + '.new')
tmp.write_text(updated)
tmp.chmod(0o644)
tmp.replace(unit)
PY
mv "$KEY_FILE.new" "$KEY_FILE"
chown root:administrator "$KEY_FILE"
chmod 640 "$KEY_FILE"
unset new_key

systemctl daemon-reload
systemctl restart gemma4-26b-a4b-vllm-canary.service
i=0
until systemctl is-active --quiet gemma4-26b-a4b-vllm-canary.service \
  && curl -fsS --max-time 5 http://127.0.0.1:8026/health >/dev/null; do
  i=$((i + 1))
  test "$i" -lt 120 || { echo "Gemma did not recover within ten minutes." >&2; exit 70; }
  sleep 5
done

rm -f /etc/systemd/system/gemma4-26b-a4b-vllm-canary.service.bak_context4096_20260704_144309
rm -f "$BACKUP_DIR/gemma-unit.$stamp" "$BACKUP_DIR/gemma-key.$stamp"
trap - EXIT HUP INT TERM
echo "Gemma API credential rotated and health-checked; secret value was not printed."
