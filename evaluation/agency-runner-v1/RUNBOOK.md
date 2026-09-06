# Isolated authenticated Agency comparison runner v1

Owner: #177, under #137/#56. PR #197 preparation accepted at
`7317b2e085f0b80d12bc0fb2c862d247716600a9` after 39/39 CI checks.
This successor implements the missing fixed-baseline authenticated simulation
runner. It does **not** deploy agents, certify language quality or call Gemma.

## Scope and architecture

The original 47-file preparation lock, immutable profiles, runtime module,
dashboard/API, migrations 0001–0034 and committed workflow remain unchanged.
New code lives only in `evaluation/agency-runner-v1` and the test runner script.
It is not bundled in the production dashboard image or served as a public API.

1. Bootstrap uniquely named disposable PostgreSQL 17.6 and all original schema
   migrations. An isolated-only SQL extension refuses any database not named
   `tanaghom_quality_<12 hex chars>` or not at exact migration 0034. It is not a
   production migration. The generated name is an accident guard, not a claim
   that a database name is a security boundary against its administrator.
2. Seed original fictional corpus facts and simulated model profile. Fixture
   setup is explicitly privileged; the runtime worker is not. Run the real
   built dashboard locally with its `tanaghom_api` DB role and a temporary
   signed-JWT issuer. Its accepted owner binds profiles, approves typed fixture
   evidence and queues ID-only commands through the existing API.
3. The trusted isolated scheduler registers each owner-created task in an
   immutable run/case/arm/repetition table. Maximum 400 attempts, fixed corpus
   hash, expiry and append-only stop records. The worker has no raw-table read
   or write access, only the existing five pilot RPCs plus a lease-scoped read
   of comparison metadata. Owner/worker requests cannot submit prompts or URLs.
4. A separate test-only token-authenticated gateway claims and resolves the
   real task, checks its metadata and resolved facts against the frozen corpus,
   prepares the original adapter, and selects either its adapted instructions
   or the exact unaugmented platform instructions. All original post-inference
   validation remains in force. The token is generated for this disposable run.
5. Twelve bounded manual n8n executions process 360 durable attempts: 324
   authenticated HTTP calls to an authored-response simulator, plus 36 local
   reports. Only one job is in flight. No scheduled trigger is present and the
   imported/exported workflow stays inactive. Each execution handles at most 30
   attempts, enforced by the gateway's trusted scheduler. This bounds retained
   n8n execution context rather than accumulating the full run in one execution.
   No production export is changed.
6. Each completion re-resolves current ownership, policy, evidence, lease and
   stop state; it writes one immutable result/audit. Same-result replay returns
   the prior result; conflicts and relabeling fail. Any unexpected main-batch
   failure stops scheduling; missing attempts remain visible, not successful.

The 144 model pairs differ only in system augmentation **and independent task/
correlation IDs**, which must differ for separate durable leases. The condition
comparison normalizes only those two trace IDs; it does not erase differences
in campaign, strategy, event, knowledge, policy, model, schema or token budget.
Baseline result provenance explicitly records no Agency generation procedure;
the shared safety-validator provenance is retained separately. Brand/report
cases have no invented AI baseline. The original strategy-v1 versus deployed-v2
comparison limitation remains as documented in the preparation package.

## Run locally or in CI

Requirements: Docker, existing locked Node dependencies and the dashboard build.
From the repository root, without loading `.env`:

```powershell
npm ci
npm test
npm run check
node node_modules/next/dist/bin/next build apps/dashboard
npm run test:agency-quality-runner
npm run check:agency-quality-prerequisites
```

The runner accepts **no command-line mode, URL or database argument**. It
constructs its own connections; ambient DATABASE_URL/model/provider settings
are not used. Its model adapter is deliberately restricted to
`agency-quality-simulated-model-v1`. Changing an environment variable or
filling a checklist cannot enable real model transport.

Images are immutable digest pins in the runner. Local service ports are
ephemeral; the Next owner API binds loopback. The test gateway/simulator bind
the host for Docker Desktop reachability, authenticate with a random run token,
accept only fixed routes and bounded bodies, and close at teardown. The
test responses also close each HTTP connection, avoiding stale keep-alive
reuse between n8n's model and code-node steps. This affects only disposable
transport; it does not change any production connection policy. The
disposable n8n instance uses host networking and disables its SSRF check solely
to reach these synthetic loopback endpoints. This is not a production network
design, and these settings must never be copied into the GPU deployment.

