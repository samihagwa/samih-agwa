import { contentStepConfig } from "./content";
import type { Tables } from "./supabase/database.types";

type Item = Tables<"content_items">;
type Task = Tables<"tasks">;
type Delivery = Tables<"content_step_deliveries">;

// Both entry points share the existing work-item completion contract.
export function contentProgress(tasks: Task[], status: Item["status"]) {
  const work = tasks.filter((task) => task.is_work_item).sort((a, b) =>
    (a.content_step ? contentStepConfig[a.content_step].order : 99) - (b.content_step ? contentStepConfig[b.content_step].order : 99));
  const done = work.filter((task) => task.status === "done").length;
  const active = work.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
  return { work, done, total: work.length, percent: work.length ? Math.round(done / work.length * 100) : 0,
    current: active.map((task) => task.content_step ? contentStepConfig[task.content_step].label : task.title).join(" + ")
      || (status === "published" ? "منشور" : status === "cancelled" ? "مؤرشف" : "لا توجد خطوة نشطة") };
}

export function contentRequestText(item: Item) {
  if (item.intake_request?.trim()) return item.intake_request;
  return [item.goal, item.hook, item.cta, item.script_outline, item.editing_brief, item.thumbnail_brief, item.copy_brief, item.design_brief]
    .filter((text, index, all) => text?.trim() && all.indexOf(text) === index).join("\n\n");
}

export function latestDeliveries(deliveries: Delivery[]) {
  const latest = new Map<string, Delivery>();
  for (const delivery of [...deliveries].sort((a, b) => b.version - a.version || Date.parse(b.submitted_at) - Date.parse(a.submitted_at))) {
    if (!latest.has(delivery.task_id)) latest.set(delivery.task_id, delivery);
  }
  return latest;
}

export function safeWebLink(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function filterContent(items: Item[], view: string, search: string, stage: string, tasks: Map<string, Task[]>) {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const matchesView = view === "archive" ? ["published", "cancelled"].includes(item.status)
      : view === "scheduled" ? item.status === "scheduled" : !["published", "cancelled"].includes(item.status);
    return matchesView && (!query || [item.title, contentRequestText(item)].join(" ").toLocaleLowerCase().includes(query))
      && (!stage || contentProgress(tasks.get(item.id) ?? [], item.status).work.some((task) => task.content_step === stage && ["ready", "in_progress", "review", "blocked"].includes(task.status)));
  });
}
