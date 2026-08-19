import type { Metadata } from "next";
import { Send } from "lucide-react";
import { PublishingWorkspace } from "../../components/publishing/PublishingWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "النشر التلقائي" };

export default function PublishingPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="النشر التلقائي"
      title="جدولة Telegram بلا نشر مكرر"
      description="حضّر المنشور مرة واحدة، اختر القناة والموعد، والنظام يتولى المعاينة والنشر والتوثيق. أي نتيجة غير مؤكدة تتوقف للفحص ولا تُعاد تلقائيًا."
      actions={<StatusBadge tone="success"><Send size={13} /> حماية Idempotency مفعّلة</StatusBadge>}
    />
    <PublishingWorkspace />
  </main>;
}

