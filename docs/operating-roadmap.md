# Market Whales OS — Operating Roadmap

This file is the implementation memory for ideas that must not disappear between releases.

## Team-ready foundation

- Invite-only login with owner-controlled email, role, and section access.
- Assignee-only task execution, private voice profiles, and owner visibility.
- Content, scripts, campaigns, publishing, CRM, planning, brand knowledge, and analytics workspaces.
- Focused current views plus terminal archives for operational cards.
- Internal team community chat with rooms, replies, editing, deletion, and reply notifications.
- Permission-scoped AI assistant for questions about the signed-in member's work and allowed knowledge.
- Telegram publishing with allowlist, idempotency, frozen snapshots, kill switch, and archive.

## Controlled data migrations

- Telegram CRM import source: `ادمن الحيتان` → topic `العملاء`.
- Accepted fields: name, phone, email, TradingView username, registration date, source message id.
- Reaction mapping: Ayman 👍 = activated, Asmaa 👍 = contacted, 👎 = account correction required.
- Import must be reviewed as a batch, deduplicated, auditable, and reversible. No message or reaction is ever sent to Telegram during import.
- File uploads may later move from Telegram-first raw material to managed platform storage without breaking existing links.

## Next AI phases

- Assistant actions (create/update records) only after a per-action preview and human confirmation.
- Competitor watchlist and radar using approved collection providers such as Apify.
- Extract the transferable principle, transcript, hook, visual pattern, and performance evidence without copying execution.
- Personal style corpus per member; no member can read another member's corpus.
- Idea bank, duplicate prevention, approved script inventory, recorded inventory, and published library.
- Trend discovery and editor-ready production tasks, with every generated output explicitly selected before save.

## Integrations after team launch

- **Exness** agency API: server-side secret, scheduled synchronization, and an immutable sync log.
- Owner view: client profile, account numbers, activity, lots, and commissions.
- Sales view: lookup by account/profile id returning only `under agency` and `active/inactive`.
- No Exness secret or financial payload is exposed to the browser or ordinary team roles.
- Multi-channel social analytics and launch evaluation.
- Scheduled publishing beyond Telegram after provider approval and platform-specific safeguards.

## Non-negotiable rules

- Database RLS and server commands enforce access; hiding a button is never considered authorization.
- One source of truth per entity and one accountable owner per task.
- AI preview never changes workflow state unless the user explicitly selects and saves it.
- Terminal work leaves current boards and remains searchable in archives.
- No production publishing test is sent to an allowlisted real channel without an explicit, current approval.
