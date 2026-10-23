# Demo dashboard UAT (#243)

Record results outside the secret files. Use the private SSH tunnel, not a public URL.

- [ ] `curl http://127.0.0.1:3210/api/health` returns 200 with API ready, auth configured, DB connected.
- [ ] Only `127.0.0.1:3210` is published; canary `3200` and its containers are unchanged.
- [ ] Unauthenticated dashboard route redirects to sign-in; unauthenticated private APIs return 401.
- [ ] Owner can sign in with the generated synthetic owner account.
- [ ] Owner sees “Demo Summer Camp” and the seeded approval inbox.
- [ ] Owner can open team access and see the reviewer account; reviewer cannot open team admin API (403).
- [ ] Campaigns, approvals, creative studio, templates, designs, motion, brand kits, and team pages render.
- [ ] Arabic locale renders a right-to-left creative interface.
- [ ] Reviewer can sign in and see the pending approval fixture.
- [ ] Reviewer can approve the smoke fixture; its decision is visible and survives refresh.
- [ ] Reviewer rejection is available and records a rejection reason.
- [ ] Optional write smoke on fresh demo volumes: private S3 upload succeeds, private preview returns `image/png`, approval passes, and rejection passes. Do not rerun against consumed fixtures.
- [ ] Image generation and other unavailable provider actions report the disabled state; no fake output appears.
- [ ] With the workspace profile off, `/workspace` clearly reports that the Gemini worker is not connected and makes no provider call.
- [ ] With an operator-installed key and the workspace profile on, one English assignment produces six ordered deliverables with provider, actual model and token evidence; no external action is claimed.
- [ ] The five specialist documents are Gemini `gemini-2.5-flash` output; the Executive Summary is deterministic and reports no measured sales.
- [ ] Arabic assignment renders RTL and stores Arabic specialist documents without language mismatch.
- [ ] Owner approval/rejection is human-only, records feedback, and cannot be performed by the worker role.
- [ ] A simulated quota/request failure is persisted with a provider error, triggers the emergency stop, and does not retry automatically.
- [ ] No real credential, provider call outside the explicit Gemini activation, publishing action, or customer data is present.
- [ ] Restarting only the demo project preserves demo data; rollback leaves volumes intact by default.
