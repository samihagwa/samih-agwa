# CRM conversation images

## Contract and privacy

- Owner: Market Whales management. Purpose: customer-follow-up evidence supplied by the sales team.
- Existing Supabase Storage only; private `crm-conversation-images` bucket. No new paid service, public link, Telegram forwarding, or AI processing.
- Access requires both current CRM section access and the canonical contact-access rule. Membership/reassignment is rechecked on every metadata request and authenticated download. Already downloaded pixels cannot be recalled from someone's device.
- Immutable object paths; only the reserving uploader can upload/finalize. Archive/restore requires uploader or leadership, plus current contact access. Archive is reversible and does not save space. No automatic purge.
- New contact-image metadata lives in the private schema with RLS and no direct authenticated CRUD. Public RPC is an invoker wrapper around access-checked private operations.
- Client re-encodes PNG/JPEG/WebP, strips original metadata, and can apply opaque redaction before upload. This is an assistance feature, not an assertion that every sensitive field has been found. Do not upload originals automatically.

## Capacity and recovery

- Up to 5 images per batch, 200 retained/reserved images per contact; 1 MiB per stored object.
- Reserve the full 1 MiB before upload under one project-wide transaction advisory lock. Completion replaces reservation size with trusted Storage metadata. Duplicate hashes are contact-scoped and idempotent.
- Gallery ceiling: 700 MiB including archived/pending entries. Reservations also check existing non-gallery Storage usage against a combined 900 MiB ceiling. Other upload workflows and Storage egress are not governed by this gallery cap; this is not a guarantee about the project's billing plan.
- Abandoned reservations remain counted conservatively. Retry the same prepared image to complete without duplication. If compression/redaction changes the bytes, it is a different image. No destructive expiry job is installed.
- A failed upload can be followed by a safe finalize attempt: this recovers an already-arrived immutable object regardless of whether Storage reports duplicate as HTTP 400 or 409. The database still validates its size, MIME and uploader.
- Backups of SQL metadata alone do not back up Storage object bytes. A future backup/export must include both; this release does not create that backup system.

## Verification and release

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (build and all route/domain tests).
- `tests/crm-images.test.mjs`: isolated PGlite permission, RLS, duplicate, quota, archive, metadata and audit checks. No paid branch.
- `tests/crm-images-preview.html`: actual component with explicitly isolated in-memory storage/RPC. Browser-tested upload, redaction, preview, archive, restore, paste and 390px layout. Not evidence of a production upload.
- Deploy additive migration before UI. Verify bucket privacy and function grants after applying. Keep existing CRM creation, assignment, follow-up and customer segmentation unchanged.
- Rollback: deploy prior UI version; keep new private table and bucket/data intact. Do not drop the bucket/table to roll back an interface release.

## Live backend verification (2026-09-20)

Migration applied successfully. Read-back confirmed private bucket, 1 MiB/MIME restrictions, authenticated-only RPC and scoped SELECT/INSERT policies (no client UPDATE/DELETE). Security advisor reports the new private table's intentional deny-all RLS as informational; the API uses checked private functions, not direct table grants. [RLS informational finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Unrelated existing warnings remain outside this change: [pg_net in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [legacy callable security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This release is not a full security audit or remediation of those settings.
