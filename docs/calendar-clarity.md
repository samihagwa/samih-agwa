# Content calendar interaction contract

- One card represents one content source on one Cairo calendar day. Platform filters apply before grouping. Different days remain separate; underlying platform records are preserved.
- Dragging/rescheduling a grouped card moves its visible platforms together through `move_content_calendar_group`. The database transaction delegates authorization, locks, optimistic revisions, and audit to the existing slot command. A stale sibling rolls back the entire move; undo restores each original timestamp. Execution tasks are unchanged.
- Details and date editing use centered dialogs without navigating into legacy plan administration. Unlinked plan drafts can edit title and brief in place with a version check and existing RLS/audit triggers.
- Completion marks mean published, not merely ready or scheduled. Publication remains the responsibility of the existing publishing workflow.
- The shared `DateInput` preserves native form names, values, validation, reset and FormData. Calendar planning is day-only; other workflows retain their existing time requirements. Date/range selection supports month/year navigation, keyboard arrows and reduced motion.
- Backup scheduling is not enabled by this change. A storage destination, retention policy and restore verification still need to be selected before building that workflow.

## Verification, 2026-09-17

- Lint, TypeScript, production build and all 123 tests pass, including primary-route/private-gate regressions.
- Database rollback suite passes after applying the invoker wrapper: group move/conflict/undo, task preservation, role/tenant checks and existing calendar cases. Test records roll back.
- Isolated Chrome checks: 390px centered dialogs/range selection, one card for same-day platforms, grouped reschedule/undo, in-place draft create/edit, viewer controls absent, native datetime FormData and reset.
- No real content, clients or task records were created or moved during fixture QA.
