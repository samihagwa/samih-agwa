# Cross-system change safety

## Impact scan

Before editing, search for:

- imports and usages of the changed component or hook;
- serialized status/action values in UI, SQL, bot handlers, jobs, and analytics;
- permissions and RLS policies that reference the affected role or operation;
- navigation, deep links, notifications, and automations that target the affected route;
- tests and fixtures that encode the old contract.

## Canonical ownership

| Concern | Canonical location |
| --- | --- |
| Colors, spacing, focus, radii | `app/globals.css` tokens |
| Buttons, badges, fields, tables | `components/ui` |
| Navigation and application shell | `components/layout` |
| Domain state and transition rules | database functions / trusted server code |
| Permissions | database roles, grants, and RLS migrations |
| Supabase client creation | `lib/supabase` |
| Cross-route content/config | `lib` domain modules |

Do not repair a shared defect independently on each page. Repair the canonical owner and add a regression assertion.

## Verification matrix

For shared UI or navigation changes, verify `/`, `/tasks`, `/content`, `/campaigns`, `/crm`, `/analytics`, `/team`, and `/settings`.

For schema, role, or state changes, verify:

- allowed and denied paths;
- create, select, update, and delete separately;
- ownership/team boundaries;
- audit output;
- retries and duplicate events;
- existing bot and analytics consumers.

For integrations, verify timeout, rate limit, duplicate delivery, invalid signature, expired token, and rollback behavior.
