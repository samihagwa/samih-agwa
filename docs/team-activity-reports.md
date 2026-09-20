# Team activity reports

## Scope and privacy

Owner-managed daily/weekly snapshots in Team & Permissions. Existing presence and immutable audit records are the evidence, not an AI employee evaluation. Presence is a visible-tab heartbeat, not reliable working hours, leave, attendance/payroll, or proof of inactivity. Historical presence starts at migration installation; no backfill is fabricated. Members are explicitly informed in the Team workspace. Active members only are eligible for settings and generation.

Reports expose counts and first/last presence, not private script text, customer conversation contents, or raw audit JSON. No new external monitoring is added. Owner may select active owner/admin/manager recipients for a full report, and ordinary members for their own report only. Recipients must be explicitly selected. Current membership and recipient permission are rechecked for every list/get and immediately before Telegram HTTP delivery. Already delivered site notification snippets or Telegram messages cannot be recalled.

No paid resource, AI provider, or additional external scheduler is required by this implementation. Existing infrastructure limits still apply. Reports and presence history are retained in restricted private tables with no automatic deletion in this release; a retention/export policy requires an explicit subsequent owner decision. Existing audit retention is unchanged.

## Counting contract

- Each work object counts once per metric per report period. Do not add different metrics into a productivity score. Weekly unique objects need not equal summed daily objects.
- Created tasks and tasks transitioning to done exclude explicitly hidden `is_work_item=false` workflow rows. Completion credits the task owner in the audit snapshot at completion, not the later owner or approver.
- Task delivery and content step submission deduplicate by task ID. Publishing-step submission has its own metric and is not external publication proof.
- Content request creation, script creation/saves, CRM addition/follow-up/purchase logging, comments/messages, schedules/revisions, and calendar moves are mapped from explicit audit action allowlists. Uninstrumented platform operations are not inferred. No AI request or preview counts as authored work.
- Auto-published content counts distinct confirmed Telegram occurrence IDs credited to content creator; multiple channel logs do not multiply it. This is not manual work or confirmation of Meta/YouTube publication.
- Open overdue tasks are labeled **at report generation**, not as-of a historical period end.
- Date boundaries use Africa/Cairo midnight, exclusive next-day boundary, including DST. Preview supports up to 31 inclusive days and labels unfinished periods.

## Settings, schedules and delivery

Install disabled. Default unsaved configuration includes all active members and owner as on-site full-report recipient, Telegram off. Save uses a revision check to avoid overwriting another settings session. Preview uses the last saved configuration and never sends or persists a report.

Daily covers yesterday. Weekly covers the seven completed days before the most recent selected weekly boundary. Both run after the selected Cairo hour with a 15-minute Cron poll. Enabling a schedule can create its most recent completed period on the next poll, not a full historical backlog. A unique period/recipient/scope/cadence key plus transaction lock prevents duplicate reports/notifications. Changes to recipients can create the same period once for newly selected recipients. Future reports use current settings; existing snapshots are immutable.

Telegram uses the existing connected private account, workflow-notifications preference and outbox. New report-kind gate additionally requires the report recipient's Telegram opt-in. Existing claim, 429 deferral, terminal failure, and uncertain-send handling remain. A worker failure does not delete the saved on-site report.

## Release gate (not performed by this implementation turn)

1. Obtain owner approval for the exact tested GitHub/frontend release and database migration. Current branch may contain prior unpublished Scripts work; review that scope before pushing.
2. Verify production prerequisite tables/columns and current notifications-kind allowlist against migration. Confirm backup/rollback plan and pg_cron availability. No paid branch creation.
3. Apply `20260920020042_team_activity_reports.sql` with schedules disabled. Verify private table grants/RLS, RPC ACLs, and `cron.job` entry `team-activity-reports`; inspect job failures after one run.
4. Deploy updated `telegram-publisher` worker before enabling any report Telegram recipient. Deploy matching frontend. Verify owner settings and ordinary-member report access without granting Team section permission.
5. Owner chooses included users, recipients and Telegram delivery explicitly. Authorize a single owner-recipient pilot; confirm saved report, site notification, actual Telegram message, complete link target, and one report only after retry. No automatic live pilot is run here.
6. Disable via daily/weekly toggles. Remove recipients to revoke report access and future queued report delivery. Rollback should disable the Cron job and settings, retain report/history data, then revert UI/worker together; do not drop data or disable unrelated Telegram jobs.

## Verification

`tests/team-reports.test.mjs` loads the real new migration into isolated PGlite using a minimal schema/notification fixture. It covers allowed/denied owners, tenant boundaries, recipients, settings revision, private-table C/R/U/D denial, presence history, Cairo DST, unique-object counting, owner attribution, recurring idempotency, personal reports, Telegram opt-in and revocation. It is not a full replay of all production migrations.

`tests/team-report-delivery.test.mjs` executes the actual worker notification function with mocked RPC/HTTP, checking authorized/denied reports, normal notifications, rate limits, and unknown network outcomes. No messages are sent.

`tests/team-report-preview.html` is a local-only fixture with clearly labeled fake names/counts and mocked backend. Tested via Chrome at desktop, 390px dialog, and 320px settings; save, personal/full recipient options, centered dialog, Escape and focus restoration. This does not constitute authenticated production or physical-device acceptance. Shared route SSR gates are covered by the existing route suite.
