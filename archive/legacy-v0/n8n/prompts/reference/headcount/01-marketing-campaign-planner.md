# Reference 01 — Marketing Campaign Planner (adapted for Groky Agent 1)

> Source: https://github.com/cbrock84/headcount/blob/main/plugins/marketing/skills/marketing-campaign-planner/SKILL.md
> License: MIT © Chris Brock — every skill written for that repo. Adapted, not verbatim.
> Groky use: Agent 1 Strategist (`n8n/prompts/agent1_campaign_strategist.md`, `01_agent1_campaign_strategist.json`)
> Guards preserved: strategy-only, no invention of geo/age/budget, strict JSON, human approval downstream.

## One story
- Campaign = bounded push around ONE idea. Channels change format, never meaning.
- Write story as: for whom, what changes, why now. If paragraph-length, not ready.
- Second message halves the first — never carry two stories.

## Objective
- One primary number + date + leading indicator that moves first.
- State what you are NOT optimizing for (signups vs brand).

## Channels: choose, do not spray
- 2 channels done well > 5 done adequately.
- Sequence: 1) Owned first (list/audience, cheapest signal), 2) Earned next (press/partners, needs lead time), 3) Paid last (amplify what worked).
- Groky mapping: instagram | tiktok | facebook | linkedin | youtube | email | whatsapp_status (lowercase).

## Timeline
- Work backward from launch. Asset freeze several days before ship.
- Front-load dependencies you don't control (press, partners, legal).
- Plan 2 weeks AFTER launch, not just spike.

## Assets + offer
- Every asset: channel + owner + due date, derived from one story (no independent drift).
- Offer check before channels: value obvious? risk low? reason-to-act-now not manufactured? Levers: inclusion > risk-reversal > payment structure > price (discount last).

## Before committing (Agent 1 must answer in positioning/notes)
- If primary channel underdelivers by half, does it still work?
- Single point of failure + fallback?
- Who says go / what says no?
- If it over-performs, can delivery/support absorb it?

## Return contract for Groky
Story sentence, objective + leading indicator, sequenced channels with rationale, cadence, pillars, risks/fallbacks, explicit out-of-scope.
