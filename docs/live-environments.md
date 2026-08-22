# Live environments

## Supabase foundation

| Field | Value |
| --- | --- |
| Project | Market Whales OS |
| Project ref | `xmnqwcevqahtoixvcdya` |
| Region | `eu-central-1` (Frankfurt) |
| API URL | `https://xmnqwcevqahtoixvcdya.supabase.co` |
| Local environment | `.env.local` (ignored by Git) |

Applied migrations:

1. `initial_foundation`: profiles, organizations, memberships, audit events, private authorization helpers, RLS, explicit grants, and indexes.
2. `add_foundation_fk_indexes`: covering indexes for foreign keys reported by the performance advisor.
3. `task_management`: real tasks, task activity, status and priority contracts, transition validation, RLS, Realtime, explicit column grants, and the service-only organization bootstrap command.
4. `task_created_by_default`: database-owned creator attribution for browser inserts.
5. `content_production_pipeline`: content briefs, seven-step reel workflows, task dependency graph, automatic handoffs, RLS, audit events, and Realtime content state.
6. `secure_content_workflow_command`: moves content creation behind a JWT-protected Edge Function and restricts the database command to `service_role`.
7. `campaign_launch_pipeline`: launches, eight readiness gates represented as tasks, shared dependency unlocking, derived launch status, content links, RLS, audit events, and Realtime state.
8. `campaign_launch_fk_indexes`: covering indexes for the launch composite foreign keys reported by the performance advisor.
9. `campaign_launch_detach_content`: reversible, leadership-only, audited content-link removal through a service-only database command.
10. `campaign_launch_positive_target`: requires at least one positive measurable target for every launch.
11. `content_production_briefs_and_revisions`: structured scripts, editing and thumbnail briefs, governed asset links, revision rounds, approval guards, RLS, and audited service-only commands.
12. `content_production_fk_indexes`: covering indexes for content asset and revision foreign keys.
13. `telegram_smart_content_intake`: optional reviewed Telegram request intake, original-message traceability, execution timeline cues, service-only mutations, RLS, Realtime, and approval guards for incomplete cues.
14. `crm_foundation`: tenant-safe lead, identity, consent, activity-history, and linked follow-up-task contracts with owner/leadership RLS and service-only commands.
15. `crm_task_priority_cast`: explicit enum-safe CRM task priorities discovered and verified by a rollback-only end-to-end contract test.
16. `crm_contact_context_and_chat_links`: custom acquisition sources and registration reasons, tenant-scoped direct conversation links, and an atomic service-only lead command.
17. `brand_knowledge_center`: versioned brand drafts and owner approval, immutable approved history, audience-aware RLS, exact approved references on content workflows, Realtime, audit events, and service-only mutations.
18. `brand_reference_fk_index`: covering index for the content/organization composite foreign key reported by the performance advisor.
19. `crm_search_multi_identity_owner_performance`: RLS-aware paginated search, trigram indexes, atomic multi-identity lead creation, controlled identity additions, and evidence-based owner performance metrics.
20. `launch_execution_plan`: versioned gate outputs, quantified/budgeted launch deliverables, canonical linked tasks, dependency mirroring, delivery evidence guards, RLS, audit events, and Realtime state.
21. `launch_execution_fk_indexes`: exact-order covering indexes for all new composite launch-execution foreign keys reported by the performance advisor.
22. `team_onboarding_and_access_control`: owner-only, email-bound one-time claim links, first-day acknowledgements, role/status management, safe suspension guards, RLS, and immutable audit evidence. Existing owner access was backfilled as complete and no invitation row was created.
23. Subsequent controlled foundations add compact task/content execution, notifications and presence, publishing safety, script AI/versioning, and production delivery contracts.
24. `team_readiness_reminders_and_planning` plus `content_planning_fk_indexes`: quarterly plans, pillars and calendar items with RLS/audit/history, content-state synchronization, a leadership-only readiness RPC, a deduplicated ten-minute deadline reminder job, complete presence-section validation, and full foreign-key index coverage for the new calendar plus the missing publishing media composite index. They create no plan, task, invitation, customer, or external message.
25. `invite_only_section_access`: owner-pinned access for `samihsmaih1234@gmail.com`, explicit per-member section lists on memberships and invitations, an Auth signup allowlist hook, service-only login resolver, audited role/section commands, and restrictive section RLS policies across the operational domains.
26. `section_scope_function_writes`: nine publishing-table write fences for legacy trusted RPCs plus section-scoped presence recording, closing direct-function bypasses for members without the corresponding section.

Deployed Edge Functions:

