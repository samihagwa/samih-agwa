# Product roadmap

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
