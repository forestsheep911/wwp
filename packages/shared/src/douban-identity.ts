// Film identity only; people, photos, reviews and books use other namespaces.
export function parseDoubanSubjectId(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d{4,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'movie.douban.com' || url.port) return undefined;
    return url.pathname.match(/^\/subject\/(\d{4,12})\/?$/)?.[1];
  } catch { return undefined; }
}

export function maintainedDoubanSubjectId(id: string | undefined, url?: string): string | undefined {
  const subjectId = id?.trim();
  if (!subjectId || !/^\d{4,12}$/.test(subjectId)) return undefined;
  if (url?.trim() && parseDoubanSubjectId(url) !== subjectId) return undefined;
  return subjectId;
}
