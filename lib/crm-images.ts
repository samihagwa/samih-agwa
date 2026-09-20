export const CRM_IMAGE_BUCKET = "crm-conversation-images";
export const CRM_IMAGE_MAX_BYTES = 1_048_576;
export const CRM_IMAGE_INPUT_MAX_BYTES = 15 * 1_048_576;
export type CrmImage = { id: string; object_path: string; created_by: string; created_at: string; caption: string; bytes: number; author_name: string; state: "ready" | "archived" };
export type CrmImagePage = { images: CrmImage[]; total: number; used_bytes: number; limit_bytes: number; pending: number };
export type PreparedCrmImage = { id: string; blob: Blob; url: string; width: number; height: number };
export type Redaction = { x: number; y: number; width: number; height: number };

export function imageInputError(file: Pick<File, "size" | "type">) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "اختر صورة PNG أو JPG أو WebP فقط.";
  if (!file.size || file.size > CRM_IMAGE_INPUT_MAX_BYTES) return "الصورة الأصلية يجب ألا تتجاوز 15 ميجابايت. قسّم الصور الطويلة إلى أكثر من لقطة.";
  return null;
}
export function imageDimensions(width: number, height: number) {
  if (!width || !height || width * height > 40_000_000) throw new Error("أبعاد الصورة كبيرة جدًا. قسّمها إلى لقطات أصغر.");
  const ratio = Math.min(1, 1600 / width, 12000 / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
export function imageSize(bytes: number) {
  return bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} كيلوبايت` : `${(bytes / 1_048_576).toFixed(1)} ميجابايت`;
}
function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("تعذر تجهيز الصورة. جرّب لقطة أخرى.")), "image/webp", quality));
}
/** Re-encode pixels on-device: never upload the original, EXIF, or an SVG. */
export async function prepareCrmImage(input: Blob, redaction?: Redaction): Promise<PreparedCrmImage> {
  const error = imageInputError(input); if (error) throw new Error(error);
  const source = await createImageBitmap(input).catch(() => { throw new Error("تعذر قراءة الصورة. جرّب حفظ لقطة جديدة بصيغة PNG أو JPG."); });
  try {
    const size = imageDimensions(source.width, source.height), canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("المتصفح لا يدعم تجهيز الصور.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    if (redaction) {
      context.fillStyle = "#000000";
      context.fillRect(Math.floor(size.width * redaction.x / 100), Math.floor(size.height * redaction.y / 100), Math.ceil(size.width * redaction.width / 100), Math.ceil(size.height * redaction.height / 100));
    }
    let blob = await canvasBlob(canvas, .88);
    for (const quality of [.8, .72]) { if (blob.size <= 300_000) break; blob = await canvasBlob(canvas, quality); }
    // Safari may fall back to PNG; JPEG is an explicit supported fallback.
    if (blob.type !== "image/webp") blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("تعذر ضغط الصورة")), "image/jpeg", .85));
    if (blob.size > CRM_IMAGE_MAX_BYTES) throw new Error("الصورة ما زالت أكبر من 1 ميجابايت بعد الضغط. قسّمها للحفاظ على وضوح الكلام.");
    return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), ...size };
  } finally { source.close(); }
}
export async function imageHash(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), n => n.toString(16).padStart(2,"0")).join("");
}
