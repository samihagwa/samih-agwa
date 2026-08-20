export const publishingStatusConfig: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  pending: { label: "مجدول", tone: "neutral" },
  previewing: { label: "جارٍ إرسال المعاينة", tone: "info" },
  previewed: { label: "تمت المعاينة", tone: "info" },
  awaiting_approval: { label: "ينتظر موافقة", tone: "warning" },
  approved: { label: "معتمد", tone: "success" },
  ready: { label: "جاهز للنشر", tone: "success" },
  publishing: { label: "جارٍ النشر", tone: "info" },
  published: { label: "منشور", tone: "success" },
  skipped: { label: "تم تخطيه", tone: "warning" },
  held: { label: "موقوف", tone: "warning" },
  held_changed: { label: "تغيّر بعد المعاينة", tone: "danger" },
  failed: { label: "فشل", tone: "danger" },
  unknown: { label: "غير مؤكد", tone: "danger" },
  cancelled: { label: "ملغي", tone: "neutral" },
};

export const previewPolicyConfig = {
  review_window: {
    label: "معاينة ثم نشر تلقائي",
    description: "يوصلك Preview ويمكنك الإلغاء أو التأجيل؛ عدم الرد لا يوقف الموعد.",
  },
  automatic: {
    label: "تلقائي بالكامل",
    description: "ينشر في الموعد بدون انتظار أو رسالة موافقة.",
  },
  approval_required: {
    label: "موافقة إلزامية",
    description: "للمحتوى الحساس فقط؛ لو لم توافق لن يُنشر.",
  },
} as const;

export function publicationStatus(status: string) {
  return publishingStatusConfig[status] ?? { label: status, tone: "neutral" as const };
}

const arabicNumber = new Intl.NumberFormat("ar-EG", { useGrouping: false });

export function formatPublishingCountdown(scheduledAt: string, now = Date.now()) {
  const scheduledTime = new Date(scheduledAt).getTime();
  if (Number.isNaN(scheduledTime)) return "موعد النشر غير صالح";

  const remaining = scheduledTime - now;
  if (remaining <= 0) return "حان موعد النشر";
  if (remaining < 60_000) return "متبقي على النشر أقل من دقيقة";

  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${arabicNumber.format(days)} يوم` : null,
    hours ? `${arabicNumber.format(hours)} ساعة` : null,
    minutes ? `${arabicNumber.format(minutes)} دقيقة` : null,
  ].filter((part): part is string => Boolean(part));

  return `متبقي على النشر ${parts.join(" و")}`;
}
