# Content request formats

The new-request control offers Reels, YouTube video, and Carousel without changing existing requests.

- Reels retain the existing direct intake workflow.
- YouTube uses one continuous brief, raw-material URL, editing and thumbnail tasks, then publishing.
- Carousel uses one continuous numbered-slide brief, optional reference URL, one design task, then publishing. Ahmed Shaban is selected from eligible members by name and can be changed. No member permissions are expanded.
- The designer supplies 2–30 distinct image URLs, individually numbered and reorderable. The ordered array is persisted with the delivery; the first image remains the compatibility result URL. These are linked images, not binary file uploads. Direct image URLs support previews; hosted file-page URLs can be opened separately.
- Submission checks the current assignee, task and delivery versions, and all prerequisites. Publishing unlocks only after design delivery. The legacy single-link endpoint cannot bypass the carousel image requirement.
- Database regression runs are transaction-scoped and rolled back, including generated tasks and notifications. Tests cover intake retry, ordering, stale updates, permission denial, and publishing dependency.
- Calendar completion is a separate manual marker, not actual publication or execution-task completion.

## Day-only intake fix (2026-09-21)

Carousel and YouTube intake interpret the selected day in Africa/Cairo, independent of device timezone. Today and future days are accepted; past or invalid days show an Arabic validation error. The private workflow normalizes the deadline to the end of that Cairo day before allocating dependent task deadlines. Existing records, Reel intake, publishing automation, authorization, and retry idempotency are unchanged. The Edge boundary maps date validation (22007) to HTTP 400.

Verification: timezone/DST/midnight unit tests; actual carousel and YouTube workflows exercised in rollback-only transactions, including today's elapsed midnight, past-day rejection, task deadlines, retry, delivery ordering and grants. No test tasks or notifications are committed. Ayman's own browser submission is not part of this automated verification.

Validation: lint, TypeScript, production build, 126 automated tests; service-role database rollback workflow; isolated browser intake/default-owner and image reorder checks. Production UI verification is reported separately from isolated tests.
