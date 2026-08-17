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
- A task cannot be created without one active organization owner, a future deadline, and acceptance criteria.
- Leadership can define and reassign work. An assigned member can move only their own task and cannot rewrite its scope, owner, priority, or deadline.
- Status transitions are validated by `private.enforce_task_rules`, not by the browser. The UI mirrors the same transition map for guidance only.
- Every task change creates an immutable `task_events` record and a leadership-visible `audit_events` record.
- The first organization is created atomically by an authenticated Edge Function. Its database command is `SECURITY INVOKER` and executable by `service_role` only.

## Content production contract

- `content_items` is the source of truth for a publishable asset and its brief.
- A reel workflow is created atomically through the JWT-protected `create-content-workflow` Edge Function; its database command is executable by `service_role` only, so partial task sets cannot be saved.
- The original manual brief stays available. The optional Telegram intake accepts the full request as one draft, parses it in the browser, and requires an editable review before the same guarded command stores anything.
- Telegram remains the raw-file location in this phase. The approved request and direct Telegram message link are retained on the content item; extracted reference links and second-by-second instructions are stored as governed content assets and timeline cues.
- Each workflow produces seven normal tasks: brief, recording, editing, thumbnail, caption, approval, and publishing.
- `task_dependencies` models the handoff graph. Completing a predecessor unlocks only downstream tasks whose dependencies are all done.
- In the Telegram intake path, raw-material verification follows brief approval, editing follows verification, and thumbnail plus caption can run in parallel after the brief. Final approval waits for editing, thumbnail, caption, every open revision, and every timeline cue.
- Content status is derived by database triggers from linked task state, and important changes are written to the audit log.
- External social publishing remains manual until a verified platform integration returns a real publish confirmation.

## Campaign launch contract

- `launches` is the strategic source of truth for the objective, audience, offer, CTA, schedule, and measurable targets.
- A launch is created atomically through the JWT-protected `launch-commands` Edge Function; the database command is executable by `service_role` only.
- Each launch produces eight normal tasks: strategy, offer, registration, delivery, promotion, tracking, Go / No-Go, and launch-day operation.
- `launch_documents` is the versioned home for each gate's real output. Strategy, offer, promotion plan, tracking plan, Go / No-Go decision, and launch report stay inside the launch with a summary, status, author, and optional Drive/document URL. A gate cannot be completed without a submitted output.
- `launch_deliverables` converts the strategy into quantified execution lines such as reels, stories, designs, Telegram posts, emails, ads, landing pages, and webinar assets. Every line records quantity, brief, channel/destination, owner, deadline, budget category, amount, currency, and delivery evidence.
- Creating a deliverable also creates one canonical task. Deliverable dependencies are mirrored into the shared task dependency graph, so downstream work stays in backlog until its predecessors are complete; a result must be saved inside the launch before the task can enter review.
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
- Item-specific brand notes are exceptions or clarifications, not a replacement for the approved knowledge center. The content command validates and links up to eight approved references atomically with the brief and seven tasks.

## Initial domains

1. Identity, organizations, memberships, and roles — foundation live; team onboarding pending.
2. Tasks, transitions, ownership, deadlines, acceptance criteria, Realtime, and activity — foundation live.
3. Content assets, briefs, dependency-based production stages, and manual publish confirmation — foundation live; external publishing and metrics pending.
4. Campaigns, launches, assets, readiness gates, and Go / No-Go — foundation live; external performance ingestion pending.
5. People, leads, customers, sources, consent, pipeline, and accountable follow-up tasks — foundation ready for personal testing; imports and messages pending.
6. Versioned brand knowledge, approval, audience visibility, and exact content references — foundation ready for personal testing; real brand content pending.
7. Metric definitions, observations, targets, experiments, and decisions.
