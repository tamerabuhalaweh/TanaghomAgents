# AI workspace: customer story and test walkthrough

## What is different

You are the campaign owner. Instead of browsing agent biographies, give the team
one outcome and a set of confirmed facts. Tanaghom saves that assignment. Each
specialist receives the same facts and earlier saved deliverables, produces its
own document, and hands it to the next specialist. You can inspect the result,
its source context, and activity history before accepting the exact work pack.

| Specialist | Actual deliverable in this bounded pilot |
| --- | --- |
| Social Media Strategist | Campaign audience, positioning, content pillars and cadence |
| Content Creator | Three usable draft posts with calls to action and visual briefs |
| Brand Guardian | Specific claims/consistency findings and suggested corrections; not approval |
| Discovery Coach | Lead qualification questions, fit indicators and sample exchanges |
| Support Responder | Grounded draft FAQ answers and human-handoff wording |
| Executive Summary | Deterministic inventory of saved documents, not a sixth model call |

Shared memory is **assignment-local**: your immutable brief/facts and saved prior
outputs. It is not cross-customer memory, permanent self-learning or a department
manager. Specialists cooperate in a fixed order, not an unconstrained group chat.
They create draft work, not social posts sent, real conversations or CRM actions.

## Current state: before the Gemma connection is supplied

The new interface and runtime are deployed at source369525f on the test VPS.
The platform Gemma API key is missing, both execution stops are engaged, and the
private n8n dispatcher is inactive. Therefore **Start assignment is disabled**.
This is not a passed live-AI customer acceptance test. No generated examples
have been inserted into the public database to make the screen appear busy.

1. Open https://tanaghom-test.155-117-45-45.sslip.io/workspace.
2. Sign in with your existing Tanaghom owner email/password, not the VPS password.
   If login returns to Overview, select **AI workspace**, the second navigation
   item, or reopen the link above. No local SSH tunnel is needed.
3. Expect **Model connection pending**. Choose **New assignment**.
4. Enter these deliberately fictional values:

   | Field | Value |
   | --- | --- |
   | Assignment title | `Organic course campaign .test` |
   | Output language | English |
   | Who should work on it? | Campaign Work Pack — all six specialists |
   | Task brief | `Create a one-week organic Instagram campaign work pack for a fictional practical writing course in Amman. Produce useful draft copy, brand findings, qualification guidance and FAQ answers. No paid ads, publishing, customer contact or promises of results.` |
   | Shared source facts & brand guidance | `This is a fictional test. The offer is a practical writing course for adult learners in Amman. Confirmed language: English and Arabic. No price, course date, refund policy or accreditation is confirmed. Do not invent them. Tone: clear, friendly and professional. Budget: zero. Ask a human when facts are missing.` |

5. Click **Save assignment**. Expect the saved brief, facts and six specialists.
6. Refresh, or leave and reopen it from **Assignments**. The same brief persists.
7. Stop here while the model connection is pending. Saving is not generation.
   Do not paste customer secrets, API keys, private contact lists or passwords
   into either task field.

## After the engineer reports the real-model canary passed

These are future acceptance steps, not claims that they have already passed:

1. Open the saved assignment. Expect **Model worker configured** and an enabled
   **Start assignment**. The engineer must also have validated actual dispatcher
   polling; a configured key alone does not prove a worker is consuming tasks.
2. Click **Start assignment** once. Follow Queued → Working; the page refreshes
   stored state every five seconds. It does not fabricate typing or activity.
3. Select each specialist when its deliverable is ready. Read **Deliverable**.
4. Select the Content Creator, then **Shared context**. Confirm that the original
   facts and the strategist's exact saved result were passed to it. Earlier
   model outputs are labelled unapproved proposals, not owner-confirmed facts.
5. Repeat for Brand Guardian and later specialists. Check **Activity** and
   **Version & source lineage** for task/result references.
6. Check that all six steps completed. Executive Summary must list the actual
   documents and must not claim revenue, conversions, messages or publication.
7. Choose **Approve work pack** only after reading it, or enter specific feedback
   and choose **Request changes**. Verify the decision persists after refresh.
   Approval applies to the exact saved pack and sends nothing externally.
8. Rejection records feedback but does not automatically regenerate. Create a
   new assignment with corrected facts/brief to request a revised version.
9. Use **Export pack** to download the saved documents as Markdown.
10. Repeat with Output language **Arabic**. Check natural Arabic, right-to-left
    reading, preservation of factual limits, and appropriate human escalation.
11. Optionally select one specialist in a new assignment to test an independent
    task. A standalone Brand Guardian needs actual draft text in the brief.

If any request fails or becomes uncertain, stop testing and provide the
assignment ID, time and displayed error. Do not repeatedly queue replacements:
the worker deliberately does not retry uncertain model calls automatically.
Pause/cancel preserves completed work; an already-sent request may finish.

Record customer result and defects under #176/#178/#179. Real model-quality
certification remains #177; full provider/customer acceptance remains separate.

## Only missing input for the next bounded model step

The platform owner can add `GEMMA_API_KEY=<existing approved key>` to the ignored
`C:\Users\tamer\Desktop\Groky\TanaghomAgents\.env`, or tell the engineer the
path to an existing approved Tanaghom credential file. Do not paste the key into
chat or GitHub, and do not edit SmartLabs configuration to obtain it. The engineer
handles secure transfer, model checks, bounded trials and dispatcher activation.

This hostname/certificate needs no additional domain purchase. Its availability
depends on the VPS retaining its IP and the free DNS service; it is not a
promise of perpetual free hosting.
