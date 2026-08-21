"use client";

import type { Session } from "@supabase/supabase-js";
import {
  Bot, CheckCircle2, Cpu, KeyRound, LoaderCircle, LockKeyhole, Pencil,
  Plus, RefreshCw, ServerCog, ShieldCheck, Sparkles, Trash2, XCircle,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Enums, Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Organization = Tables<"organizations">;
type Membership = Tables<"memberships">;
type Provider = Tables<"ai_providers">;
type Protocol = Enums<"ai_api_protocol">;
type Workspace = { organization: Organization; membership: Membership; providers: Provider[] };
type PresetKey = "deepseek_flash" | "deepseek_pro" | "openai" | "custom";
type ProviderForm = {
  preset: PresetKey;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  isDefault: boolean;
};

const presets: Record<PresetKey, Omit<ProviderForm, "apiKey" | "isDefault" | "preset">> = {
  deepseek_flash: {
    name: "DeepSeek V4 Flash",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  deepseek_pro: {
    name: "DeepSeek V4 Pro",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
  },
  openai: {
    name: "OpenAI",
    protocol: "openai_responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
  },
  custom: {
    name: "مزود مخصص",
    protocol: "openai_chat_completions",
    baseUrl: "",
    model: "",
  },
};

function blankForm(): ProviderForm {
  return { preset: "deepseek_flash", ...presets.deepseek_flash, apiKey: "", isDefault: true };
}

function formatTestDate(value: string | null) {
  if (!value) return "لم يُختبر بعد";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function protocolLabel(protocol: Protocol) {
  return protocol === "openai_responses" ? "OpenAI Responses" : "OpenAI-compatible Chat";
}

export function AiProvidersWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const { data: organization, error: organizationError } = await supabase.from("organizations")
        .select("*").eq("id", membership.organization_id).single();
      if (organizationError) throw organizationError;
      let providers: Provider[] = [];
      if (membership.role === "owner") {
        const { data, error: providersError } = await supabase.from("ai_providers")
          .select("*").eq("organization_id", membership.organization_id)
          .order("is_default", { ascending: false }).order("updated_at", { ascending: false });
        if (providersError) throw providersError;
        providers = data ?? [];
      }
      setWorkspace({ organization, membership, providers });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل إعدادات الذكاء الاصطناعي.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  const defaultProvider = useMemo(
    () => workspace?.providers.find((provider) => provider.is_default) ?? null,
    [workspace?.providers],
  );

  const refresh = useCallback(async () => {
    if (session) await loadWorkspace(session);
  }, [loadWorkspace, session]);

  function selectPreset(preset: PresetKey) {
    setForm((current) => ({
      ...current,
      preset,
      ...presets[preset],
    }));
  }

  function startCreate() {
    setEditingId(null);
    setForm({ ...blankForm(), isDefault: !defaultProvider });
    setFormOpen(true);
    clearTransientState();
  }

  function startEdit(provider: Provider) {
    const preset = provider.base_url === "https://api.deepseek.com" && provider.model === "deepseek-v4-flash"
      ? "deepseek_flash"
      : provider.base_url === "https://api.deepseek.com" && provider.model === "deepseek-v4-pro"
        ? "deepseek_pro"
        : provider.base_url === "https://api.openai.com/v1"
          ? "openai"
          : "custom";
    setEditingId(provider.id);
    setForm({
      preset,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.base_url,
      model: provider.model,
      apiKey: "",
      isDefault: provider.is_default,
    });
    setFormOpen(true);
    clearTransientState();
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    const busyKey = editingId ?? "new";
    setBusyId(busyKey); clearTransientState();
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("ai-provider-commands", {
      body: {
        action: "save_provider",
        organization_id: workspace.organization.id,
        provider_id: editingId,
        name: form.name,
        protocol: form.protocol,
        base_url: form.baseUrl,
        model: form.model,
        api_key: form.apiKey,
        is_default: form.isDefault,
      },
    });
    setBusyId(null);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر حفظ مزوّد الذكاء الاصطناعي."));
      return;
    }
    setNotice(editingId ? "تم تحديث المزوّد بأمان." : "تم حفظ المزوّد. اختبر الاتصال قبل استخدامه في الشغل.");
    setFormOpen(false); setEditingId(null); setForm(blankForm());
    await refresh();
  }

  async function runCommand(provider: Provider, action: "test_provider" | "set_default" | "delete_provider") {
    if (action === "delete_provider" && !window.confirm(`حذف ${provider.name} ومفتاحه المشفّر نهائيًا؟`)) return;
    setBusyId(provider.id); clearTransientState();
    const { data, error: commandError } = await getSupabaseBrowserClient().functions.invoke("ai-provider-commands", {
      body: { action, provider_id: provider.id },
    });
    setBusyId(null);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, action === "test_provider" ? "فشل اختبار الاتصال." : "تعذّر تنفيذ الأمر."));
      await refresh();
      return;
    }
    const result = data as { message?: string } | null;
    setNotice(action === "test_provider" ? result?.message ?? "الاتصال ناجح." : action === "set_default" ? "تم تغيير المزوّد الافتراضي." : "تم حذف المزوّد ومفتاحه المشفّر.");
    await refresh();
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح إعدادات AI</h2><p>نحمّل المزوّدين بدون كشف أي مفاتيح.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>إعدادات المزوّدين متاحة داخل مساحة العمل فقط.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state"><ServerCog size={27} /><div><h2>لا توجد مساحة عمل نشطة</h2><p>{error ?? "أنشئ مساحة العمل أولًا."}</p></div></section>;
  if (workspace.membership.role !== "owner") return <section className="workspace-state"><ShieldCheck size={27} /><div><h2>إعدادات المالك فقط</h2><p>أعضاء الفريق يستخدمون المزوّد الافتراضي، لكن لا يمكنهم رؤية إعداداته أو مفاتيحه.</p></div></section>;

  return <section className="ai-settings-workspace">
    <header className="ai-settings-hero panel">
      <div><span className="ai-settings-hero-icon"><Bot size={25} /></span><div><p className="overline">طبقة AI مستقلة</p><h2>مزودو الذكاء الاصطناعي</h2><p>اختَر DeepSeek أو OpenAI أو أي API يدعم صيغة OpenAI القياسية. المزوّد الافتراضي هو الذي يكتب الاسكريبتات تلقائيًا.</p></div></div>
      <div className="ai-default-summary">
        <span>المزوّد الحالي</span>
        <strong>{defaultProvider?.name ?? "غير مضبوط"}</strong>
        <small>{defaultProvider ? defaultProvider.model : "أضف مزوّدًا لبدء التوليد"}</small>
      </div>
    </header>

    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}

    <aside className="ai-vault-note">
      <ShieldCheck size={20} />
      <div><strong>المفتاح لا يظهر في المتصفح بعد الحفظ</strong><p>يُرسل مشفّرًا عبر HTTPS، ويُخزن داخل Supabase Vault. الموقع يحتفظ فقط بآخر 4 رموز للتعريف بالمفتاح.</p></div>
    </aside>

    <section className="panel ai-provider-list-panel">
      <div className="section-heading">
        <div><p className="overline">الاتصالات</p><h2>المزوّدون المتاحون</h2><p>اختبر المزوّد أولًا، ثم اجعله افتراضيًا. تغيير المزوّد لا يحتاج تعديل أي صفحة أخرى.</p></div>
        <Button type="button" onClick={startCreate}><Plus size={15} /> إضافة API</Button>
      </div>

      {formOpen ? <form className="ai-provider-form" onSubmit={(event) => void saveProvider(event)}>
        <div className="ai-provider-form-heading"><div><p className="overline">{editingId ? "تعديل الاتصال" : "اتصال جديد"}</p><h3>{editingId ? "حدّث بيانات المزوّد" : "أضف مزوّد AI"}</h3></div><KeyRound size={22} /></div>
        <div className="ai-preset-picker">
          {(Object.keys(presets) as PresetKey[]).map((key) => <button className={form.preset === key ? "active" : ""} type="button" key={key} onClick={() => selectPreset(key)}>{key === "deepseek_flash" ? "DeepSeek Flash" : key === "deepseek_pro" ? "DeepSeek Pro" : key === "openai" ? "OpenAI" : "API مخصص"}</button>)}
        </div>
        <div className="ai-provider-fields">
          <label><span>اسم يظهر داخل الموقع</span><input required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>طريقة الاتصال</span><select value={form.protocol} onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value as Protocol }))}><option value="openai_chat_completions">OpenAI-compatible Chat Completions</option><option value="openai_responses">OpenAI Responses API</option></select></label>
          <label><span>Base URL</span><input dir="ltr" type="url" required placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
          <label><span>اسم الموديل</span><input dir="ltr" required maxLength={200} placeholder="model-name" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} /></label>
          <label className="span-2"><span>API Key {editingId ? "— اتركه فارغًا للاحتفاظ بالمفتاح الحالي" : ""}</span><input dir="ltr" type="password" autoComplete="new-password" required={!editingId} minLength={8} placeholder={editingId ? "لن نعرض المفتاح المحفوظ" : "الصق المفتاح هنا مرة واحدة"} value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} /></label>
          <label className="ai-default-checkbox"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} /><span>استخدمه كمزوّد افتراضي للسكريبتات</span></label>
        </div>
        <p className="ai-compatible-note"><Sparkles size={14} /> الخيار المخصص يعمل مع APIs المتوافقة مع OpenAI وبمصادقة Bearer. أي API بصيغة مختلفة يحتاج Adapter خاص لاحقًا.</p>
        <div className="form-actions"><Button type="submit" disabled={busyId === (editingId ?? "new")}>{busyId === (editingId ?? "new") ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />} حفظ آمن</Button><Button type="button" variant="ghost" onClick={() => { setFormOpen(false); setEditingId(null); }}>إلغاء</Button></div>
      </form> : null}

      <div className="ai-provider-grid">
        {workspace.providers.map((provider) => <article className={`ai-provider-card${provider.is_default ? " default" : ""}`} key={provider.id}>
          <header><span className="ai-provider-icon"><Cpu size={19} /></span><div><div><h3>{provider.name}</h3>{provider.is_default ? <StatusBadge tone="success">افتراضي</StatusBadge> : null}</div><p dir="ltr">{provider.model}</p></div></header>
          <dl>
            <div><dt>الاتصال</dt><dd>{protocolLabel(provider.protocol)}</dd></div>
            <div><dt>المفتاح</dt><dd dir="ltr">•••• {provider.key_hint}</dd></div>
            <div className="wide"><dt>Base URL</dt><dd dir="ltr">{provider.base_url}</dd></div>
          </dl>
          <div className={`ai-test-state ${provider.last_test_status}`}>
            {provider.last_test_status === "success" ? <CheckCircle2 size={15} /> : provider.last_test_status === "failed" ? <XCircle size={15} /> : <RefreshCw size={15} />}
            <div><strong>{provider.last_test_status === "success" ? "اتصال ناجح" : provider.last_test_status === "failed" ? "آخر اختبار فشل" : "لم يُختبر"}</strong><small>{provider.last_test_message ?? formatTestDate(provider.last_tested_at)}</small></div>
          </div>
          <footer>
            <Button type="button" variant="secondary" disabled={busyId === provider.id} onClick={() => void runCommand(provider, "test_provider")}>{busyId === provider.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} اختبار</Button>
            {!provider.is_default ? <Button type="button" variant="ghost" disabled={busyId === provider.id} onClick={() => void runCommand(provider, "set_default")}>استخدام افتراضي</Button> : null}
            <Button type="button" variant="ghost" disabled={busyId === provider.id} onClick={() => startEdit(provider)}><Pencil size={14} /> تعديل</Button>
            <Button type="button" variant="ghost" disabled={busyId === provider.id} onClick={() => void runCommand(provider, "delete_provider")}><Trash2 size={14} /> حذف</Button>
          </footer>
        </article>)}
        {!workspace.providers.length ? <div className="scripts-empty"><ServerCog size={27} /><strong>لا يوجد مزوّد AI حتى الآن</strong><p>ابدأ بـ DeepSeek V4 Flash لو هدفك تكلفة أقل، واختبر الاتصال قبل جعله جزءًا من الشغل.</p><Button type="button" onClick={startCreate}><Plus size={15} /> إضافة أول مزوّد</Button></div> : null}
      </div>
    </section>
  </section>;
}
