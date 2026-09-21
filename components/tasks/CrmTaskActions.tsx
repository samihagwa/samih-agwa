import { ContactRound, CheckCircle2 } from "lucide-react";
import { Button } from "../ui/Button";
import type { TaskStatus } from "../../lib/tasks";

/** Viewing a customer must never implicitly open the follow-up completion form. */
export function CrmTaskActions({ contactId, status, canComplete }: {
  contactId: string; status: TaskStatus; canComplete: boolean;
}) {
  return <>
    <Button href={`/crm/${contactId}`} variant="secondary"><ContactRound size={15} /> فتح ملف العميل</Button>
    {canComplete && status !== "done" && status !== "cancelled" ?
      <Button href={`/crm/${contactId}?action=complete-follow-up#follow-up-result`} variant="secondary"><CheckCircle2 size={15} /> سجّل نتيجة المتابعة</Button> : null}
  </>;
}
