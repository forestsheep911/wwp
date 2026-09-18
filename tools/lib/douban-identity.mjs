// Keep the standalone metadata CLI usable without a TypeScript loader.
export function parseDoubanSubjectId(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'movie.douban.com' || url.port) return undefined;
    return url.pathname.match(/^\/subject\/(\d{4,12})\/?$/)?.[1];
  } catch { return undefined; }
}
export function maintainedDoubanSubjectId(id, url) {
  const value = String(id ?? '').trim();
  if (!/^\d{4,12}$/.test(value)) return undefined;
  return url?.trim() && parseDoubanSubjectId(url) !== value ? undefined : value;
}
