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

The identity, task-management, reel-production, campaign-launch, manual CRM, and brand-knowledge foundations are ready for personal testing. The team has not been onboarded, no production customers have been imported, and no sales message, social publishing, or external analytics integration is active.

## First owner setup

1. Open `/tasks` on the deployed site.
2. Request a one-time sign-in link using the owner's email.
3. After the verified session returns, choose **Create Market Whales workspace** once.
4. During personal testing, do not enter team members. Create only clearly labeled test tasks and reel workflows.

The bootstrap endpoint is authenticated and can create only the first organization. No invitation flow is active and no invitation is sent during personal testing.

## Personal brand test

1. Open `/brand` and create a clearly identified real draft such as **Who we are and the message** or **Editing rules**. A draft is private to leadership and does not affect current work.
2. Review the title, intended departments, required and prohibited rules, examples, references, and change reason. Only the owner can select **Final approval**.
3. Open `/content` and create a manual or Telegram-reviewed reel. Select one or more approved brand references; the exact numbered versions are linked to the brief and visible to execution owners.
4. To change an approved rule, create a revision instead of editing it. The current version stays active until the new draft is approved; old content keeps its original reference even after that version is archived.

No sample rules are seeded. Add only real brand decisions you are ready to use.

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
