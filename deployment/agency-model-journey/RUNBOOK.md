# Real-model bilingual journey kit (#177)

Purpose: earn the scorecard gate **"Real-model bilingual journey"**: exact served
model, approved knowledge, English and Arabic results, and a recorded human review
for the release. This is a **proposed successor** (`config/agency-model-connection.v1.json`).
The frozen `agency.workspace.v1` procedure and `evaluation/agency-runner-v1`
simulator are used read-only and are not retargeted.

## What the code adds

- `packages/agent-runtime/model-connection.mjs`: a real `GET …/models` probe
  (`verified` / `failed` with a reason / `pending`), hard per-run limits
  (4 calls, 24,000 tokens worst-case, 1,400 output tokens per call, $1.00 spend at
  the price you supply) and a kill switch that is **on unless**
  `AGENCY_MODEL_KILL_SWITCH=false`.
- The AI workspace header now shows the probe result (cached 60 s) instead of a
  static label: **Model connection verified / failed / pending**. Start is enabled
  only when verified and the existing workspace and platform stops are clear.
- `scripts/agency-model-journey.mjs`: brief → strategy → content in English and
  Arabic through the frozen workspace request/validation code, then a human review
  sheet. It never approves, publishes or sends anything.

## Inputs the team supplies (never in Git or chat)

| Variable | Meaning |
| --- | --- |
| `AGENCY_MODEL_URL` | OpenAI-compatible `…/chat/completions` URL (default: the workspace Gemma endpoint) |
| `AGENCY_MODEL_API_KEY` | model key, from the runtime secret store |
| `AGENCY_MODEL_PRICE_PER_1K_TOKENS_USD` | cost basis for the spend cap (`0` only if compute is agreed as pre-paid) |
| `AGENCY_MODEL_JOURNEY_AUTHORIZED=true` | records that the bounded inference was authorized |
| `AGENCY_MODEL_KILL_SWITCH=false` | clears the kill switch for this run only |
| `RELEASE_COMMIT`, `EVIDENCE_OWNER` | exact release and responsible person |
| `--input=approved.json` | optional `{ "en": {title, brief, source_facts}, "ar": {…} }` approved by the customer; without it a synthetic fixture is used and labelled as **not approved knowledge** (no gate credit) |

## Command

```sh
AGENCY_MODEL_JOURNEY_AUTHORIZED=true AGENCY_MODEL_KILL_SWITCH=false \
AGENCY_MODEL_API_KEY=… AGENCY_MODEL_PRICE_PER_1K_TOKENS_USD=… \
RELEASE_COMMIT=<sha> EVIDENCE_OWNER='<name>' \
node scripts/agency-model-journey.mjs --input=approved.json --out=tmp/model-journey
```

Exit `0` = 4/4 steps produced validated documents; `1` = probe failed or a step was
rejected (no credit); `2` = refused before any call (missing authorization, price,
key, release, owner, https, or kill switch on).

## Evidence and human decision

1. Keep `tmp/model-journey/evidence.json` (model, probe, limits, per-step hashes,
   tokens, spend; no key).
2. A bilingual reviewer completes `review-sheet.md` for each language
   (approve / request changes, with reasons).
3. Commit both (secret-free) under `docs/evidence/<date>-model-journey/` and update
   the gate row with date, release, model, result and reviewer.

## Stop and rollback

Unset or set `AGENCY_MODEL_KILL_SWITCH` to anything but `false` to stop between
calls; a request already in flight may still finish remotely. Source rollback:
revert the PR — the workspace label returns to the static check.
