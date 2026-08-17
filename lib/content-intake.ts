export type TimelineCueKind = "cut" | "visual" | "text" | "audio" | "review" | "note";

export type IntakeTimelineCue = {
  startSeconds: number;
  endSeconds: number | null;
  kind: TimelineCueKind;
  action: string;
  sourceUrl: string | null;
};

export type IntakeAsset = {
  kind: "reference" | "thumbnail";
  stage: "editing" | "thumbnail";
  title: string;
  url: string;
  notes: string;
};

export type ParsedProductionRequest = {
  title: string;
  goal: string;
  hook: string;
  cta: string;
  scriptOutline: string;
  editingBrief: string;
  thumbnailBrief: string;
  brandNotes: string;
  timeline: IntakeTimelineCue[];
  assets: IntakeAsset[];
  mentions: string[];
  warnings: string[];
};

const arabicDigits: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => arabicDigits[digit] ?? digit);
}

function cleanLine(value: string) {
  return normalizeDigits(value)
    .replace(/\*\*/g, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/[\u200e\u200f]/g, "")
    .trim();
}

function parseTimeToken(value: string) {
  const normalized = normalizeDigits(value).replace(":", ".");
  if (!normalized.includes(".")) return Number(normalized);
  const [minutes, seconds] = normalized.split(".").map(Number);
  return minutes * 60 + seconds;
}

function cueKind(action: string): TimelineCueKind {
  if (/حذف|احذف|قص|شيل/.test(action)) return "cut";
  if (/موسيقى|موسيقي|صوت|سكات|سكوت|همس|هماس/.test(action)) return "audio";
  if (/كتاب|نص|كلمة|كلمه|عنوان/.test(action)) return "text";
  if (/راجع|مراجع|لغوي|تدقيق/.test(action)) return "review";
  if (/زوم|سهم|دائرة|دايرة|لون|تلوين|انتبا|منطقة|منطقه|صورة|صوره/.test(action)) return "visual";
  return "note";
}

function parseTimedLine(line: string, deletionMode: boolean, sourceUrl: string | null): IntakeTimelineCue | null {
  const token = "(\\d{1,3}(?:[.:]\\d{1,2})?)";
  const pureRange = new RegExp(`^${token}\\s*(?:-|–|—|الى|إلى)\\s*${token}$`);
  const rangeMatch = line.match(pureRange);
  if (rangeMatch && deletionMode) {
    const startSeconds = parseTimeToken(rangeMatch[1]);
    const endSeconds = parseTimeToken(rangeMatch[2]);
    return { startSeconds, endSeconds, kind: "cut", action: "حذف المقطع", sourceUrl };
  }

  const timed = line.match(new RegExp(`^(?:من\\s+)?(?:الثانية|الثانيه|الثاينة|ثانيه)\\s*${token}(?:\\s*(?:الى|إلى|-|–|—)\\s*${token})?\\s*(.*)$`, "i"));
  if (!timed) return null;
  const startSeconds = parseTimeToken(timed[1]);
  const endSeconds = timed[2] ? parseTimeToken(timed[2]) : null;
  const action = timed[3].replace(/^[:،\-–—\s]+/, "").trim() || "مراجعة اللقطة وتنفيذ الملاحظة";
  return { startSeconds, endSeconds, kind: cueKind(action), action, sourceUrl };
}

function isHttpUrl(value: string) {
  return /^https?:\/\/\S+$/i.test(value);
}

function isCta(value: string) {
  return /كومنت|اكتب|انضم|انضموا|سجل|سجّل|اضغط|تابع|متنسوش/.test(value);
}

function isCoverStart(value: string) {
  return /(?:عاوز|مطلوب|اعمل|تصميم).*?(?:كفر|غلاف|ثامبنيل)|(?:كفر|غلاف).*?ريل/.test(value);
}

