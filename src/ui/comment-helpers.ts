export const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES)
  .map((ext) => "." + ext)
  .join(",");
export function mediaError(file: { name: string; size: number; type: string }) {
  const ext = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!MEDIA_TYPES[ext])
    return "Допустимы PNG, JPG, JPEG, GIF, WEBP, SVG, MP4, MOV и WEBM.";
  if (file.size > 5 * 1024 * 1024) return "Файл больше 5 МиБ.";
  if (!file.size) return "Файл пуст.";
  if (
    file.type &&
    file.type !== MEDIA_TYPES[ext] &&
    file.type !== "application/octet-stream"
  )
    return "Тип файла не соответствует расширению.";
  return null;
}
export function mentionAt(body: string, cursor: number) {
  const match = body.slice(0, cursor).match(/(?:^|\s)@([\w-]{0,39})$/);
  return match
    ? { query: match[1], start: cursor - match[1].length - 1, end: cursor }
    : null;
}
export function replaceRange(
  body: string,
  start: number,
  end: number,
  text: string,
) {
  return {
    body: body.slice(0, start) + text + body.slice(end),
    cursor: start + text.length,
  };
}
export function replyText(
  comment: {
    body: string;
    url: string;
    author: string | null;
  },
  sourceLabel = "Original comment",
) {
  const quote = comment.body.replace(/\s+/g, " ").trim().slice(0, 180);
  return `> ${quote}${comment.body.trim().length > 180 ? "…" : ""}\n\n[${sourceLabel}](${comment.url})${comment.author ? " · @" + comment.author : ""}\n\n`;
}
