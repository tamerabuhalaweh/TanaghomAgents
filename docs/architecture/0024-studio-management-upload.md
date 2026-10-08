# ADR 0024: P1b studio management sequencing and secure upload boundary

Date: 2026-10-08. Status: implemented for review under #227; not deployed.
Predecessors: RECONCILIATION.md §§9/14, ADRs 0020–0023, tasks/227.md.

## Decision and scope

P0 reconciliation reserved `0037` for a credit ledger, but that was a
proposal and no credit schema exists on main. This slice needs
brand-kit, template, and upload lifecycle functions and no credits, so
`0037_creative_studio_management` carries exactly those six controlled
functions (`create_brand_kit`, `create_brand_kit_version`,
`set_brand_kit_current`, `create_creative_template`,
`set_creative_template_active`, `register_upload_asset`) plus the
object-key uniqueness constraint and the extended `creative_events`
action vocabulary. Credits move to 0038, voice consent to 0039,
web/growth to 0040. No credit ledger, balance column, or billing
behavior is introduced here; any future credits work remains an
immutable-ledger design per RECONCILIATION.md §6, never a numeric balance.

Uploads are user bytes, not provider output, so they enter through a
dedicated application boundary, not the worker claim lane:
authenticated owner/operator multipart route → size/MIME/magic/
extension/dimension checks → `sharp` parseability gate with a pixel cap
(decompression bombs fail closed) → server-built strict tenant key →
exclusive local write (`O_EXCL`, duplicates 409) → single-transaction
`register_upload_asset()` (enqueue → system claim/run/register/complete
with full audit mirrors) → idempotent API record. Original filenames
never touch storage paths (provenance only, sanitized). EXIF is
retained in P1b with `exif_present` recorded and stripping deferred to
publish/export time (documented, not silent). No URL is ever fetched;
no SSRF surface exists. Previews are authenticated same-origin byte
responses, never public URLs. Production object storage stays a later
decision with license/cost review; the local backend is disposable/test
only and takes no credentials.

## Non-goals of this decision

No provider selection, GPU placement, credit semantics, Studio-wide
i18n migration, or production deployment. Arabic RTL acceptance for the
new surfaces is covered by the P1b browser journeys, not by this record.
