# Muse 1.3 Spark — Repository Reconciliation Questions

Muse: inspect the CURRENT repository, not the legacy Groky archive. Answer this file in a PR before implementation.

## 1. Current architecture
1. Which current tables/entities already represent media/assets, jobs, billing, integrations, audit and tenant ownership?
2. Which migration number must be next after main today?
3. Which server modules should own Creative Runtime API calls?
4. Which existing authorization helpers must all creative routes reuse?
5. Which existing audit/event functions should creative jobs call?
6. Which current idempotency mechanism should be reused?
7. Which current background execution or outbox primitives can be reused rather than adding a second queue abstraction?

## 2. Dashboard
8. Where should Creative Studio live in the current navigation?
9. Which design-system components and i18n/RTL primitives already exist?
10. Does the current app have an upload pipeline? If yes, what security and storage boundary does it use?
11. Which Playwright suites should be extended for Arabic/mobile/permission coverage?

## 3. Infrastructure
12. What is currently deployed on the test VPS vs certified server?
13. Is there any existing S3-compatible storage configured?
14. Is Redis currently part of the deployable runtime or only n8n internals?
15. What private networking already exists in repository deployment code?
16. What deployment pattern should new GPU workers follow without modifying SmartLabs/SmartCC?

## 4. Existing roadmap conflicts
17. There is already a tracked video initiative (#157 per STATUS). What exactly does it own?
18. Are there existing media/creative issues or PRs that this plan must reuse rather than duplicate?
19. Which current Agency/workspace capabilities overlap script/content generation?
20. Which production-readiness gates would be invalidated or need versioning when Creative Platform enters scope?

## 5. Data model proposal
Propose exact new tables, constraints, indexes, enum/check constraints, RBAC grants and up/down migration boundaries.
Do not create tables until this proposal is reviewed.

## 6. Runtime proposal
Propose:
- queue technology;
- worker lease/heartbeat design;
- object storage abstraction;
- callback/webhook signing;
- adapter interface;
- cancellation;
- retry classes;
- cost metering;
- retention;
- observability.

For each, state what is reused from repo and what is genuinely new.

## 7. Provider/model matrix
For each planned engine/provider, record:
- capability;
- adapter type;
- self-host vs API;
- license;
- commercial restrictions;
- minimum practical VRAM;
- expected latency class;
- cost accounting unit;
- Arabic strengths/weaknesses;
- fallback.

Do not download or deploy models during reconciliation.

## 8. PR decomposition
Return a proposed sequence of small PRs with no overlapping file ownership between Muse and Cursor.
Each PR must list:
- exact scope;
- likely files;
- tests;
- migration impact;
- feature flag;
- rollback;
- production evidence needed.

## 9. Critical rule
If current repo reality conflicts with MASTER_PLAN.md, do NOT force the plan. Document the conflict and propose the smallest architecture correction.
