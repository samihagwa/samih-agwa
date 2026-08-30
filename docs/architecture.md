# Architecture

## Decision

Use a React + TypeScript web application with Supabase as the primary backend.

## Boundaries

```text
React web app
  -> Supabase Auth (identity)
  -> Postgres + RLS (source of truth)
  -> Storage (files and metadata ownership)
  -> Realtime (board updates and notifications)
  -> Edge Functions (short privileged operations)

Trusted integration workers
  -> Telegram delivery and action callbacks
  -> Google Drive synchronization
  -> Meta and analytics ingestion
  -> retries, queues, rate limits, and dead-letter handling

Existing Market Whales application
  -> isolated external system until an approved API/event contract exists
```

## Frontend rules

- Keep a single application shell and shared design primitives.
- Generate database types after schema changes and consume them from one module.
- Never make the UI the only enforcer of a business rule.
- Prefer server-side or database-validated commands for irreversible transitions.

## Backend rules

- Use UUID primary keys, `created_at`, `updated_at`, and explicit organization ownership.
- Enable RLS before exposing tables through the Data API.
- Use `app_metadata` or database membership rows for authorization.
- Put uploads in private buckets and use short-lived signed URLs.
- Make webhook and job handlers idempotent and audit every privileged mutation.
- Keep authorization helpers in a non-exposed `private` schema. Prefer trusted server code for privileged operations; any narrow `SECURITY DEFINER` command must validate the authenticated caller, use an empty search path, expose no table writes, and have explicit execute grants.

## Task workflow contract

- `tasks` is the operational source of truth; Telegram messages are never treated as task records.
- A task cannot be created without one active organization owner and a future deadline. Acceptance criteria are optional.
- Review is explicit per task: without review the assignee completes directly; with review the assignee submits and the requester (or platform leadership) alone can approve or return it. Self-review is rejected in the database.
- Leadership can define and reassign work. An assigned member can move only their own task and cannot rewrite its scope, owner, priority, or deadline.
- Status transitions are validated by `private.enforce_task_rules`, not by the browser. The UI mirrors the same transition map for guidance only.
- Every task change creates an immutable `task_events` record and a leadership-visible `audit_events` record.
- The first organization is created atomically by an authenticated Edge Function. Its database command is `SECURITY INVOKER` and executable by `service_role` only.
- The browser groups backlog, ready, and in-progress work into one human-facing lane named “شغل مطلوب تنفيذه”. Once work starts it never offers a backwards move to ready; a reviewer returns requested changes directly to in-progress. The database keeps the exact states because dependency unlocking, timestamps, optional reviews, and audits still require them.
- Current work is the default view. Completed and cancelled tasks are retained as history behind explicit filters instead of crowding the operational board.

## Team operations contract

- Every operational route is wrapped by an invite-only application gate. Before an active membership is loaded, the browser renders only the login or invitation surface and does not mount the sidebar, notifications, presence, or page workspace.
- The owner membership always receives every canonical section. Other roles carry an explicit `allowed_sections` list; the same list filters navigation, blocks deep links, scopes presence, and is enforced by restrictive RLS policies for direct Data API requests.
- The public login form never calls Supabase Auth directly. A public Edge Function returns the same response for known and unknown emails, sends a magic link only to an active member or an exact valid invitation, and never creates a user outside the invitation flow.
- A Supabase Before User Created hook is the final signup allowlist: only the fixed owner email or an unexpired pending invitation can create an Auth user. The hook and login resolver are not executable by browser roles.
- Publishing uses legacy trusted database commands, so every publishing table also has an independent write trigger that requires the caller's `publishing` section. This prevents a hidden-section member from bypassing RLS through an RPC.
- `notifications` contains recipient-scoped, deduplicated in-app events for assignment, dependency unlock, review, blocking, completion, and revision requests. Authenticated clients can read only their own rows and can change only their own read state.
- A database Cron job materializes due-soon, overdue, and 24-hour leadership-escalation events every ten minutes. Dedupe keys make each deadline window idempotent, and the job performs no external network call.
- Deadline reminders stay disabled for a one-member workspace. They begin only after a second active member exists, which prevents personal test tasks from being mistaken for real team alerts.
- `member_presence` stores only the current product section, session start, and a one-minute heartbeat. A write guard fixes identity and timestamps server-side. The system does not store clicks, keystrokes, document contents, or a covert page-by-page history.
- Leadership can request a report for up to 366 days. Counts come from canonical tasks, task events, and revision records: requested, assigned, completed, on-time, late, overdue, review submissions, and revisions.
- The report deliberately has no productivity score or employee ranking. Different roles are not reduced to a single misleading number, and the presence panel is not evidence of work quality.

