# Product roadmap

## Delivery order

1. Stabilize identity, permissions, tasks, and the content production line.
2. Add the manual CRM foundation and accountable follow-up tasks without importing or messaging production customers.
3. Build the brand knowledge center so briefs, design, editing, and copy use one approved reference.
4. Define metric ownership and add approved manual observations before connecting external analytics.
5. Add external integrations incrementally, starting in test mode with explicit owner approval.

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

## Deferred scheduled Telegram publishing

Scheduled channel publishing is planned after the operating foundations and brand rules are stable. Its first release must be a test-only path, never a direct production switch.

1. Store a post draft, target channel, Cairo timezone schedule, author, approver, and immutable content revision.
2. Default every channel connection to `test_mode`; a dry run renders the exact message and media without sending it to a real channel.
3. Require an explicit approval gate after the preview and before a post enters the delivery queue.
4. Use an idempotency key per approved revision and schedule so retries cannot duplicate a post.
5. Run delivery through a trusted worker with bounded retries, rate limits, an audit trail, and a dead-letter state for manual review.
6. Mark a post as published only after Telegram returns a real channel message ID; store the confirmation and error history.
7. Keep real publishing disabled until the owner deliberately enables one verified channel after personal end-to-end testing.
