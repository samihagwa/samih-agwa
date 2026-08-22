export type TelegramImportSignal = "pending" | "contacted" | "activated" | "needs_account_correction";

export type TelegramImportRow = {
  message_id: string;
  full_name: string;
  phone: string;
  email: string;
  tradingview: string;
  signal: TelegramImportSignal;
  registered_at: string;
};

export type TelegramImportPreviewRow = TelegramImportRow & {
  row_number: number;
  errors: string[];
};

export type TelegramImportPreview = {
  rows: TelegramImportPreviewRow[];
  valid_rows: TelegramImportRow[];
  invalid_count: number;
  duplicate_count: number;
  signal_counts: Record<TelegramImportSignal, number>;
};

const headerAliases = {
  message_id: ["message_id", "message id", "telegram_message_id", "معرف الرسالة", "رقم الرسالة"],
  full_name: ["full_name", "full name", "name", "اسم العميل", "الاسم", "الاسم بالكامل"],
  phone: ["phone", "mobile", "whatsapp", "رقم الهاتف", "الهاتف", "رقم الواتس", "واتساب", "الواتس"],
  email: ["email", "e-mail", "البريد", "البريد الإلكتروني", "الايميل", "الإيميل"],
  tradingview: ["tradingview", "trading view", "tradingview username", "حساب tradingview", "حساب تريدنج فيو", "تريدنج فيو"],
  registered_at: ["registered_at", "registered at", "date", "registration date", "تاريخ التسجيل", "التاريخ"],
  signal: ["signal", "status", "الحالة", "الإشارة"],
} as const;

type FieldName = keyof typeof headerAliases;
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join("");
  if (isRecord(value) && "text" in value) return cleanText(value.text);
  return "";
}

function normalizedKey(value: string) {
  return value.toLocaleLowerCase("ar-EG").replace(/[ـ_\-–—:：/\\]+/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalHeader(value: string): FieldName | null {
  const normalized = normalizedKey(value);
  for (const [field, aliases] of Object.entries(headerAliases) as [FieldName, readonly string[]][]) {
    if (aliases.some((alias) => normalized === normalizedKey(alias))) return field;
  }
  return null;
}

function extractLabeledValue(text: string, field: FieldName) {
  const aliases = headerAliases[field].map(normalizedKey);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
    if (!line) continue;
    const separator = line.search(/[:：=]/);
    if (separator >= 0) {
      const label = normalizedKey(line.slice(0, separator).replace(/^[^\p{L}\p{N}]+/u, ""));
      if (aliases.some((alias) => label === alias || label.endsWith(` ${alias}`))) return line.slice(separator + 1).trim();
    }
    const normalizedLine = normalizedKey(line);
    const alias = aliases.find((candidate) => normalizedLine.startsWith(`${candidate} `));
    if (alias) return normalizedLine.slice(alias.length).trim();
  }
  return "";
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 6) return output;
  if (typeof value === "string" || typeof value === "number") output.push(String(value));
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output, depth + 1);
  else if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  return output;
}

function parseSignal(value: unknown, reactions?: unknown): TelegramImportSignal {
  const raw = `${cleanText(value)} ${collectStrings(reactions).join(" ")}`.toLocaleLowerCase("ar-EG");
  if (raw.includes("👎") || /تصحيح|مشكلة|غير مضبوط|needs.?account.?correction|dislike/.test(raw)) return "needs_account_correction";
  if ((raw.includes("👍") && /أيمن|ايمن|ayman|aiman/.test(raw)) || /مفع[ّ]?ل|تم التفعيل|activated|active/.test(raw)) return "activated";
  if ((raw.includes("👍") && /أسماء|اسماء|asmaa|asma/.test(raw)) || /تم التواصل|تواصلت|contacted/.test(raw)) return "contacted";
  return "pending";
}

function normalizePhone(value: string) {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return `${hasPlus ? "+" : ""}${digits}`;
}

function normalizeDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString();
}

function valueFromRecord(record: UnknownRecord, field: FieldName) {
  for (const [key, value] of Object.entries(record)) {
    if (canonicalHeader(key) === field) return cleanText(value);
  }
  return "";
}

