# Future dept shells — INACTIVE reference only (Phase C)

> Sources (all MIT © Chris Brock, NOT yet adapted — shells only):
> - finance: `unit-economics`, `budgeting-and-forecasting` — https://github.com/cbrock84/headcount/tree/main/plugins/finance
> - people: `hiring-and-interviewing`, `onboarding-and-offboarding` — .../plugins/people
> - operations: `procurement-and-sourcing`, `vendor-management`, `capacity-and-demand-planning` — .../plugins/operations
> - reviewer: `security:threat-modeling`, `legal-risk:contract-review`
> Status: DISABLED. No workflow active, no spend, no contact. Activation requires ROADMAP_DEPARTMENTS gates.

## Intended mapping (when activated)
- Finance → `dept_finance_reports` (unit economics per campaign, budget vs actual, revenue recognition). Reads `campaigns`, `sales_reports`, never writes money movement.
- People/HR → hiring checklists + onboarding docs for coaches/closers. No auto-offer, human signs.
- Logistics/Ops → camp logistics (venues, capacity, vendors). Staging dry-run first, same `is_staging` guard as Agent 3.
- Security/Legal → pre-publish + pre-send reviewer (blocking findings stop, never overruled by producer). Human still final approver.

## Activation order (see docs/ROADMAP_DEPARTMENTS.md)
1. finance-readonly → 2. people-checklists → 3. ops-logistics-staging → 4. reviewer-class (security/legal) as automated pre-check.
No dept may spend, contact leads, or publish before its staging dry-run + your explicit `status='staging'` → `'production'` flip.
