# Content request presentation — 2026-09-15

Approved scope: simplify the list and document without replacing the production workflow.

- `/content` uses compact rows, composable search/current-step filters, and 15-item pages on desktop and mobile.
- `/content?content=<uuid>` and `/tasks/content/<uuid>` share the same `ContentRequestView`; the latter returns to My Work.
- The full saved `intake_request` is the primary document, including timestamps, inline URLs and script text. Legacy requests fall back to existing brief fields. No saved text is rewritten to create the display.
- Raw files and the newest submitted delivery per task are prominent links at the top. All earlier versions remain available in the collapsed history. An absent delivery is not described as completed.
- Separate designer instructions, legacy mandatory timed cues, and history remain available on demand. Task execution and delivery still use the existing task routes and server commands.
- Brand libraries/references and AI suggestion panels are removed from this request surface. Their database records, authorization and unrelated Brand/Script features are not deleted or modified.
- `EmojiTextarea` inserts searchable emojis, arrows and symbols at the selection, preserves keyboard focus and respects the text-length limit. Used by creation, request editing and revision instructions.
- RLS, organization membership, ownership checks, workflow transitions, notification contracts, idempotent creation keys and optimistic version checks remain authoritative. No schema or Edge Function deployment is part of this change.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test`.
The new `content-presentation.test.mjs` renders the actual components with isolated records and checks progress, safe links, full text, permissions, pagination and version choice.

For non-production interaction QA:
`pnpm exec vite --config tests/content-preview.config.mjs`, then open
`http://127.0.0.1:4175/tests/content-preview.html`.
This explicitly labelled fixture has no database command implementation and is not an application route or published build entry.
Test search, current-step filter, pagination, edit/save/cancel, emoji caret insertion, and widths 320/390/desktop.
The fixture configuration replaces the schedule advisor's backend with an empty local response. It never reads a real calendar, creates tasks, or sends notifications.

Deployment acceptance also requires opening a real request and its task link on the published site. Local presentation tests do not prove end-to-end team permission coverage or provider email/Telegram delivery.
