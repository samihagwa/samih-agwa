"use client";

import type { Session } from "@supabase/supabase-js";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentAssignmentFields, type ContentStep } from "../../lib/content";
import { currentUuidDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageAllTaskExecution, canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { ContentLibrary } from "./ContentLibrary";
import { ContentRequestView } from "./ContentRequestView";
import { QuickIntakeForm, type QuickIntakePayload } from "./QuickIntakeForm";

type Person = { id: string; name: string; role: Tables<"memberships">["role"]; allowedSections: string[] };
type Workspace = { membership: Tables<"memberships">; people: Person[] };
type Data = { selectedId: string | null; items: Tables<"content_items">[]; tasks: Tables<"tasks">[]; assets: Tables<"content_assets">[]; deliveries: Tables<"content_step_deliveries">[]; revisions: Tables<"content_revision_requests">[]; timeline: Tables<"content_timeline_cues">[] };
const emptyData: Data = { selectedId: null, items: [], tasks: [], assets: [], deliveries: [], revisions: [], timeline: [] };
function errorText(error: unknown) { return error && typeof error === "object" && "message" in error ? String(error.message) : "تعذّر تحميل الطلبات؛ حاول مرة أخرى."; }

// Fetch every RLS-visible page: UI pagination must not silently omit requests after the API row cap.
async function allRows<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await fetch(from, from + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

export function ContentWorkspace({ contentId, backHref = "/content" }: { contentId?: string; backHref?: string } = {}) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "اتصال الموقع غير متاح مؤقتًا.");
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState("active");
  const [deepId, setDeepId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const selectedId = contentId ?? deepId;
  const busy = useRef(false);
  const dataGeneration = useRef(0);
  const [defaultPublish] = useState(() => {
    const publish = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return new Date(publish.getTime() - publish.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });

  useEffect(() => {
    const syncLocation = () => {
      setDeepId(currentUuidDeepLink("content", "content"));
      setRevisionId(currentUuidDeepLink("revision", "revision"));
      if (new URLSearchParams(window.location.search).get("create") === "reel") setShowCreate(true);
    };
    const frame = requestAnimationFrame(syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("popstate", syncLocation); };
  }, []);
  const clearWorkspace = useCallback(() => { dataGeneration.current++; setWorkspace(null); setData(emptyData); }, []);
  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshContent = useCallback(async (organizationId: string, targetId: string | null = null) => {
    const generation = ++dataGeneration.current;
    const supabase = getSupabaseBrowserClient();
    const [items, tasks, assets, deliveries, revisions, timeline] = await Promise.all([
      allRows((from, to) => {
        let query = supabase.from("content_items").select("*").eq("organization_id", organizationId);
        if (targetId) query = query.eq("id", targetId);
        return query.order("publish_at").order("id").range(from, to);
      }),
      allRows((from, to) => {
        let query = supabase.from("tasks").select("*").eq("organization_id", organizationId).not("content_item_id", "is", null);
        if (targetId) query = query.eq("content_item_id", targetId);
        return query.order("due_at").order("id").range(from, to);
      }),
      targetId ? allRows((from, to) => supabase.from("content_assets").select("*").eq("organization_id", organizationId).eq("content_item_id", targetId).order("created_at", { ascending: false }).order("id").range(from, to)) : Promise.resolve([]),
      targetId ? allRows((from, to) => supabase.from("content_step_deliveries").select("*").eq("organization_id", organizationId).eq("content_item_id", targetId).order("submitted_at", { ascending: false }).order("id").range(from, to)) : Promise.resolve([]),
      targetId ? allRows((from, to) => supabase.from("content_revision_requests").select("*").eq("organization_id", organizationId).eq("content_item_id", targetId).order("round", { ascending: false }).order("id").range(from, to)) : Promise.resolve([]),
      targetId ? allRows((from, to) => supabase.from("content_timeline_cues").select("*").eq("organization_id", organizationId).eq("content_item_id", targetId).order("sort_order").order("id").range(from, to)) : Promise.resolve([]),
    ]);
    if (generation === dataGeneration.current) setData({ selectedId: targetId, items, tasks, assets, deliveries, revisions, timeline });
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true); setError(null);
    try {
      const membershipResult = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipResult.error) throw membershipResult.error;
      const membership = membershipResult.data;
      if (!membership) { clearWorkspace(); return; }
      const members = await supabase.from("memberships").select("user_id, role, allowed_sections").eq("organization_id", membership.organization_id).eq("status", "active");
      if (members.error) throw members.error;
      const ids = members.data.map((member) => member.user_id);
      const profiles = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      setWorkspace({ membership, people: members.data.map((member) => ({
        id: member.user_id, role: member.role, allowedSections: member.allowed_sections,
        name: profiles.data?.find((profile) => profile.id === member.user_id)?.full_name ?? "عضو فريق",
      })) });
      await refreshContent(membership.organization_id);
    } catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }, [clearWorkspace, refreshContent]);
  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  const organizationId = workspace?.membership.organization_id;
  useEffect(() => {
    if (!organizationId) return;
    void refreshContent(organizationId, selectedId).catch((e) => setError(errorText(e)));
  }, [organizationId, selectedId, refreshContent]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    let channel = supabase.channel("content-desk:" + workspace.membership.organization_id + ":" + (selectedId ?? "list"));
    const refresh = () => { void refreshContent(workspace.membership.organization_id, selectedId).catch((e) => setError(errorText(e))); };
    for (const table of ["content_items", "tasks", "content_assets", "content_revision_requests", "content_step_deliveries", "content_timeline_cues"]) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: "organization_id=eq." + workspace.membership.organization_id }, refresh);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [workspace, selectedId, refreshContent]);

  const tasksByContent = useMemo(() => {
    const groups = new Map<string, Tables<"tasks">[]>();
    for (const task of data.tasks) if (task.content_item_id) groups.set(task.content_item_id, [...(groups.get(task.content_item_id) ?? []), task]);
    return groups;
  }, [data.tasks]);
  const defaultOwnerIds = useMemo(() => {
    const recent = [...data.tasks].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    return Object.fromEntries(contentAssignmentFields.map(({ name, step }) => {
      const candidate: ContentStep[] = step === "recording" ? ["recording", "caption"] : [step];
      return [name, recent.find((task) => task.content_step && candidate.includes(task.content_step))?.owner_id ?? session?.user.id ?? ""];
    }));
  }, [data.tasks, session?.user.id]);

  async function command(body: Record<string, unknown>, success: string) {
    if (!workspace || busy.current) return false;
    busy.current = true; setWorking(true); setError(null); setNotice(null);
    try {
      const response = await getSupabaseBrowserClient().functions.invoke("content-commands", { body });
      if (response.error) throw new Error(await getSupabaseFunctionErrorMessage(response.error, "تعذّر حفظ التعديل."));
      setNotice(success);
      try { await refreshContent(workspace.membership.organization_id, selectedId); }
      catch { setError("تم الحفظ، لكن تعذّر تحديث العرض. اضغط تحديث ولا تعِد إرسال التعديل."); }
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { busy.current = false; setWorking(false); }
  }
  async function create(payload: QuickIntakePayload) {
    if (!workspace || busy.current) return false;
    busy.current = true; setWorking(true); setError(null); setNotice(null);
    try {
      const result = await getSupabaseBrowserClient().functions.invoke("create-content-workflow", { body: { target_organization_id: workspace.membership.organization_id, ...payload } });
      if (result.error) throw new Error(await getSupabaseFunctionErrorMessage(result.error, "تعذّر إنشاء الطلب."));
      setShowCreate(false); setView("active"); setNotice("تم إنشاء الطلب وإسناد المهام.");
      try { await refreshContent(workspace.membership.organization_id, selectedId); }
      catch { setError("تم إنشاء الطلب، لكن تعذّر تحديث القائمة. اضغط تحديث."); }
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { busy.current = false; setWorking(false); }
  }
  async function refresh() {
    if (!workspace) return;
    setRefreshing(true); setError(null);
    try { await refreshContent(workspace.membership.organization_id, selectedId); }
    catch (e) { setError(errorText(e)); }
    finally { setRefreshing(false); }
  }

  if (loading || (workspace && !error && data.selectedId !== selectedId)) return <section className="workspace-state" role="status"><LoaderCircle className="spin" size={22} /> جارٍ تحميل الطلبات...</section>;
  if (!session || !workspace) return <section className="workspace-state"><p>{error ?? "سجّل الدخول بحساب الفريق لعرض الطلبات."}</p><Button href="/login">تسجيل الدخول</Button></section>;
  const canCreate = canManageTasks(workspace.membership.role) && (workspace.membership.role === "owner" || workspace.membership.allowed_sections.includes("tasks"));
  const assignablePeople = workspace.people.filter((person) => person.role !== "viewer" && (person.role === "owner" || person.allowedSections.includes("tasks")));
  const selected = data.items.find((item) => item.id === selectedId);

  return <section className="content-desk">
    {notice ? <p role="status" className="form-notice success">{notice}</p> : null}
    {error ? <div role="alert" className="form-notice error">{error}<Button type="button" variant="ghost" disabled={refreshing || working} onClick={() => void refresh()}>تحديث العرض</Button></div> : null}
    {selectedId ? selected ? <ContentRequestView key={selected.id} item={selected} tasks={data.tasks} assets={data.assets} deliveries={data.deliveries} revisions={data.revisions} timeline={data.timeline} people={workspace.people} userId={session.user.id} readOnly={workspace.membership.role === "viewer"} platformAdmin={canManageAllTaskExecution(workspace.membership.role)} working={working} command={command} backHref={backHref} revisionId={revisionId} /> : <><p role="alert">الطلب غير موجود أو ليس ضمن صلاحيات حسابك.</p><Button href={backHref} variant="secondary">رجوع</Button></> : <>
      <header className="request-heading"><h1>طلبات المحتوى</h1><div className="toolbar-actions"><Button type="button" variant="ghost" disabled={refreshing} onClick={() => void refresh()} aria-label="تحديث الطلبات"><RefreshCw className={refreshing ? "spin" : ""} size={17} /></Button>{canCreate ? <Button type="button" onClick={() => setShowCreate(!showCreate)}><Plus size={16} /> طلب جديد</Button> : null}</div></header>
      {showCreate && canCreate ? <QuickIntakeForm organizationId={workspace.membership.organization_id} currentUserId={session.user.id} defaultOwnerIds={defaultOwnerIds} defaultPublish={defaultPublish} people={assignablePeople} working={working} onCancel={() => setShowCreate(false)} onCreate={create} /> : null}
      <div className="request-view-tabs" aria-label="عرض الطلبات">{[["active", "الحالي"], ["scheduled", "المجدول"], ["archive", "الأرشيف"]].map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
      <ContentLibrary key={view} items={data.items} tasks={tasksByContent} view={view} />
    </>}
  </section>;
}
