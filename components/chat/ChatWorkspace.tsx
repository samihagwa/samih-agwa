"use client";

import type { Session } from "@supabase/supabase-js";
import {
  CornerUpRight, Edit3, Hash, LoaderCircle, MessageCircleMore, Plus,
  Send, ShieldCheck, Trash2, UsersRound, X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentPositiveIntegerDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Room = Tables<"team_chat_rooms">;
type Message = Tables<"team_chat_messages">;
type Membership = Tables<"memberships">;
type Person = { id: string; name: string };
type Workspace = { organizationId: string; membership: Membership; people: Person[] };

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function slugifyRoom(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `room-${Date.now().toString(36)}`;
}

export function ChatWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "خدمة الدردشة غير متاحة في هذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [draft, setDraft] = useState("");
  const [showRoomForm, setShowRoomForm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const openedMessageLink = useRef<number | null>(null);
  const [linkedMessageId] = useState(() => currentPositiveIntegerDeepLink("message", "message"));

  const clearWorkspace = useCallback(() => {
    setWorkspace(null); setRooms([]); setMessages([]); setActiveRoomId(null);
  }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const refreshMessages = useCallback(async (roomId: string) => {
    const { data, error: messagesError } = await getSupabaseBrowserClient().from("team_chat_messages")
      .select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(120);
    if (messagesError) throw messagesError;
    setMessages([...(data ?? [])].reverse());
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true); setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [{ data: roomRows, error: roomError }, { data: memberRows, error: memberError }] = await Promise.all([
        supabase.from("team_chat_rooms").select("*").eq("organization_id", membership.organization_id)
          .eq("is_archived", false).order("created_at"),
        supabase.from("memberships").select("user_id").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (roomError) throw roomError;
      if (memberError) throw memberError;
      const ids = (memberRows ?? []).map((member) => member.user_id);
      const { data: profiles, error: profileError } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const people = ids.map((id) => ({
        id,
        name: profiles?.find((profile) => profile.id === id)?.full_name
          ?? (id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      const availableRooms = roomRows ?? [];
      const requestedRoom = new URL(window.location.href).searchParams.get("room");
      const roomId = availableRooms.some((room) => room.id === requestedRoom)
        ? requestedRoom : availableRooms[0]?.id ?? null;
      setWorkspace({ organizationId: membership.organization_id, membership, people });
      setRooms(availableRooms); setActiveRoomId(roomId);
      if (roomId) await refreshMessages(roomId); else setMessages([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر فتح مجتمع الفريق.");
    } finally { setLoading(false); }
  }, [clearWorkspace, refreshMessages]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  useEffect(() => {
    if (!workspace || !activeRoomId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`team-chat:${activeRoomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_chat_messages", filter: `room_id=eq.${activeRoomId}` }, () => void refreshMessages(activeRoomId))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeRoomId, refreshMessages, workspace]);

  useEffect(() => {
    if (linkedMessageId) {
      if (openedMessageLink.current === linkedMessageId) return;
      const targetMessage = messages.find((message) => message.id === linkedMessageId);
      if (!targetMessage) return;
      const frame = window.requestAnimationFrame(() => {
        const target = document.getElementById(`message-${linkedMessageId}`);
        if (!target) return;
        openedMessageLink.current = linkedMessageId;
        target.scrollIntoView({ block: "center" });
        target.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [linkedMessageId, messages]);

  const peopleById = useMemo(() => new Map((workspace?.people ?? []).map((person) => [person.id, person.name])), [workspace]);
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null;
  const canManageRooms = workspace?.membership.role === "owner" || workspace?.membership.role === "admin";

  async function chooseRoom(roomId: string) {
    setActiveRoomId(roomId); setReplyTo(null); setEditing(null); setDraft(""); setError(null);
    window.history.replaceState(null, "", `/chat?room=${encodeURIComponent(roomId)}`);
    try { await refreshMessages(roomId); } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل الرسائل.");
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session || !activeRoomId || !draft.trim()) return;
    setWorking(true); setError(null); setNotice(null);
    const result = await getSupabaseBrowserClient().functions.invoke("chat-commands", { body: editing
      ? { action: "edit", message_id: editing.id, message_body: draft }
      : {
        action: "send", organization_id: workspace.organizationId, room_id: activeRoomId,
        message_body: draft, reply_to_id: replyTo?.id ?? null,
      } });
    setWorking(false);
    if (result.error) { setError(await getSupabaseFunctionErrorMessage(result.error, "تعذّر حفظ الرسالة.")); return; }
    setDraft(""); setReplyTo(null); setEditing(null);
    await refreshMessages(activeRoomId);
  }

  async function deleteMessage(message: Message) {
    if (!activeRoomId || !window.confirm("حذف هذه الرسالة من الدردشة؟")) return;
    setWorking(true); setError(null);
    const { error: deleteError } = await getSupabaseBrowserClient().functions.invoke("chat-commands", { body: { action: "delete", message_id: message.id } });
    setWorking(false);
    if (deleteError) { setError(await getSupabaseFunctionErrorMessage(deleteError, "تعذّر حذف الرسالة.")); return; }
    await refreshMessages(activeRoomId);
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    setWorking(true); setError(null);
    const { data, error: roomError } = await getSupabaseBrowserClient().functions.invoke("chat-commands", { body: {
      action: "create_room", organization_id: workspace.organizationId, name,
      slug: slugifyRoom(String(form.get("slug") ?? name)),
      description: String(form.get("description") ?? ""),
    } });
    setWorking(false);
    if (roomError) { setError(await getSupabaseFunctionErrorMessage(roomError, "تعذّر إنشاء مساحة النقاش.")); return; }
    setNotice("تم إنشاء مساحة النقاش الجديدة."); setShowRoomForm(false);
    if (session) await loadWorkspace(session);
    const roomId = data && typeof data.room_id === "string" ? data.room_id : null;
    if (roomId) await chooseRoom(roomId);
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح مجتمع الفريق</h2><p>نحمّل الغرف والرسائل المسموحة لحسابك.</p></div></section>;
  if (!workspace || !session) return <section className="workspace-state"><MessageCircleMore size={24} /><div><h2>الدردشة غير متاحة</h2><p>تأكد من عضويتك وصلاحية قسم مجتمع الفريق.</p></div></section>;

  return <section className="team-chat-shell">
    <aside className="team-chat-rooms panel">
      <header><div><p className="overline">المساحات</p><h2>مجتمع الفريق</h2></div>{canManageRooms ? <button type="button" aria-label="إضافة غرفة" onClick={() => setShowRoomForm((value) => !value)}><Plus size={18} /></button> : null}</header>
      {showRoomForm ? <form className="team-chat-room-form" onSubmit={createRoom}>
        <label><span>اسم المساحة</span><input name="name" required minLength={2} maxLength={80} placeholder="مثال: فريق المحتوى" /></label>
        <label><span>وصف مختصر</span><input name="description" maxLength={500} placeholder="النقاشات التي تخص هذه المساحة" /></label>
        <div><Button type="submit" disabled={working}>إنشاء</Button><Button type="button" variant="ghost" onClick={() => setShowRoomForm(false)}>إلغاء</Button></div>
      </form> : null}
      <nav aria-label="غرف الدردشة">{rooms.map((room) => <button key={room.id} type="button" className={room.id === activeRoomId ? "active" : ""} onClick={() => void chooseRoom(room.id)}><Hash size={16} /><span><strong>{room.name}</strong><small>{room.description || "نقاش الفريق"}</small></span></button>)}</nav>
      <footer><UsersRound size={16} /><span>{workspace.people.length.toLocaleString("ar-EG")} عضو فعّال</span></footer>
    </aside>

    <div className="team-chat-conversation panel">
      <header><div><Hash size={20} /><span><strong>{activeRoom?.name ?? "مجتمع الفريق"}</strong><small>{activeRoom?.description ?? "ابدأ أول نقاش للفريق"}</small></span></div><StatusBadge tone="success"><ShieldCheck size={13} /> خاص بالفريق</StatusBadge></header>
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {notice ? <p className="form-notice success">{notice}</p> : null}
      {linkedMessageId && messages.some((message) => message.id === linkedMessageId) ? <p className="direct-link-notice" role="status"><MessageCircleMore size={15} /> تم فتح الرسالة المطلوبة مباشرة.</p> : linkedMessageId && !loading ? <p className="form-notice error" role="alert">الرسالة المطلوبة غير موجودة أو ليست ضمن صلاحيات حسابك.</p> : null}
      <div className="team-chat-messages" role="log" aria-live="polite">
        {!messages.length ? <div className="team-chat-empty"><MessageCircleMore size={30} /><h3>ابدأ أول رسالة هنا</h3><p>الدردشة مخصصة للتنسيق السريع. المهام والملفات النهائية تظل في أقسامها الأساسية.</p></div> : null}
        {messages.map((message) => {
          const own = message.author_id === session.user.id;
          const replied = message.reply_to_id ? messagesById.get(message.reply_to_id) : null;
          return <article id={`message-${message.id}`} key={message.id} data-direct-target={linkedMessageId === message.id || undefined} tabIndex={linkedMessageId === message.id ? -1 : undefined} className={`team-chat-message ${own ? "own" : ""} ${message.deleted_at ? "deleted" : ""}`}>
            <div className="team-chat-avatar" aria-hidden="true">{(peopleById.get(message.author_id) ?? "ع").trim().charAt(0)}</div>
            <div><header><strong>{peopleById.get(message.author_id) ?? "عضو فريق"}</strong><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>{message.edited_at ? <small>معدّلة</small> : null}</header>
              {replied ? <blockquote><CornerUpRight size={13} /><span>{peopleById.get(replied.author_id) ?? "عضو"}: {replied.deleted_at ? "رسالة محذوفة" : replied.body.slice(0, 140)}</span></blockquote> : null}
              <p>{message.deleted_at ? "تم حذف الرسالة" : message.body}</p>
              {!message.deleted_at ? <footer><button type="button" onClick={() => { setReplyTo(message); setEditing(null); setDraft(""); }}><CornerUpRight size={13} /> رد</button>{own ? <button type="button" onClick={() => { setEditing(message); setReplyTo(null); setDraft(message.body); }}><Edit3 size={13} /> تعديل</button> : null}{own || canManageRooms ? <button type="button" onClick={() => void deleteMessage(message)}><Trash2 size={13} /> حذف</button> : null}</footer> : null}
            </div>
          </article>;
        })}
        <div ref={messagesEndRef} />
      </div>
      <form className="team-chat-composer" onSubmit={submitMessage}>
        {replyTo || editing ? <div className="team-chat-compose-context"><span>{editing ? `تعديل رسالتك` : `رد على ${peopleById.get(replyTo?.author_id ?? "") ?? "عضو"}`}</span><button type="button" aria-label="إلغاء" onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }}><X size={15} /></button></div> : null}
        <div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={4000} placeholder={activeRoom ? `اكتب في #${activeRoom.name}` : "اختر مساحة أولًا"} disabled={!activeRoom || working} /><button type="submit" aria-label={editing ? "حفظ التعديل" : "إرسال الرسالة"} disabled={!draft.trim() || !activeRoom || working}>{working ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}</button></div>
        <small>للتنسيق والنقاش. أي شغل مطلوب تنفيذه يتحول إلى مهمة واضحة في بورد المهام.</small>
      </form>
    </div>
  </section>;
}
