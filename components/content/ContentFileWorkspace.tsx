"use client";

import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ExternalLink, FileText, Film, LoaderCircle, PackageCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { contentAssetKindConfig, contentStatusConfig, contentStepConfig } from "../../lib/content";
import { formatDateTime, formatDeadlineDistance } from "../../lib/date-time";
import { taskDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { taskStatusConfig, taskStatusLabel } from "../../lib/tasks";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type ContentItem = Tables<"content_items">;
type Task = Tables<"tasks">;
type ContentAsset = Tables<"content_assets">;
type ContentStepDelivery = Tables<"content_step_deliveries">;
type Membership = Tables<"memberships">;
type Person = { id: string; name: string };
type Workspace = {
  membership: Membership;
  item: ContentItem;
  tasks: Task[];
  assets: ContentAsset[];
  deliveries: ContentStepDelivery[];
  people: Person[];
};

function LinkifiedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part} <ExternalLink size={11} /></a>
    : part)}</>;
}

export function ContentFileWorkspace({ contentId }: { contentId: string }) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(configured ? null : "اتصال تسجيل الدخول غير متاح مؤقتًا.");

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const loadWorkspace = useCallback(async (session: Session) => {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", session.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("هذا الحساب غير مضاف للفريق.");
      const [itemResult, tasksResult, assetsResult, deliveriesResult] = await Promise.all([
        supabase.from("content_items").select("*").eq("id", contentId).eq("organization_id", membership.organization_id).maybeSingle(),
        supabase.from("tasks").select("*").eq("content_item_id", contentId).eq("organization_id", membership.organization_id),
        supabase.from("content_assets").select("*").eq("content_item_id", contentId).eq("organization_id", membership.organization_id).order("created_at"),
        supabase.from("content_step_deliveries").select("*").eq("content_item_id", contentId).eq("organization_id", membership.organization_id).order("submitted_at", { ascending: false }),
      ]);
      if (itemResult.error) throw itemResult.error;
      if (tasksResult.error) throw tasksResult.error;
      if (assetsResult.error) throw assetsResult.error;
      if (deliveriesResult.error) throw deliveriesResult.error;
      if (!itemResult.data) throw new Error("ملف المحتوى غير موجود أو ليس ضمن صلاحيات حسابك.");
      const tasks = tasksResult.data ?? [];
      const profileIds = [...new Set([itemResult.data.created_by, ...tasks.flatMap((task) => [task.owner_id, task.created_by]), ...(deliveriesResult.data ?? []).map((delivery) => delivery.submitted_by)])];
      const profilesResult = profileIds.length ? await supabase.from("profiles").select("id, full_name").in("id", profileIds) : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      setWorkspace({
        membership,
        item: itemResult.data,
        tasks,
        assets: assetsResult.data ?? [],
        deliveries: deliveriesResult.data ?? [],
        people: (profilesResult.data ?? []).map((profile) => ({ id: profile.id, name: profile.full_name ?? "عضو فريق" })),
      });
      setError(null);
    } catch (loadError) {
      setWorkspace(null);
      setError(loadError instanceof Error ? loadError.message : "تعذّر فتح ملف المحتوى.");
    } finally {
      setLoading(false);
    }
  }, [contentId]);
  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState: () => setError(null) });

  const peopleById = useMemo(() => new Map(workspace?.people.map((person) => [person.id, person]) ?? []), [workspace?.people]);

  if (loading) return <section className="panel empty-state"><LoaderCircle className="spin" size={20} /><div><h2>جارٍ فتح ملف المحتوى</h2><p>نرتّب الطلب والمراحل والتسليمات في شاشة واحدة.</p></div></section>;
  if (!session || !workspace) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>تعذّر فتح ملف المحتوى</h2><p>{error ?? "سجّل الدخول بحساب عضو مشارك في هذا الطلب."}</p></div><Button href="/tasks" variant="secondary">العودة لمهامي</Button></section>;

  const { item } = workspace;
  const sortedTasks = [...workspace.tasks].filter((task) => task.is_work_item).sort((left, right) => {
    const leftOrder = left.content_step ? contentStepConfig[left.content_step].order : 99;
    const rightOrder = right.content_step ? contentStepConfig[right.content_step].order : 99;
    return leftOrder - rightOrder;
  });
  const completed = sortedTasks.filter((task) => task.status === "done").length;
  const progress = sortedTasks.length ? Math.round((completed / sortedTasks.length) * 100) : 0;
  const requester = peopleById.get(item.created_by)?.name ?? "طالب المحتوى";
  const requestText = item.intake_request?.trim() || item.goal.trim() || "لا يوجد شرح إضافي.";
  const deadline = formatDeadlineDistance(item.publish_at);

  return <section className="content-file-workspace">
    <div className="task-detail-toolbar"><Button href="/tasks" variant="ghost"><ArrowRight size={15} /> العودة لمهامي</Button></div>
    <header className="panel content-file-header">
      <div><span className="workflow-task-label"><Film size={13} /> ملف محتوى</span><h1>{item.title}</h1><p>طلبه {requester} · النشر <bdi dir="ltr">{formatDateTime(item.publish_at)}</bdi></p></div>
      <div><StatusBadge tone={contentStatusConfig[item.status].tone}>{contentStatusConfig[item.status].label}</StatusBadge><span className={deadline.overdue ? "deadline-countdown overdue" : "deadline-countdown"}><CalendarClock size={13} /> {deadline.label}</span></div>
    </header>

    <section className="panel content-file-request">
      <header><div><p className="overline">الطلب الأساسي</p><h2>كل المطلوب والروابط</h2></div><FileText size={19} /></header>
      <p><LinkifiedText text={requestText} /></p>
      {item.intake_source_url ? <a className="task-original-source" href={item.intake_source_url} target="_blank" rel="noreferrer">فتح المصدر الأصلي <ExternalLink size={12} /></a> : null}
    </section>

    <section className="panel content-file-flow">
      <header><div><p className="overline">مسار التنفيذ</p><h2>{completed} من {sortedTasks.length} مراحل مكتملة</h2></div><strong>{progress}%</strong></header>
      <span className="content-workflow-progress-track" role="progressbar" aria-label="نسبة تقدم ملف المحتوى" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
      <ol>{sortedTasks.map((task, index) => {
        const isMine = task.owner_id === session.user.id;
        const owner = peopleById.get(task.owner_id)?.name ?? "عضو فريق";
        const delivery = workspace.deliveries.find((itemDelivery) => itemDelivery.task_id === task.id);
        return <li key={task.id} data-mine={isMine || undefined} data-complete={task.status === "done" || undefined}>
          <span>{task.status === "done" ? <CheckCircle2 size={17} /> : index + 1}</span>
          <div><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><small>{owner} · <bdi dir="ltr">{formatDateTime(task.due_at)}</bdi></small></div>
          <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
          {isMine || task.created_by === session.user.id || ["owner", "admin", "manager"].includes(workspace.membership.role) ? <a href={taskDeepLink(task.id)}>{isMine && !["done", "cancelled"].includes(task.status) ? "فتح مرحلتي" : "عرض المرحلة"}</a> : null}
          {delivery?.result_url ? <a href={delivery.result_url} target="_blank" rel="noreferrer">فتح التسليم <ExternalLink size={12} /></a> : null}
        </li>;
      })}</ol>
    </section>

    {workspace.assets.length || workspace.deliveries.length ? <details className="panel content-file-history">
      <summary><PackageCheck size={16} /> الملفات والتسليمات ({workspace.assets.length + workspace.deliveries.length})</summary>
      <div>{workspace.assets.map((asset) => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer"><strong>{asset.title}</strong><small>{contentAssetKindConfig[asset.kind].label}</small><ExternalLink size={13} /></a>)}{workspace.deliveries.filter((delivery) => delivery.result_url).map((delivery) => <a key={delivery.id} href={delivery.result_url!} target="_blank" rel="noreferrer"><strong>تسليم {contentStepConfig[delivery.step].label}</strong><small>{formatDateTime(delivery.submitted_at)}</small><ExternalLink size={13} /></a>)}</div>
    </details> : null}
  </section>;
}
