import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("content requests stay grouped and compact across team and personal task views", async () => {
  const [board, detail, intake, css] = await Promise.all([
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/QuickIntakeForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(board, /const key = task\.content_item_id \? `content:\$\{task\.content_item_id\}` : `task:\$\{task\.id\}`/);
  assert.match(board, /if \(entry\.contentItemId\)/);
  assert.doesNotMatch(board, /if \(entry\.contentItemId && !personalView\)/);
  assert.match(board, /setFilter\("mine"\)/);
  assert.match(board, /type TaskSection = "today" \| "team" \| "schedule" \| "archive"/);
  assert.match(board, /const canOpenDetails = isAssignedToViewer \|\| isRequester \|\| platformAdmin/);
  assert.match(board, /const canRequestRevisionShortcut = !isAssignedToViewer[\s\S]*!readOnly[\s\S]*\(isRequester \|\| platformAdmin\)[\s\S]*contentStepsSupportingRevision\.has\(task\.content_step\)[\s\S]*\["review", "done"\]\.includes\(task\.status\)/);
  assert.match(board, /طلب محتوى ·/);
  assert.match(board, /طلب تعديل/);
  assert.match(board, /boardEntryCompletionTimestamp\(right\) - boardEntryCompletionTimestamp\(left\)/);
  assert.match(board, /function taskIsCompleted\(task: Task\) \{\s*return task\.status === "done";/);
  assert.match(board, /if \(filter === "completed"\) return task\.owner_id === currentUserId && taskIsCompleted\(task\)/);
  assert.match(board, /if \(filter === "completed"\) return tasks\.every\(taskIsCompleted\)/);
  assert.match(board, /sortTasks: personalView \? viewerTasks : orderedTasks/);
  assert.match(board, /entry\.sortTasks\.map\(taskCompletionTimestamp\)/);
  assert.match(board, /const completedTasks = entry\.tasks\.filter\(taskIsCompleted\)\.length/);
  assert.match(board, /const completed = taskIsCompleted\(task\)/);
  assert.match(board, /taskIsCompleted\(task\) \? "task-closed" : ""/);
  assert.doesNotMatch(board, /filter === "completed"[^\n]+taskIsClosed/);
  assert.doesNotMatch(board, /const completed = taskIsClosed\(task\)/);

  assert.match(css, /\.content-workflow-subtasks \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(145px, 1fr\)\)/);
  assert.match(css, /\.content-workflow-subtasks > section\.completed strong \{[^}]*text-decoration: line-through/);
  assert.match(css, /\.task-card\.task-closed h3 \{[^}]*text-decoration: line-through/);

  assert.match(intake, /تعليمات المونتاج — اختيارية/);
  assert.match(intake, /تعليمات الغلاف — اختيارية/);
  assert.match(intake, /buildContentRequest\(requestText, editingBrief, thumbnailBrief\)/);
  assert.match(intake, /MAX_CONTENT_REQUEST_LENGTH = 30_000/);
  assert.match(intake, /function withoutDuplicateHeadings/);
  assert.match(intake, /seen\.has\(heading\)/);
  assert.match(intake, /buildContentRequest\(requestText, editingBrief, thumbnailBrief\)\.length > MAX_CONTENT_REQUEST_LENGTH/);
  assert.match(intake, /setEditingBrief\(event\.target\.value\); setStepError\(null\)/);
  assert.match(intake, /setThumbnailBrief\(event\.target\.value\); setStepError\(null\)/);

  assert.match(detail, /instructionsForTask/);
  assert.match(detail, /roleSpecificInstructions/);
  assert.match(detail, /embeddedBrief && looksLikeLegacyRequestCopy/);
  assert.match(detail, /functions\.invoke\("content-commands"/);
  assert.match(detail, /action: "request_revision"/);
  assert.match(detail, /action: "update_content_caption"/);
  assert.match(detail, /caption: captionText/);
  assert.match(detail, /type CaptionDraft =/);
  assert.match(detail, /expected_content_version: captionDraft\.baseVersion/);
  assert.match(detail, /const captionDraftStale = Boolean/);
  assert.match(detail, /وصل إصدار أحدث أثناء كتابة الكابشن/);
  assert.match(detail, /value=\{captionDraftMatchesItem \? captionDraft\?\.value/);
  assert.match(detail, /useLatestCaption/);
  assert.match(detail, /rebaseCaptionDraft/);
  assert.match(detail, /from\("content_revision_requests"\)\.select\("\*"\)\.eq\("task_id", task\.id\)/);
  assert.match(detail, /table: "content_revision_requests", filter: `task_id=eq\.\$\{taskId\}`/);
  assert.match(detail, /const canRequestContentRevision = contentTask[\s\S]*\["review", "done"\]\.includes\(task\.status\)[\s\S]*\(isRequester \|\| platformAdmin\)/);
  assert.match(detail, /const canRequestRevision = canRequestContentRevision \|\| canRequestStandaloneRevision/);
  assert.match(detail, /const revisionTimeline = \[/);
  assert.match(detail, /سجل التعديلات/);
  assert.match(detail, /المطلوب منك/);
  assert.match(detail, /task-full-request/);
  assert.match(detail, /task-caption-block/);
  assert.match(detail, /thumbnail: \["brief", "recording", "thumbnail"\]/);
});

test("script work filters separate ready-to-publish and keep finished work out of the active queue", async () => {
  const workspace = await readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8");

  assert.match(workspace, /value: "ready_to_publish", label: "جاهز للنشر"/);
  assert.match(workspace, /linkedStep\(tasks, script, "publishing"\)\?\.status === "done"[\s\S]*\["ready", "in_progress", "review"\]\.includes\(linkedStep\(tasks, script, "publishing"\)\?\.status \?\? ""\)[\s\S]*linkedStep\(tasks, script, "recording"\)\?\.status === "done"/);
  assert.match(workspace, /if \(filter === "active"\) return !\["published", "archived"\]\.includes\(stage\)/);
  assert.match(workspace, /\["recorded", "ready_to_publish", "published"\]\.includes\(filter\.value\)/);
});

test("chosen cover instructions remain visible and reach the designer after refresh", async () => {
  const [content, css] = await Promise.all([
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(content, /الاختيار المعتمد: \$\{option\.label\}/);
  assert.match(content, /canUseThumbnailAi \|\| item\.thumbnail_brief\.trim\(\)/);
  assert.match(content, /تعليمات الغلاف المحفوظة/);
  assert.match(content, /LinkifiedText text=\{item\.thumbnail_brief\}/);
  assert.match(css, /\.content-ai-saved-choice/);
});

test("weekly team content is one request with role-specific dated work", async () => {
  const [workspace, form, migration, css] = await Promise.all([
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/WeeklyContentRoutineForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260905021652_recurring_team_content_workflows.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /WeeklyContentRoutineForm/);
  assert.match(workspace, /content_bundle_id \? `bundle:/);
  assert.match(workspace, /toggleRecurringTemplate\(group\.templates\)/);
  assert.match(workspace, /archiveRecurringTemplate\(group\.templates\)/);
  assert.match(form, /كل المطلوب والروابط — في مكان واحد/);
  assert.match(form, /const bundleId = crypto\.randomUUID\(\)/);
  assert.match(form, /step: "recording"[\s\S]*step: "editing"[\s\S]*step: "thumbnail"[\s\S]*step: "publishing"/);
  assert.match(form, /step: "caption"[\s\S]*step: "design"[\s\S]*step: "publishing"/);
  assert.match(form, /from\("recurring_task_templates"\)\.insert\(rows\)/);
  assert.match(migration, /recurring_content_occurrences_bundle_unique/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /new\.content_item_id := content_id/);
  assert.match(migration, /dependent\.content_step = 'editing' and prerequisite\.content_step = 'recording'/);
  assert.doesNotMatch(migration, /dependent\.content_step in \('editing', 'thumbnail'\)/);
  assert.match(migration, /dependent\.content_step = 'publishing'/);
  assert.match(css, /\.weekly-content-routine/);
});
