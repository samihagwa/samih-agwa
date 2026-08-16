# Market Whales OS — Repository Rules

Use `.agents/skills/market-whales-os/SKILL.md` for every product, UI, database, integration, or workflow change in this repository.

## Product truth

- Treat the current Telegram bot tasks and any imported historical tasks as test data unless Samih explicitly confirms otherwise.
- Do not claim the team is onboarded. The operating system is still in its foundation phase.
- Keep this system independent from the existing Market Whales application until its programmer provides an approved integration contract.
- Use `samihagwa.com` or an approved subdomain for this product. Do not modify the existing public GitHub Pages repository without an explicit migration plan.

## Architecture invariants

- Use React and TypeScript with strict type checking.
- Use Supabase for Postgres, Auth, Storage, Realtime, and short Edge Functions.
- Keep Telegram delivery and other long-running integrations behind trusted server-side workers.
- Enable RLS on every exposed table. Never expose `service_role` or secret keys to a browser.
- Authorize with database-backed roles or trusted custom claims, never editable user metadata.
- Execute critical state transitions through database functions or trusted server functions; do not rely on UI-only validation.
- Record sensitive and workflow-changing operations in an immutable audit log.

## System-wide change safety

- Search all usages before changing a shared component, token, action, status, schema, or permission.
- Change shared behavior in its canonical primitive; do not copy a page-local variant.
- Keep shared UI in `components/ui`, shared layout in `components/layout`, and domain rules outside page components.
- When a change is intentionally local, document why it must not propagate.
- Update every affected route, test, contract, migration, and document in the same change.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` before calling a change complete.
- A passing page is not sufficient: verify all primary routes and shared navigation render after a shared change.

## Interface rules

- Design RTL-first and responsive from 320px upward.
- Use a restrained palette and never communicate status by color alone; pair color with text and a symbol.
- Maintain visible keyboard focus, semantic controls, sufficient contrast, reduced-motion support, and useful empty/error/loading states.
- Label sample data explicitly. Never manufacture operational metrics to make a dashboard look full.
- Prefer clarity and predictable interactions over decorative novelty.

## Security and data rules

- Store only public client configuration in browser-prefixed environment variables.
- Keep secrets in the hosting or Supabase secret store and rotate leaked credentials immediately.
- Apply least privilege, tenant/team scoping, ownership checks, and explicit `WITH CHECK` clauses.
- Treat uploads as untrusted: restrict bucket, MIME type, size, ownership, and signed URL lifetime.
- Do not connect production Meta, Telegram, Drive, payment, or customer data until the data owner, purpose, retention, and rollback path are documented.

## Change completion report

State which shared contracts changed, which routes were checked, which commands passed, and any live-system action still awaiting owner approval.