The loop follows linked input items across the report/model branches instead
of assuming their execution indexes are equal. See [n8n item-linking guidance](https://docs.n8n.io/data/data-mapping/data-item-linking/item-linking-node-building/).
The 360-attempt integration test exercises the actual loop, including model
requests after deterministic reports. A structural workflow test alone would
not establish correct item/lease pairing.

## Evidence and non-claims

Each run writes an exclusive `tmp/tanaghom-quality-<run>-evidence.json`, including
failed runs. `tmp/agency-quality-runner-evidence.json` is only a latest-result
pointer; it does not replace the unique history. CI uploads all unique artifacts.
Never commit raw credentials, session tokens or future customer/model text.

Evidence records source/manifest/corpus/schedule hashes, all main attempt IDs
by case/arm/repetition, response/result hashes, transport timings, terminal
status and safety check outcomes. Real-model tokens, cost, memory and human
scores remain null, with a reason. The simulator returns authored usage fields
only to exercise the protocol validator; they are **not measured model usage**.
Gateway timings measure this disposable simulator, not Gemma performance.
Pass artifacts include observed gateway request/response counts and maximum
request duration; failures retain the last 20 transport events without bodies
or credentials. A missing gateway receipt distinguishes that observation from
a request handled slowly, but alone does not identify an operating-system or
network root cause. Intermittent Windows HTTP aborts were observed during
development; connection closing is hardening, not a demonstrated fix. Retain
failures and require exact-head CI evidence rather than silently retrying them.

The full public corpus passes transport/contracts if the 360 attempts complete,
but that says nothing about whether a real model can answer those cases well.
Authored simulator answers, especially Brand's empty findings, are not customer
reference answers and must never be used to award semantic quality points.
No conversion, throughput or production-readiness uplift is claimed.

Negative controls include wrong/multibyte token, viewer/cross-tenant access,
cookie origin, closed commands, raw-table/control denial, input/case drift,
wrong/conflicting completion, immutable labels, invalid JSON, wrong model,
stale campaign, DND, human takeover and run stop. Reuse #137's existing
certification and the other CI suites for their broader regression evidence;
do not claim this test replaces every live-provider failure scenario.

## Reviewer and model prerequisites, in plain language

Engineering tests are automated. **Business/language review means real people
read sample AI answers and decide whether they are accurate and useful.**
For example, Tamer can judge product behavior and a customer sales/support
representative can judge business correctness and Arabic/English wording.
Two independent bilingual reviews are the proposed rubric, not two new
technical accounts. If a pilot uses one reviewer, explicitly revise the rubric
and record that limitation; do not silently invent a second signoff.

`prerequisites.json` and its checker list the remaining fields precisely:

- Domain approver and two distinct bilingual reviewers; rubric/corpus approval
  references, approved reference-answer hash, genuine withheld-data hash and
  rights, and an escrowed blind-label mapping. Public reserves are not held out.
- Served model ID, weights/tokenizer/chat-template SHA256, quantization,
  context limit, immutable vLLM image, xgrammar version and seed support.
  A historical Gemma alias is not a verified current model identity.
- An approved isolated environment, explicit memory/time/request budget and
  cost basis. The proposed eight schema smoke requests are a separate gate;
  additional hidden cases require a new attempt-budget review.
- Isolated compiler evidence and a separately authorized bounded probe.

These values are deliberately not fabricated. The checker reports missing or
invalid fields and **always** returns `live_execution_authorized:false`.
Even a structurally complete file requires verification of the real approval
references. It is a checklist, not a security token or certification authority.
No reviewer name or model metadata is needed to run the simulator now.

Next, complete these human/model decisions and prepare the separately reviewed
isolated real-model transport/compiler-probe adapter. This runner's restricted
simulator must not be retargeted ad hoc to shared production Gemma. Then execute
the bounded schema gate, review it, and only afterward authorize paired real
measurement. Studio availability and production installation remain separate.

## Stop and rollback

Unexpected main-batch failure halts new scheduling. The finally block restores
only the disposable database's stops, retains a unique pass/fail artifact,
terminates its temporary dashboard and services, and removes only its generated
Docker container/volume names. No global prune or unrelated path deletion.
Temp-directory deletion verifies its resolved path is under the OS temp root
and has the exact package prefix. Do not delete earlier failure artifacts.

For a hard-killed local process, inspect the run's exact names and label first:
only `tanaghom-quality-<12 hex>` and its `-worker`, `-pgdata`, `-n8n` resources
belong to that run. Never substitute a broad name filter into deletion commands.
Git rollback is a source revert; no production rollback/migration is needed
because this package makes no production change. No SmartLabs, SmartCC, voice,
Gemma administration, customer credentials, Nginx or firewall access is involved.
