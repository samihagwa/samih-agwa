"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

/** Native top-layer modal, centered independently of the RTL application grid. */
export function CenteredDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current, trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  return <dialog ref={ref} className="centered-report-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><Button type="button" variant="ghost" aria-label={`إغلاق ${title}`} onClick={onClose}><X size={20} /></Button></header>
    <div className="report-dialog-body">{children}</div>
  </dialog>;
}
