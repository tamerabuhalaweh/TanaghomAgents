# Fresh CPU test workspace: owner walkthrough

Scope: the additional 155.117.45.45 test installation under #200, not the
certified 38.247 environment. This is the original dashboard/API/database guide,
not acceptance of live agents or providers. For the newly deployed specialist
workspace, use the [AI workspace walkthrough](AGENCY_WORKSPACE_GUIDE.md).

## Sign in

1. Open https://tanaghom-test.155-117-45-45.sslip.io/login in a normal browser.
   No SSH window, local tunnel or provider console is required.
2. Use your existing Tanaghom owner email and its existing Tanaghom sign-in
   password. This is NOT the VPS/DB password.
   No password was changed or copied into GitHub by this deployment.
3. Expect a fresh `Tanaghom Test Workspace`. Previous campaigns, approvals,
   integration credentials and leads were deliberately not copied.
4. If login fails, report the page URL, time and visible error, not passwords
   or session tokens. Owner-password sign-in is a human UAT step; public-page
   browser checks alone do not establish that it has passed.

## Create and reopen one harmless draft

1. Go directly to `/campaigns` and choose **Create campaign**. Do not use the
   older disabled Overview shortcut; its remaining UI caveat is in STATUS.
2. Use these deliberately fictional values:

   | Field | Test value |
   | --- | --- |
   | Campaign name | `Fresh VPS UI test .test` |
   | Product or offer | Course |
   | Campaign brief | `Fictional interface test only. No real offer, price, refund promise, publishing, messaging or spending is authorized.` |
   | Target audience | `Fictional adult learners for an interface test` |
   | Target geography | Amman, Jordan |
   | Content languages | English and Arabic |
   | Budget / revenue targets | 0 / 0 |
   | Currency | USD |
   | First content batch | 2 |

3. Save the draft. Expect its detail page, then refresh and reopen it from
   Campaigns to check persistence.
4. Stop at the saved brief. Do not use a generation/ready transition as a
   live-agent test: the new private workspace n8n is inactive and no model is connected.
   This deployment will not automatically produce strategy/content drafts.

## Inspect the governance screens

- `/settings/skills`: inspect the platform Skill Library. A customer skill
  draft does not grant tools or install executable code.
- `/settings/agents`: inspect Agent Studio templates and the builder. An
  agent draft or validation state does not imply a running worker.
- `/agents`: inspect role and dependency information. Inactive/not-ready
  worker states are expected in this deliberately non-executing installation.
- `/settings/integrations`: keep provider credentials empty for this round.
- `/team`: the existing owner is mapped; new invitations are unavailable
  because the shared Supabase admin key was intentionally not transferred.
- Sign out and confirm that protected pages return to login. Repeat the
  login-page check on a phone or a narrow browser window.

Record actual result, browser/device, time and any defect for each step under
#200/#125. Never count expected empty data or disabled automation as a passed
live campaign journey. Do not upload real customer data to this disposable VPS.

## Next engineering gate

The separate workspace package is now deployed; its actual model gate is still
pending the Gemma API credential and bounded English/Arabic validation. See
the [deployment evidence](../evidence/2026-09-06-agency-workspace.md). The frozen
#177 comparison runner is not repurposed as this live document worker. Existing
production inference services must not be reconfigured or restarted. Provider
UAT and customer signoff remain separate #45/#54/#125/#137 gates.

The hostname and HTTPS certificate require no additional domain purchase.
Availability depends on the VPS retaining its IP and the free DNS service;
this is not a guarantee of perpetual free hosting or off-server data recovery.
