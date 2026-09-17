"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Plus, Save } from "lucide-react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { Button } from "../ui/Button";
import { ScriptToolPanel } from "./ScriptToolPanel";

type Page = Tables<"script_pages">;
export function ScriptPages({ scriptId, readOnly, onClose }: { scriptId: string; readOnly: boolean; onClose: () => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [active, setActive] = useState<Page | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = Boolean(active && (active.edit_version === 0 || title !== active.title || body !== active.body));
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const result = await getSupabaseBrowserClient().from("script_pages").select("*").eq("script_id", scriptId).order("created_at").limit(1000);
      if (!mounted) return;
      if (result.error) setError(result.error.message); else setPages(result.data ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [scriptId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function mayLeave() { return !lock.current && (!dirty || window.confirm("يوجد تعديل غير محفوظ. مغادرة الصفحة بدون حفظ؟")); }
  function open(page: Page | null) {
    if (!mayLeave()) return;
    setActive(page); setTitle(page?.title ?? ""); setBody(page?.body ?? ""); setError(null); setNotice(null);
  }
  function create(parent: Page | null) {
    if (readOnly || loading || (parent && parent.edit_version === 0)) return;
    open({ id: crypto.randomUUID(), script_id: scriptId, parent_id: parent?.id ?? null, title: "صفحة جديدة", body: "", edit_version: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  async function save() {
    if (!active || readOnly || lock.current || !title.trim()) return;
    lock.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const result = await getSupabaseBrowserClient().rpc("save_script_page", { target_script_id: scriptId, page_id: active.id, parent_page_id: active.parent_id, page_title: title, page_body: body, expected_version: active.edit_version }).single();
      if (result.error) throw result.error;
      const saved = result.data;
      setPages((current) => [...current.filter((page) => page.id !== saved.id), saved]);
      setActive(saved); setTitle(saved.title); setBody(saved.body); setNotice("تم حفظ الصفحة");
    } catch (failure) { setError(failure instanceof Error ? failure.message : (failure as { message?: string }).message ?? "تعذّر الحفظ؛ النص ما زال هنا، انسخه قبل التحديث."); }
    finally { lock.current = false; setSaving(false); }
  }
  const parents: Page[] = [];
  let parent = active?.parent_id;
  while (parent && parents.length < 10) { const page = pages.find((item) => item.id === parent); if (!page) break; parents.unshift(page); parent = page.parent_id; }
  const children = pages.filter((page) => page.parent_id === (active?.id ?? null));
  return <ScriptToolPanel title="الصفحات الداخلية" error={error} notice={notice} onClose={() => { if (mayLeave()) onClose(); }}>
    <nav className="script-page-breadcrumb" aria-label="مسار الصفحة"><Button type="button" variant="ghost" disabled={saving} onClick={() => open(null)}>صفحات السكريبت</Button>{parents.map((page) => <Button key={page.id} type="button" variant="ghost" disabled={saving} onClick={() => open(page)}> / {page.title}</Button>)}</nav>
    {loading ? <p role="status">جارٍ تحميل الصفحات…</p> : active ? <section className="script-inner-page">
      <label><span className="sr-only">عنوان الصفحة الداخلية</span><input aria-label="عنوان الصفحة الداخلية" maxLength={180} value={title} readOnly={readOnly || saving} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><span className="sr-only">نص الصفحة الداخلية</span><textarea aria-label="نص الصفحة الداخلية" placeholder="اكتب ملاحظاتك وروابطك هنا…" maxLength={30000} value={body} readOnly={readOnly || saving} onChange={(event) => setBody(event.target.value)} /></label>
      {!readOnly ? <Button type="button" disabled={!dirty || saving || !title.trim()} onClick={() => void save()}><Save size={16} /> {saving ? "جارٍ الحفظ…" : "حفظ الصفحة"}</Button> : null}
    </section> : <p>صفحات خاصة بنفس السكريبت؛ يراها فقط صاحبه ومن شاركهم للمراجعة.</p>}
    <div className="script-page-list">{children.map((page) => <button type="button" disabled={saving} key={page.id} onClick={() => open(page)}><FileText size={18} />{page.title}<span>{pages.filter((item) => item.parent_id === page.id).length || ""}</span></button>)}</div>
    {!readOnly ? <Button type="button" variant="ghost" disabled={loading || saving || active?.edit_version === 0 || parents.length >= 10} onClick={() => create(active)}><Plus size={17} /> {active ? "صفحة داخل هذه الصفحة" : "صفحة جديدة"}</Button> : null}
  </ScriptToolPanel>;
}
