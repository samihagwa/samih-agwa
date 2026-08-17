import type { Metadata } from "next";
import { CampaignsWorkspace } from "../../components/campaigns/CampaignsWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الحملات والإطلاقات" };

export default function CampaignsPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="الحملات والإطلاقات"
        title="خطة إطلاق تُدار بالبوابات لا بالتخمين"
        description="غرفة واحدة للهدف والعرض والجمهور والمستهدفات والخطة العكسية، مرتبطة بمهام الفريق وأصول المحتوى وقرار Go / No-Go حقيقي."
        actions={<StatusBadge tone="success">متصلة بالمهام والمحتوى</StatusBadge>}
      />
      <CampaignsWorkspace />
    </main>
  );
}
