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
- [ ] No real credential, provider call, publishing action, or customer data is present.
- [ ] Restarting only the demo project preserves demo data; rollback leaves volumes intact by default.
