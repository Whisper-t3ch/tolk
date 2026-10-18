/**
 * Content-Disposition для скачивания файла с произвольным (в т.ч. кириллическим) именем.
 * HTTP-заголовки — ByteString (latin1): кириллица прямо в filename="..." роняет Response
 * с «Cannot convert argument to a ByteString». По RFC 5987/6266 отдаём ASCII-fallback
 * и UTF-8 percent-encoded вариант (filename*).
 */
export function attachmentDisposition(unicodeName: string, asciiFallback?: string): string {
  const ext = unicodeName.includes(".") ? unicodeName.slice(unicodeName.lastIndexOf(".")) : "";
  const ascii =
    asciiFallback ??
    (`${unicodeName.slice(0, unicodeName.length - ext.length).replace(/[^\x20-\x7e]+/g, "_").replace(/["\\;]/g, "_").replace(/_+/g, "_") || "file"}${ext.replace(/[^\x20-\x7e]/g, "")}`);
  const encoded = encodeURIComponent(unicodeName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
