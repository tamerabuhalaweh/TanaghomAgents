# Dependency advisory remediation — 2026-11-01

Scope: #254, source-only patch from main `bd21258ddba9a5b7dd0a66d18ed1c7fbf9a43856`.
No deployment or live service claim. The npm audit database changes over time;
rerun the audit against the actual release before deployment.

The fresh baseline audit reported critical Next.js advisories and moderate
fast-uri/ajv advisories. This patch changes the explicit Next.js pins from
16.4.0 to 16.4.3 and the fast-uri override from 3.1.8 to 3.1.9, keeping the
existing audit threshold. Regenerating the lockfile changed only those package
versions and their associated `@next/*` components; npm also reconciled
existing workspace/dependency metadata. It added or removed no lockfile entries.

The agency evaluation source locks hash normalized UTF-8/LF text. The documented
source freeze is re-taken solely because `package-lock.json` changed: its
normalized hash is `e6580989388f6d7ed10b094c8f3fea24c548406516e9631680a2238f07a3c70d`.
The runner lock references the resulting normalized preparation-lock hash
`54513e27320bc88e33cbd9a8645dc840b3038f25c0a106dd9cfae3941c778eca`.
No prompt, corpus, rubric, model, real-world evaluation result or prior approval
is changed or asserted by this re-freeze. The PR must receive review and current
checks; a source lock hash alone is not an approval.

Draft Gemini PR #251 independently includes a Next.js update and still has the
older fast-uri override. Reconcile the dependency patch and the source locks
when preparing its corrected successor; do not assume branches merge cleanly.
