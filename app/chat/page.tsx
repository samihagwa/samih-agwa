import type { Metadata } from "next";
import { ChatWorkspace } from "../../components/chat/ChatWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مجتمع الفريق" };

export default function ChatPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="مجتمع الفريق"
      title="دردشة داخلية منظمة من غير ما يضيع الشغل"
      description="مساحات خاصة لأعضاء الفريق للنقاش السريع والردود، مع بقاء المهام والتسليمات والاعتمادات في أقسامها الصحيحة."
      actions={<StatusBadge tone="success">لحظي وخاص بالفريق</StatusBadge>}
    />
    <ChatWorkspace />
  </main>;
}