export function formatTimelineSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function parseProductionRequest(rawRequest: string): ParsedProductionRequest {
  const originalLines = rawRequest.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = originalLines.map(cleanLine).filter(Boolean);
  const headingIndex = originalLines.findIndex((line) => /^\s*#{1,6}\s+/.test(line));
  const title = headingIndex >= 0
    ? cleanLine(originalLines[headingIndex])
    : lines.find((line) => !isHttpUrl(line) && !line.startsWith("@") && line.length >= 8) ?? "طلب ريلز جديد";

  const timeline: IntakeTimelineCue[] = [];
  const generalInstructions: string[] = [];
  const scriptLines: string[] = [];
  const coverLines: string[] = [];
  const brandLines: string[] = [];
  const mentions: string[] = [];
  const assets: IntakeAsset[] = [];
  let deletionMode = false;
  let coverMode = false;
  let currentSourceUrl: string | null = null;
  let sourceCount = 0;
  let coverSourceCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === title) continue;

    if (line.startsWith("@")) {
      mentions.push(...line.match(/@[A-Za-z0-9_]+/g) ?? []);
      continue;
    }

    if (isCoverStart(line)) {
      coverMode = true;
      coverLines.push(line);
      continue;
    }

    if (isHttpUrl(line)) {
      currentSourceUrl = line;
      if (coverMode) {
        coverSourceCount += 1;
        assets.push({ kind: "thumbnail", stage: "thumbnail", title: `مرجع الغلاف ${coverSourceCount}`, url: line, notes: "مستخرج من طلب Telegram" });
      } else {
        sourceCount += 1;
        assets.push({ kind: "reference", stage: "editing", title: `مرجع المونتاج ${sourceCount}`, url: line, notes: "مستخرج من طلب Telegram" });
      }
      continue;
    }

    if (/مطلوب\s+حذف\s+من|ملطلوب\s+حذف\s+من/.test(line)) {
      deletionMode = true;
      generalInstructions.push("تنفيذ فترات الحذف المحددة قبل إخراج النسخة.");
      continue;
    }

    const timedCue = parseTimedLine(line, deletionMode, currentSourceUrl);
    if (timedCue) {
      timeline.push(timedCue);
      continue;
    }

    if (deletionMode && !/^\d/.test(line)) deletionMode = false;

    if (coverMode) {
      coverLines.push(line);
      continue;
    }

    if (/براند|هوية|الوان|ألوان|خطوط|ممنوع/.test(line)) brandLines.push(line);

    if (index < Math.max(headingIndex, 0) || /بشكل عام|مطلوب|استخراج النص|مراجعته لغويا|مراجعته لغويًا/.test(line)) {
      generalInstructions.push(line);
      continue;
    }

    if (!/^(?:الثانية|الثانيه|الثاينة|ثانيه)/.test(line)) scriptLines.push(line);
  }

  const uniqueMentions = [...new Set(mentions)];
  const cta = [...scriptLines].reverse().find(isCta) ?? "حدد الدعوة المطلوبة قبل اعتماد الطلب";
  const hook = scriptLines.find((line) => !isCta(line)) ?? title;
  const scriptOutline = scriptLines.join("\n\n") || title;
  const editingBrief = [...new Set(generalInstructions)].join("\n")
    || "تنفيذ تعليمات الـTimeline بالترتيب، ومراجعة النص والصوت قبل التسليم.";
  const thumbnailBrief = coverLines.join("\n")
    || "راجع عنوان الغلاف والصورة المرجعية قبل بدء التصميم.";
  const warnings: string[] = [];
  if (!timeline.length) warnings.push("لم نلتقط تعليمات مرتبطة بتوقيت؛ راجع الطلب أو أضفها يدويًا.");
  if (!coverLines.length) warnings.push("لم نلتقط تعليمات واضحة للغلاف؛ أضفها قبل التوزيع.");
  if (!scriptLines.length) warnings.push("لم نلتقط نصًا واضحًا للريلز؛ راجع السكريبت.");
  if (!uniqueMentions.length) warnings.push("لا توجد أسماء Telegram واضحة لاقتراح المسؤولين؛ اخترهم يدويًا.");

  return {
    title,
    goal: `شرح «${title}» بصورة واضحة وتحويله إلى ريلز قابل للتنفيذ.`,
    hook,
    cta,
    scriptOutline,
    editingBrief,
    thumbnailBrief,
    brandNotes: [...new Set(brandLines)].join("\n"),
    timeline,
    assets,
    mentions: uniqueMentions,
    warnings,
  };
}
