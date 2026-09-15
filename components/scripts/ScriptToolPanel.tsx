"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/Button";

/** Script-only tools: native focus containment, Escape and return-focus. */
export function ScriptToolPanel({ title, onClose, children, error, notice }: { title: string; onClose: () => void; children: ReactNode; error?: string | null; notice?: string | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = previous; trigger?.focus(); };
  }, []);
  return <dialog className="script-tool-dialog" ref={ref} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><Button type="button" variant="ghost" aria-label="إغلاق" onClick={onClose}><X size={21} /></Button></header>
    <div className="script-tool-body">{error ? <p role="alert" className="form-notice error">{error}</p> : null}{notice ? <p role="status" className="form-notice">{notice}</p> : null}{children}</div>
  </dialog>;
}
