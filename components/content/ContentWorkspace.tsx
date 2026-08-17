"use client";

import type { Session } from "@supabase/supabase-js";
import {
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Film,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  contentStatusConfig,
  contentStepConfig,
  contentSteps,
  type ContentStep,
} from "../../lib/content";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type ContentItem = Tables<"content_items">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = {
  id: string;
  name: string;
  role: Membership["role"];
};

type Workspace = {
  organization: Organization;
  membership: Membership;
  people: TeamPerson[];
};

const assignmentFields: Array<{ step: ContentStep; name: string }> = [
  { step: "brief", name: "brief_owner_id" },
  { step: "recording", name: "recording_owner_id" },
  { step: "editing", name: "editing_owner_id" },
  { step: "thumbnail", name: "thumbnail_owner_id" },
  { step: "caption", name: "caption_owner_id" },
  { step: "approval", name: "approval_owner_id" },
  { step: "publishing", name: "publishing_owner_id" },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ContentWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultPublish] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));

  const refreshContent = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [{ data: contentRows, error: contentError }, { data: taskRows, error: tasksError }] = await Promise.all([
      supabase
        .from("content_items")
        .select("*")
        .eq("organization_id", organizationId)
        .order("publish_at", { ascending: true }),
      supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .not("content_item_id", "is", null)
        .order("due_at", { ascending: true }),
    ]);

    if (contentError) throw contentError;
    if (tasksError) throw tasksError;
    setItems(contentRows ?? []);
    setTasks(taskRows ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);

    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        setItems([]);
        setTasks([]);
        return;
      }

      const [{ data: organization, error: organizationError }, { data: memberRows, error: membersError }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active"),
      ]);

      if (organizationError) throw organizationError;
      if (membersError) throw membersError;

      const memberIds = (memberRows ?? []).map((member) => member.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const people = (memberRows ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name:
          profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));

      setWorkspace({ organization, membership, people });
      await refreshContent(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshContent]);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void loadWorkspace(data.session);
      else setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setNotice(null);
      if (nextSession) void loadWorkspace(nextSession);
      else {
        setWorkspace(null);
        setItems([]);
        setTasks([]);
        setLoading(false);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [configured, loadWorkspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshContent(workspace.organization.id);
    const contentChannel = supabase
      .channel(`content:${workspace.organization.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "content_items",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tasks",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(contentChannel);
    };
  }, [refreshContent, workspace]);

  const tasksByContent = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.content_item_id) continue;
      const current = grouped.get(task.content_item_id) ?? [];
      current.push(task);
      grouped.set(task.content_item_id, current);
    }
    return grouped;
  }, [tasks]);

  async function createWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const publishValue = String(form.get("publish_at") ?? "");
    const publishDate = new Date(publishValue);

    if (!publishValue || Number.isNaN(publishDate.getTime()) || publishDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      setError("موعد النشر يجب أن يكون بعد ساعة على الأقل من الآن.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);

    const { error: workflowError } = await getSupabaseBrowserClient().functions.invoke("create-content-workflow", {
      body: {
        target_organization_id: workspace.organization.id,
        content_title: String(form.get("title") ?? "").trim(),
        content_goal: String(form.get("goal") ?? "").trim(),
        content_hook: String(form.get("hook") ?? "").trim(),
        content_cta: String(form.get("cta") ?? "").trim(),
        target_publish_at: publishDate.toISOString(),
        brief_owner_id: String(form.get("brief_owner_id") ?? ""),
        recording_owner_id: String(form.get("recording_owner_id") ?? ""),
        editing_owner_id: String(form.get("editing_owner_id") ?? ""),
        thumbnail_owner_id: String(form.get("thumbnail_owner_id") ?? ""),
        caption_owner_id: String(form.get("caption_owner_id") ?? ""),
        approval_owner_id: String(form.get("approval_owner_id") ?? ""),
        publishing_owner_id: String(form.get("publishing_owner_id") ?? ""),
      },
    });

    setWorking(false);
    if (workflowError) {
      setError(workflowError.message);
      return;
    }

    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء أصل المحتوى و7 مهام مترابطة. أول مهمة فقط جاهزة الآن.");
    await refreshContent(workspace.organization.id);
  }

  if (loading) {
    return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مصنع المحتوى</h2><p>نجمع الأصول والمهام والصلاحيات من المصدر الحقيقي.</p></div></section>;
  }

  if (!session) {
    return (
      <section className="workspace-state workspace-onboarding">
        <LockKeyhole size={27} />
        <div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>نفس الجلسة والصلاحيات تعمل في كل أقسام النظام، ولا يوجد حساب منفصل لمصنع المحتوى.</p></div>
        <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
      </section>
    );
  }

  if (!workspace) {
    return (
      <section className="workspace-state workspace-onboarding">
        <Route size={27} />
        <div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لبناء أول خط إنتاج محتوى.</p></div>
        <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
      </section>
    );
  }

  const manager = canManageTasks(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));

  return (
    <section className="content-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>خط إنتاج الريلز</h2><p>{items.length ? `${items.length} أصل محتوى حقيقي` : "لا يوجد محتوى حقيقي بعد — أنشئ أول ريلز عند الجاهزية."}</p></div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" aria-label="تحديث المحتوى" onClick={() => void refreshContent(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> عرض كل المهام</Button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> ريلز جديد</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      {showCreate && manager ? (
        <form className="panel content-create-form" onSubmit={createWorkflow}>
          <div className="section-heading"><div><p className="overline">أصل واحد بدل رسائل متفرقة</p><h2>Content brief وخط التنفيذ</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
          <div className="form-grid">
            <label><span>عنوان الريلز</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: لماذا يخسر المتداول بعد صفقة ناجحة؟" /></label>
            <label><span>موعد النشر النهائي</span><input name="publish_at" type="datetime-local" defaultValue={defaultPublish} required /></label>
            <label className="full-field"><span>الهدف</span><textarea name="goal" minLength={5} maxLength={1000} rows={2} required placeholder="ما القرار أو الفهم الذي نريد من الجمهور الوصول إليه؟" /></label>
            <label className="full-field"><span>الـHook</span><textarea name="hook" minLength={3} maxLength={1000} rows={2} required placeholder="أول جملة توقف المشاهد" /></label>
            <label className="full-field"><span>الـCTA</span><textarea name="cta" minLength={2} maxLength={500} rows={2} required placeholder="مثال: سجّل في الويبنار من الرابط" /></label>
          </div>

          <div className="assignment-block">
            <div><p className="overline">المساءلة</p><h3>مسؤول واحد لكل خطوة</h3><p>في اختبارك الشخصي سيظهر حسابك في كل الخطوات. عند إضافة الفريق يمكن توزيعها هنا.</p></div>
            <div className="assignment-grid">
              {assignmentFields.map(({ step, name }) => (
                <label key={step}><span>{contentStepConfig[step].label}</span><select name={name} defaultValue={session.user.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
              ))}
            </div>
          </div>

          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء خط الإنتاج</Button><small>العملية ذرّية: إما يُنشأ الأصل و7 المهام معًا، أو لا يُحفظ شيء.</small></div>
        </form>
      ) : null}

      {items.length ? (
        <div className="content-list">
          {items.map((item) => {
            const itemTasks = [...(tasksByContent.get(item.id) ?? [])].sort((a, b) => {
              const aOrder = a.content_step ? contentStepConfig[a.content_step].order : 99;
              const bOrder = b.content_step ? contentStepConfig[b.content_step].order : 99;
              return aOrder - bOrder;
            });
            const doneCount = itemTasks.filter((task) => task.status === "done").length;
            const activeTasks = itemTasks.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
            const progress = itemTasks.length ? Math.round((doneCount / itemTasks.length) * 100) : 0;

            return (
              <article className="panel content-card" key={item.id}>
                <header>
                  <div className="content-card-title"><span className="icon-tile"><Film size={17} /></span><div><p className="overline">Reel · Instagram + Facebook</p><h3>{item.title}</h3></div></div>
                  <StatusBadge tone={contentStatusConfig[item.status].tone}>{contentStatusConfig[item.status].label}</StatusBadge>
                </header>

                <div className="content-brief-grid">
                  <div><small>الهدف</small><p>{item.goal}</p></div>
                  <div><small>الـHook</small><p>{item.hook}</p></div>
                  <div><small>الـCTA</small><p>{item.cta}</p></div>
                </div>

                <div className="content-progress-row">
                  <div><strong>{progress}%</strong><span>اكتمل {doneCount} من {itemTasks.length}</span></div>
                  <div className="content-progress-track" aria-label={`نسبة الإنجاز ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                  <div><CalendarClock size={14} /><span>النشر {formatDate(item.publish_at)}</span></div>
                </div>

                <ol className="content-steps" aria-label="خطوات إنتاج المحتوى">
                  {contentSteps.map((step) => {
                    const task = itemTasks.find((candidate) => candidate.content_step === step);
                    const isActive = activeTasks.some((activeTask) => activeTask.id === task?.id);
                    return (
                      <li className={`${task?.status === "done" ? "done" : ""} ${isActive ? "active" : ""}`} key={step}>
                        <span>{task?.status === "done" ? <CheckCircle2 size={14} /> : contentStepConfig[step].order}</span>
                        <strong>{contentStepConfig[step].label}</strong>
                        <small>{task ? peopleById.get(task.owner_id)?.name ?? "عضو فريق" : "—"}</small>
                      </li>
                    );
                  })}
                </ol>

                <footer>
                  <div>{activeTasks.length ? <><CircleUserRound size={15} /><span>النشط الآن: <strong>{activeTasks.map((task) => task.content_step ? contentStepConfig[task.content_step].label : task.title).join(" + ")}</strong></span></> : <><CheckCircle2 size={15} /><span>لا توجد خطوة نشطة الآن.</span></>}</div>
                  <Link className="text-link" href="/tasks">فتح المهمة <Link2 size={13} /></Link>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel empty-state">
          <span className="empty-visual"><Film size={20} /></span>
          <div><h2>مصنع المحتوى جاهز بدون بيانات وهمية</h2><p>عندما تنشئ أول ريلز سيظهر هنا ومعه كل المهام والمواعيد والاعتماديات.</p></div>
          <span className="empty-proof"><CheckCircle2 size={15} /> متصل ببورد المهام</span>
        </section>
      )}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>النشر الخارجي لم يُفعّل بعد</strong><p>مهمة النشر الآن تُغلق يدويًا بعد الجدولة الفعلية. ربط Meta وواجهات المنصات سيكون تكاملًا منفصلًا بصلاحيات محدودة، ولن ندّعي أن المحتوى نُشر قبل وصول تأكيد حقيقي.</p></div></aside>
    </section>
  );
}