1. `bootstrap-organization` v1: JWT-protected, one-time owner workspace initialization. Unauthenticated requests return `401`.
2. `create-content-workflow` v4: JWT-protected, preserves both manual and reviewed Telegram intake, validates approved brand references, and creates the brief, exact reference links, timeline/assets when present, and seven dependent tasks atomically. Unauthenticated requests return `401`.
3. `launch-commands` v4: JWT-protected launch creation, audited content attach/detach, versioned gate-output saving, quantified deliverable/task creation, and controlled delivery submission. Unauthenticated requests return `401`.
4. `content-commands` v2: JWT-protected content brief, asset, revision, and timeline commands. Timeline completion is restricted to the assigned editor or organization leadership.
5. `crm-commands` v3: JWT-protected manual lead creation with one to three deduplicated contact methods, optional direct chat link and custom acquisition context, controlled identity additions, plus follow-up recording. It sends no message, performs no import, and rejects unauthenticated requests with `401`.
6. `brand-commands` v1: JWT-protected brand draft, edit, revision, owner approval, and archive commands. The browser has no direct table-write or database-command privilege.
7. `team-commands` v1: JWT-protected invitation-link creation/revocation, exact-email acceptance, member role/status changes, and onboarding acknowledgements. It sends no email, Telegram message, or external request.
8. `team-commands` v2: keeps the manual invitation-link flow and atomically stores each invited or existing member's selected dashboard sections with role/status changes.
9. `request-access-link` v1: public, enumeration-resistant login entrypoint. It sends a magic link only for an active member or an exact valid invitation and allows Auth user creation only for the invitation path.

Verification on 2026-08-17:

- Project status: `ACTIVE_HEALTHY`.
- Security advisor: no schema or RLS findings. A project-level warning remains for leaked-password protection; the current application uses passwordless one-time email links and does not expose password sign-in.
- RLS: enabled on all twenty-two public application tables.
- `anon`: no table read grant.
- `authenticated`: explicit reads, column-scoped task writes, and one validated workflow command; all access is filtered by RLS and database rules.
- Performance advisor: only unused-index informational notices, expected while the personally tested database has almost no operational volume.
- Security advisor: no findings after the task migrations.
- The organization bootstrap database command is not executable by `anon` or `authenticated`; only the trusted server role can call it.
- The content workflow database command is not executable by `anon` or `authenticated`; the authenticated browser calls the JWT-protected Edge Function instead.
- Telegram intake and timeline mutation commands are not executable by `anon` or `authenticated`; `authenticated` receives only organization-filtered timeline reads through RLS.
- Launch creation and content-link commands are not executable by `anon` or `authenticated`; the authenticated browser calls the JWT-protected Edge Function instead.
- Composite launch foreign keys have covering indexes; the performance advisor reports only unused-index informational notices expected for an empty database.
- CRM contact, identity, conversation-link, and activity tables remain empty after verification; the existing task count remains eight and no fake customer was persisted.
- `authenticated` has read-only table grants filtered by owner/leadership RLS and cannot execute the CRM mutation commands; only `service_role` can execute them through the JWT-protected Edge Function.
- Rollback-only database tests verified creation, custom source/reason storage, one primary conversation link, one-open-task enforcement, guarded task movement, follow-up rollover, and `do_not_contact` consent closure without leaving test data.
- Brand commands and content-reference wrappers are service-role only; authenticated users receive audience-aware, organization-filtered reads through RLS and no direct table writes.
- A rollback-only brand test verified draft creation, optimistic editing, owner approval, atomic content linking, revision history, previous-version archiving, and preserved exact content references without leaving test data.
- Team invitation and access commands are executable only by `service_role`; `anon` and direct authenticated RPC access are denied. The invitation table is owner-readable through RLS, contains only token hashes, and remained empty after deployment verification.

Additional verification on 2026-08-22:

- The planning migration was transaction-tested with rollback before being applied to the live project.
- Deadline materialization performs database-only, recipient-scoped inserts and stays silent while only the owner is active.
- The application shell withholds every operational route and the full sidebar until an active membership is verified; `/login` and the email-bound `/join` activation surface are the only public views.
- The owner email is an active `owner` with all twelve sections. Unknown-email login resolution returns no access, while the signup hook returns `403`; the owner's existing login resolves successfully.
- Nine publishing-table triggers fence legacy SECURITY DEFINER mutations by the caller's `publishing` section, and presence cannot be recorded for a hidden section.
- No invitation, Telegram send, customer import, or external analytics action was triggered by this release.

Never commit `.env.local`, secret keys, legacy service-role keys, or production customer data.
