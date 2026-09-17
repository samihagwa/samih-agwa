export function carouselImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && validImageLink(url));
}
export function validImageLink(value: string) {
  try { const url=new URL(value);return ["https:","http:"].includes(url.protocol)&&Boolean(url.hostname)&&!url.username&&!url.password; } catch {return false;}
}
export function carouselImagesError(images:string[]) {
  if(images.length<2||images.length>30)return "أضف من صورتين إلى 30 صورة.";
  if(images.some(url=>url.length>2000||!validImageLink(url)))return "كل صورة تحتاج رابط ويب صحيحًا.";
  if(new Set(images.map(url=>url.trim().toLowerCase())).size!==images.length)return "يوجد رابط صورة مكرر.";
  return null;
}
