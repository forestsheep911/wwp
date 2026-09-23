export type PublicEntityKind = "work" | "person" | "video";
export interface PublicIdentity { kind: PublicEntityKind; id: string; key: string; title: string; path: string; aliases: string[] }
export function publicEntityPath(kind: PublicEntityKind, id: string, title: string) {
  if (kind === "video") return `/watch/${id}`;
  const name = title.normalize("NFKC").replace(/[\/\\?#%<>\u0000-\u001f]/g, " ").trim().replace(/\s+/g, "-").slice(0, 96) || (kind === "work" ? "作品" : "人物");
  return `/${kind === "work" ? "works" : "people"}/${encodeURIComponent(name)}-${id}`;
}

export interface PublicNavigationFields { publicId?: string; canonicalPath?: string; playbackPath?: string }
