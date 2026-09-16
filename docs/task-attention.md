# Task attention: urgency, acknowledgement, help

The requester can send an urgent nudge to the current assignee. The assignee explicitly acknowledges it, optionally supplying an expected completion time, or requests help with a reason and details. Only the assignee resolves their help request. These signals never start, complete, block, or reschedule the canonical task and never bypass CRM/content dependency rules.

- One shared UI on the task board and exact task page, including grouped content work.
- Urgency resends have a server-enforced 15-minute cooldown; duplicate clicks are also guarded in the UI.
- Acknowledgement is explicit, not a read receipt inferred from viewing a page.
- Read visibility inherits task RLS. Writes use a JWT-actor RPC, task-row lock, expected revision, active membership, and requester/assignee checks. Viewers cannot act.
- Reassignment hides previous signals; the next command clears old assignee state. Closed tasks show no active controls.
- Each state change creates one audit event and one participant notification. The existing opt-in Telegram outbox applies; no new broadcast or automatic escalation is introduced.
- The optional promised time does not alter the original deadline.

## Verification (2026-09-16)

- Typecheck, lint, production build, all 114 tests passed.
- `tests/task-attention.rollback.sql` exercised the actual deployed RPC under the authenticated role: actors, outsider RLS, anonymous denial, direct-write denial, stale revisions, cooldown, invalid ETA, required blocker data, idempotent acknowledgement/resolution, and exactly four audit/notification events. The task row and deadline remained unchanged. The entire transaction rolled back.
- Browser fixture uses the real controls and isolated mocked persistence, never production credentials. Interactive tests covered urgency, duplicate clicks, cooldown errors, acknowledgement, invalid/present ETA, help, resolution and viewer-hidden actions. Inspected desktop/mobile renders and overflow at 320/390/1280 pixels; no page errors.
- After rollback: zero tasks, zero attention rows, 119 CRM contacts preserved.
- No real recipient notification was sent for acceptance testing. Actual team delivery remains to be confirmed with the first real task.

Security advisor findings stayed at the pre-existing baseline; this release did not remediate unrelated findings or add new ones.
