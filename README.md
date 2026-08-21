# Market Whales OS

A private, web-first operating system for Market Whales. The interface uses React and TypeScript; the backend is designed for Supabase.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

This starter does not use `wrangler.jsonc`.

## Repository shape

- `app/`: routes and RTL application styles
- `components/ui`: canonical shared interface primitives
- `components/layout`: canonical navigation and shell
- `lib/`: shared domain configuration and Supabase client boundary
- `supabase/`: migrations and server functions after project creation
- `docs/`: architecture and decisions
- `.agents/skills/market-whales-os`: repository-specific operating rules for Codex

## Important status

The identity, owner-controlled team onboarding, task-management, reel-production, campaign-launch, manual CRM, and brand-knowledge foundations are ready for controlled testing. No real team invitation has been sent, no production customers have been imported, and no sales message or external analytics integration is active.

## First owner setup

1. Open `/tasks` on the deployed site.
2. Request a one-time sign-in link using the owner's email.
3. After the verified session returns, choose **Create Market Whales workspace** once.
4. During personal testing, create only clearly labeled test tasks and reel workflows. Team invitations are created manually from `/team` and never sent automatically.

The bootstrap endpoint is authenticated and can create only the first organization. The team flow creates a one-time claim link bound to a specific email; it never sends email or a Telegram message. The member must authenticate with that same email and explicitly accept. Suspending access is blocked while the member owns open tasks, scripts, or leads.

## Controlled team onboarding test

1. Keep the hosted site private while testing. Sign in as the owner and open `/team`.
2. Use an email account you control, choose the least-privileged role, and select **Create link only**. Nothing is sent.
3. Copy the one-time link and open it in a private browser window. Request the magic link using the exact invited email, then explicitly activate the membership.
4. Complete the three onboarding acknowledgements, confirm **My tasks** shows only accountable work, and submit one clearly labeled test result.
5. Back in the owner account, verify presence, notifications, the activity report, role changes, and that suspension is refused until open work is reassigned or closed.

Do not share a link with a real team member until the hosted-site access policy and the Supabase Auth redirect allowlist have been reviewed for the final domain.

## Personal brand test

1. Open `/brand` and create a clearly identified real draft such as **Who we are and the message** or **Editing rules**. A draft is private to leadership and does not affect current work.
2. Review the title, intended departments, required and prohibited rules, examples, references, and change reason. Only the owner can select **Final approval**.
3. Open `/content` and create a manual or Telegram-reviewed reel. Select one or more approved brand references; the exact numbered versions are linked to the brief and visible to execution owners.
4. To change an approved rule, create a revision instead of editing it. The current version stays active until the new draft is approved; old content keeps its original reference even after that version is archived.

No sample rules are seeded. Add only real brand decisions you are ready to use.

## AI provider setup

1. Sign in as the workspace owner and open `/settings`.
2. Choose a ready preset for DeepSeek V4 Flash, DeepSeek V4 Pro, or OpenAI; alternatively choose **Custom API** for any HTTPS provider that supports OpenAI Chat Completions or Responses with Bearer authentication.
3. Paste the provider key once. It is encrypted in Supabase Vault and is never returned to the browser; the public metadata keeps only a short key hint.
4. Select **Test connection**. When it succeeds, make that provider the default.
5. Open an editable script and use the AI actions. The script service resolves the current organization default at request time, so changing providers does not require a frontend deployment.

Only an active organization owner can list or mutate provider settings. Team members can use the selected default for their own scripts but cannot see provider configuration or credentials. Private, local, credential-bearing, query-string, and non-HTTPS base URLs are rejected. Custom proprietary API shapes require a dedicated server-side adapter rather than exposing arbitrary headers in the browser.

## Personal content test

1. Sign in and create the owner workspace from `/tasks`.
2. Open `/content`. Choose **Full request from Telegram** to paste an existing production request and review the extracted brief, timeline, links, and owners; or choose **Manual entry** to use the original form unchanged.
3. Complete the review and publish date. Nothing from a pasted request is saved until **Approve and create production workflow** is selected. The owner account is assigned to all seven steps by default.
4. Move linked tasks through the allowed states on `/tasks`. Completing a dependency unlocks the next eligible task automatically.
5. The final publishing task is a manual confirmation until a verified Meta/platform integration is added.

Telegram remains the raw-material inbox for now: paste the direct message/file link with the request. Direct uploads are deliberately deferred to the private Storage phase documented in `docs/roadmap.md`.

## Personal launch test

1. Sign in with the owner account and open `/campaigns`.
2. Create a launch with a real brief, future start/end, and at least one measurable target. The owner can remain assigned to all eight gates during personal testing.
3. Inside the launch, save the strategy as the **strategy gate output** with its summary and optional Drive link. The strategy task cannot be completed without this evidence.
4. Add two execution lines, such as a reel batch and thumbnail/design batch. Give each a quantity, owner, deadline, destination, and budget; make the second depend on the first and confirm both tasks appear in `/tasks`.
5. Start the first execution task, return to the launch, submit its result note or URL, and confirm it moves to review. Complete it to verify the dependent task unlocks.
6. Move launch gates through the task board. Completing a gate unlocks only the next eligible gates; Go / No-Go remains locked until registration, delivery, promotion, and tracking are complete.
7. Create content in `/content`, then attach it to the launch from the launch card. Removing the link never deletes either record.
8. Target values are planning data. Actual registrations, revenue, and social results remain visibly unavailable until a verified source is connected.

## Personal CRM test

1. Sign in with the owner account and open `/crm`.
2. Create one test lead with both phone and email, then verify both appear on the card and either value finds the same lead through search.
3. Filter by owner and stage, open the owner performance panel, and confirm totals change only from recorded CRM work.
4. Add an optional direct Telegram, WhatsApp, Instagram, Facebook, Messenger, or other chat link. The contact record, immutable first activity, chat link, identities, and one linked task are created atomically.
5. Open `/tasks` and confirm the generic CRM follow-up task appears without the person's name or contact details.
6. Return to the linked CRM record, confirm that **فتح شات** opens the correct external conversation, and log a call, message, email, or note. An active stage requires a future follow-up and creates exactly one next task.
7. Choose a closed stage to stop follow-up. `do_not_contact` also records denied consent. No action in this test sends a message or imports external customers.
