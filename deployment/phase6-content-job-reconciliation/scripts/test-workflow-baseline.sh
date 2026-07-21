#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
contract="$root/deployment/phase6-core-agent-canary/scripts/workflow-contract.mjs"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

make_inventory() {
  active=$1
  destination=$2
  sed "s/__ACTIVE__/$active/" >"$destination" <<'JSON'
[
  {"id":"phase3StrategistV1","name":"Campaign Strategist","active":false},
  {"id":"phase3ContentProducerV1","name":"Content Producer","active":false},
  {"id":"existingUnrelatedV1","name":"Existing unrelated workflow","active":false},
  {"id":"laterUnrelatedV1","name":"Workflow added after the core canary","active":__ACTIVE__}
]
JSON
}

make_inventory true "$temporary/current.before.json"
make_inventory true "$temporary/current.after.json"
make_inventory false "$temporary/changed.after.json"

node "$contract" compare-others "$temporary/current.before.json" "$temporary/current.after.json" >/dev/null
if node "$contract" compare-others "$temporary/current.before.json" "$temporary/changed.after.json" >/dev/null 2>&1; then
  echo 'in-window unrelated workflow drift was not rejected' >&2
  exit 1
fi

echo 'PASS: post-canary workflows are accepted in the current operation baseline and in-window drift is rejected.'