function recordFromMessage(message: UnknownRecord, index: number): TelegramImportRow {
  const text = cleanText(message.text ?? message.message ?? message.body ?? "");
  const direct = (field: FieldName) => valueFromRecord(message, field) || extractLabeledValue(text, field);
  const emailInText = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phoneInText = text.match(/\+?[0-9][0-9\s().-]{6,20}[0-9]/)?.[0] ?? "";
  return {
    message_id: direct("message_id") || cleanText(message.id) || `row-${index + 1}`,
    full_name: direct("full_name"),
    phone: normalizePhone(direct("phone") || phoneInText),
    email: (direct("email") || emailInText).toLocaleLowerCase("en-US"),
    tradingview: direct("tradingview"),
    signal: parseSignal(direct("signal"), message.reactions ?? message.reaction),
    registered_at: normalizeDate(direct("registered_at") || cleanText(message.date ?? message.created_at)),
  };
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimited(input: string) {
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitDelimitedLine(lines[0], delimiter).map(canonicalHeader);
  if (!headers.some(Boolean)) return [];
  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.flatMap((header, index) => header ? [[header, values[index] ?? ""]] : []));
  });
}

function parseTextBlocks(input: string) {
  const normalized = input.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const namePattern = /(?:^|\n)\s*(?:[-•*]\s*)?(?:اسم العميل|الاسم بالكامل|الاسم|full[_ ]?name|name)\s*[:：=]/gim;
  const starts = Array.from(normalized.matchAll(namePattern), (match) => match.index ?? 0);
  if (starts.length > 1) return starts.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length).trim());
  const blocks = normalized.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  return blocks.length ? blocks : [normalized];
}

function sourceRecords(input: string): UnknownRecord[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((item) => isRecord(item) ? item : { text: item });
    if (isRecord(parsed)) {
      const messages = Array.isArray(parsed.messages) ? parsed.messages : isRecord(parsed.result) && Array.isArray(parsed.result.messages) ? parsed.result.messages : null;
      if (messages) return messages.map((item) => isRecord(item) ? item : { text: item });
      return [parsed];
    }
  } catch {
    // Text and CSV are intentionally supported without requiring valid JSON.
  }
  const delimited = parseDelimited(trimmed);
  if (delimited.length) return delimited;
  return parseTextBlocks(trimmed).map((text, index) => ({ id: `paste-${index + 1}`, text }));
}

function validateRow(row: TelegramImportRow) {
  const errors: string[] = [];
  if (!row.message_id) errors.push("معرف الرسالة ناقص");
  if (row.full_name.length < 2 || row.full_name.length > 160) errors.push("اسم العميل ناقص أو غير صالح");
  if (!/^\+?[0-9]{7,16}$/.test(row.phone)) errors.push("رقم الهاتف غير صالح");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("البريد الإلكتروني غير صالح");
  if (row.tradingview.length < 3 || row.tradingview.length > 100) errors.push("حساب TradingView ناقص أو غير صالح");
  if (row.registered_at && Number.isNaN(new Date(row.registered_at).getTime())) errors.push("تاريخ التسجيل غير صالح");
  return errors;
}

export function parseTelegramCustomerImport(input: string): TelegramImportPreview {
  const records = sourceRecords(input);
  const rows = records.map((record, index) => {
    const row = recordFromMessage(record, index);
    return { ...row, row_number: index + 1, errors: validateRow(row) };
  });

  const seen = new Map<string, number>();
  let duplicateCount = 0;
  for (const row of rows) {
    const keys = [row.message_id && `message:${row.message_id}`, row.phone && `phone:${row.phone}`, row.email && `email:${row.email}`, row.tradingview && `tradingview:${row.tradingview.toLocaleLowerCase("en-US")}`].filter(Boolean) as string[];
    const duplicate = keys.find((key) => seen.has(key));
    if (duplicate) {
      row.errors.push(`مكرر داخل الملف مع الصف ${seen.get(duplicate)}`);
      duplicateCount += 1;
    } else for (const key of keys) seen.set(key, row.row_number);
  }

  const signalCounts: Record<TelegramImportSignal, number> = { pending: 0, contacted: 0, activated: 0, needs_account_correction: 0 };
  for (const row of rows) signalCounts[row.signal] += 1;
  const validRows = rows.filter((row) => row.errors.length === 0).map((row) => ({
    message_id: row.message_id,
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    tradingview: row.tradingview,
    signal: row.signal,
    registered_at: row.registered_at,
  }));
  return { rows, valid_rows: validRows, invalid_count: rows.length - validRows.length, duplicate_count: duplicateCount, signal_counts: signalCounts };
}
