# Reference 08 — Sales Enablement (adapted for Groky Agent 4 collateral)

> Source: https://github.com/cbrock84/headcount/blob/main/plugins/revenue/skills/sales-enablement/SKILL.md
> License: MIT © Chris Brock. Adapted.
> Groky use: objection answers inside approved templates, one-pager/battlecard inputs to `media_brief`/`message_templates.body`, demo scripts for `call_script` channel.
> Guards: collateral NEVER sent directly — only via approved `message_templates` + GHL workflow. Every use logged.

## Stall first
Find where deals die (first call / after demo / pricing / security / champion's boss) before building. Wrong-stall remedy = beautiful collateral nobody opens. Groky: read `sales_activities.outcome` + `lost` reasons first.

## Core set (highest leverage first)
- One-pager: champion forwards to unseen others — must survive no-context, no-presenter. Most neglected, highest leverage.
- Pitch: problem recognized → why current fails → what you do differently → proof → commercials → next step. 10–15 slides, takeaway headline each.
- Objections: real words, acknowledge legitimate part first. Denial = evasion = trust end. Groky: top-4 objections → `follow_up_2` / `nurture` variants, plain answers.
- Battlecards: per competitor — where they genuinely win, where you do, traps to avoid, what to say when raised. "We win everywhere" = ignored by sellers.
- Cases: situation → change → measurable result, buyer language. One verifiable number > page adjectives.

## Demo
Outcome, not interface. Start where value visible (not login/settings). Tailor to stated problem (feature tour = not listening). Prep 3 always-wrong things. Reach value moment in 5 min when cut.

## Maintain
Every asset: owner + review date. Pricing/competitor/capability → check quarterly. Old battlecard loses deals. Unmaintained > none is false — unmaintained is worse than none.
Groky: `message_templates.version` bump + `approved_by/at` re-approval on any pricing/competitor change. Retire, don't edit live (`status=retired` + new version row).