## Quarterly content-planning contract

- `content_plans` owns the period, commercial objective, audience, offer, and primary metric. Only one plan can be active for an organization at a time.
- `content_plan_pillars` expresses the few recurring content themes and target quantities; it is planning input, not evidence of production.
- `content_plan_items` is the dated calendar. Every item has a title, format, publish time, and one canonical request containing the instructions and inline links; assignment metadata remains optional.
- Leadership explicitly chooses between **calendar only** (no task or notification) and **send to execution**. The latter creates the same canonical `content_items` request and compact task graph as direct intake, so planning is not a second production workflow.
- Once linked, database triggers derive the calendar state from the content source of truth. Published or cancelled history is retained rather than deleted.
- The leadership dashboard reads live domain tables and the `get_workspace_readiness` RPC. Readiness checks are explainable links to their source sections, not a self-reported percentage.

## Content production contract

- `content_items` is the source of truth for a publishable asset and its brief.
- A reel workflow is created atomically through the JWT-protected `create-content-workflow` Edge Function; its database command is executable by `service_role` only, so partial task sets cannot be saved.
- `intake_request` preserves one canonical, manager-authored request containing every instruction and inline link. Legacy structured fields remain available for compatibility and internal AI use, but they are no longer a parallel manager-facing workflow.
- Telegram remains the raw-file location in this phase. The optional direct Telegram message/file link is retained separately, while links inside the canonical request stay in place and render as clickable links.
- Each simplified workflow creates only real execution work: recording/raw-material delivery when needed, editing, thumbnail, and publishing. Thumbnail is immediately actionable; editing waits only when raw material has not already been sent. Caption is an internal content deliverable rather than a second counted task, and no mandatory approval task is added.
- A campaign social-post line is one counted launch deliverable but expands atomically into one content card per planned post. Each card has six tasks: brief, caption and design in parallel, approval, scheduling, and publishing. This avoids asking managers to enter separate design and publishing lines for the same post.
- `content_step_deliveries` is the governed result record for caption, design, scheduling, and publishing. A task cannot enter review without its result; design and publishing require a real URL. The table is read-only to authenticated clients and mutations use service-only commands.
- `task_dependencies` models the handoff graph. Completing a predecessor unlocks only downstream tasks whose dependencies are all done.
- A reel has only the work the team can act on: raw handoff when needed, editing, thumbnail, and publishing. The caption is stored on the reel rather than becoming a hidden fifth task; the creator can add it with the raw handoff and the publisher must complete it in the same form before confirming the live post. Publishing still waits only for editing and thumbnail, while review remains optional per task instead of becoming an owner bottleneck.
- Content status is derived by database triggers from linked task state, and important changes are written to the audit log.
- External social publishing remains manual until a verified platform integration returns a real publish confirmation.

## Campaign launch contract

