# Product roadmap

## Delivery order

1. Stabilize identity, permissions, tasks, and the content production line.
2. Add the manual CRM foundation and accountable follow-up tasks without importing or messaging production customers.
3. Build the brand knowledge center so briefs, design, editing, and copy use one approved reference.
4. Build one quarterly plan, a dated content calendar, and an evidence-based team-readiness gate.
5. Define metric ownership and add approved manual observations before connecting external analytics.
6. Add external integrations incrementally, starting in test mode with explicit owner approval.

The brand knowledge foundation is now implemented: drafts, owner approval, immutable version history, audience-aware reads, and exact references on new content workflows. It contains no invented brand rules; the owner will add and approve the real material during personal testing.

The planning foundation is now implemented: one active quarterly plan, content pillars, a dated owner-based calendar, explicit linking to canonical content, automatic state synchronization, a live leadership dashboard, and deduplicated in-app deadline reminders. No plan, pillar, calendar line, or team alert was seeded for the owner.

## Before real team onboarding

1. Approve at least four real brand references covering identity, writing, editing, and design/publishing rules.
2. Create and activate one real content plan with at least the first four scheduled items.
3. Rotate the Telegram bot token, confirm only intended channels are allowlisted, and manually inspect any `unknown` publication result.
4. Test the AI provider, one invited account, least-privilege visibility, one task handoff, one revision, and one completed notification flow.
5. Review the final domain/Auth redirects and hosted-site access policy before inviting a real employee.
6. Keep analytics, imports, customer messaging, Meta publishing, and direct uploads visibly off until each trusted integration is approved and verified.

## Current raw-material contract

- Telegram is the working inbox for original audio, video, images, and the unstructured production request.
- A content item stores the direct Telegram message/file URL, the approved copy of the original request, extracted references, and the execution timeline.
- The browser parser creates only a review draft. Database records and tasks are created only after an authorized manager approves that draft.
- The web application does not download, copy, or re-upload Telegram files in this phase.

## Deferred direct uploads

Direct file upload is intentionally planned for a later phase so it can be introduced without weakening access control or disturbing the current workflow.

1. Create private Supabase Storage buckets split by organization and content item.
2. Enforce upload, read, replacement, and deletion rules with membership-aware policies; never expose a public production bucket.
3. Store file metadata and immutable ownership in Postgres, then use short-lived signed URLs for viewing.
4. Add resumable uploads, file-size/type limits, malware scanning, and audit events before team rollout.
5. Allow a Telegram link and a direct upload to coexist during migration; do not silently move or delete originals.
6. Verify the canonical content, task, campaign, and permission contracts before enabling uploads in production.

## Later integrations

- A trusted Telegram worker can turn approved bot actions into authenticated application commands and send deadline notifications.
- Google Drive synchronization can attach verified file records while preserving ownership and source URLs.
- Meta publishing and analytics ingestion require restricted credentials, retryable workers, idempotency, and real platform confirmations before the UI reports a post as published.

## Telegram scheduled publishing foundation — implemented

The private control room now stores posts, verified allowlisted channels, Cairo schedules, frozen snapshots, occurrences, and per-channel publication logs. The default policy sends a preview but does not stop the team when the owner is unavailable; strict approval remains an explicit option for sensitive posts.

1. A unique database claim is created before every Telegram network call, keyed by occurrence and channel.
2. A generation fence and organization kill switch stop claimed work before a new network call can start.
3. Content is frozen at preview/claim time; a hash mismatch holds the occurrence instead of publishing changed content.
4. A timeout or exception after the network call begins becomes `unknown` and is never retried automatically.
5. A real Telegram message ID and URL are required before an occurrence becomes published or its linked content task closes.
6. Preview controls are signed by a one-time callback token and limited to a connected leadership Telegram account.
7. The first rollout remains limited to the owner's verified test channel; Meta publishing is still a later integration.