- `launches` is the strategic source of truth for the objective, audience, offer, CTA, schedule, and measurable targets.
- A launch is created atomically through the JWT-protected `launch-commands` Edge Function; the database command is executable by `service_role` only.
- Each launch produces eight normal tasks: strategy, offer, registration, delivery, promotion, tracking, Go / No-Go, and launch-day operation.
- `launch_documents` is the versioned home for each gate's real output. Strategy, offer, promotion plan, tracking plan, Go / No-Go decision, and launch report stay inside the launch with a summary, status, author, and optional Drive/document URL. A gate cannot be completed without a submitted output.
- `launch_deliverables` converts the strategy into quantified execution lines such as reels, stories, designs, Telegram posts, emails, ads, landing pages, and webinar assets. Every line records quantity, brief, channel/destination, owner, deadline, budget category, amount, currency, and delivery evidence.
- Creating a legacy deliverable creates one canonical task. A social-post deliverable instead keeps one canonical parent for campaign counting and approval, generates individual content cards, and makes the parent depend on every publishing task. Deliverable dependencies are mirrored into the shared task dependency graph, so downstream work stays in backlog until its predecessors are complete; a result must be saved inside the launch before the parent can enter review.
- The shared task dependency engine unlocks gates only after every predecessor is done. Launch status is derived by database triggers from those tasks and cannot drift through a separate browser control.
- Content association is many-to-many and tenant-safe through composite foreign keys. Attach and detach commands are reversible, leadership-only, and audited; neither operation deletes the launch or content item.
- Targets are plan data. Actual performance stays unavailable until a verified ingestion or approved manual observation workflow is implemented.

## CRM contract

- `crm_contacts` is the governed lead record; `crm_identities` stores and deduplicates up to one phone, one email, and one Telegram username per lead inside one organization, with exactly one marked primary. A structured source and registration reason remain available for reporting, while `source_detail` and `interest_detail` capture new custom values without changing the schema for every campaign.
- `crm_conversation_links` stores direct Telegram, WhatsApp, Instagram, Facebook, Messenger, or other chat URLs separately from contact identity. This keeps deduplication stable while allowing one-click access to the exact conversation.
- A lead is created atomically through the JWT-protected `crm-commands` Edge Function. The database commands are executable by `service_role` only, so the browser cannot write contact, identity, conversation-link, or activity tables directly.
- Leadership can see the organization pipeline. A working member can see and act only on leads they own. The same ownership rule protects identities, conversation links, and immutable activity history through RLS.
- Every active lead has exactly one open, ordinary task linked by `crm_contact_id`. The task contains no customer name or contact value, so the shared task board does not leak CRM details.
- CRM discovery is server-side and paginated. The RLS-aware search covers names, notes, custom acquisition context, every identity, direct conversation URLs/labels, and activity summaries without downloading the full customer database into the browser.
- Leadership performance views report recorded evidence only: active and overdue leads, wins, activities, completed follow-ups, on-time follow-ups, and last activity. They deliberately do not assign subjective labels to people.
- CRM task status is controlled only by the CRM command. Recording a result closes the current task and either creates the next future follow-up or closes the lead with a reason.
- Selecting `do_not_contact` records denied consent and prevents another follow-up. No message, import, or external synchronization is active in this foundation.

## Brand knowledge contract

- `brand_articles` is the governed source for identity, visual, editing, copy, publishing, compliance, product, and workflow rules. Leadership creates drafts; only the organization owner can approve or archive them.
- An approved body is immutable. A change starts a new numbered draft while the current approved version stays active; approving the revision archives the previous version without deleting history.
- The browser has read-only table access through RLS. Every mutation goes through the JWT-protected `brand-commands` Edge Function and service-only database commands, with an audit event for each privileged change.
- `content_brand_references` records the exact approved version used when a content workflow is created. Archived versions remain readable for content already linked to them, while new briefs can select only currently approved versions.
- Item-specific brand notes are exceptions or clarifications, not a replacement for the approved knowledge center. The content command validates and links up to eight approved references atomically with the canonical request and its execution steps.

## Initial domains

1. Identity, organizations, memberships, roles, one-time email-bound claim links, onboarding acknowledgements, and safe suspension — foundation live; real team rollout pending owner approval.
2. Tasks, transitions, ownership, deadlines, optional acceptance criteria/review, Realtime, and activity — foundation live.
3. Content assets, briefs, dependency-based production stages, and manual publish confirmation — foundation live; external publishing and metrics pending.
4. Campaigns, launches, assets, readiness gates, and Go / No-Go — foundation live; external performance ingestion pending.
5. People, leads, customers, sources, consent, pipeline, and accountable follow-up tasks — foundation ready for personal testing; imports and messages pending.
6. Versioned brand knowledge, approval, audience visibility, and exact content references — foundation ready for personal testing; real brand content pending.
7. Metric definitions, observations, targets, experiments, and decisions.
