import type { PublicIdentity } from "@wwpdw/shared";
const entries = new Map<string, PublicIdentity>();
export function installPublicIdentities(value: PublicIdentity[]) { entries.clear(); for (const entry of value) for (const key of [entry.key, entry.id, ...entry.aliases]) entries.set(`${entry.kind}:${key}`, entry); }
export function resolveIdentity(kind: PublicIdentity["kind"], key: string) {
  return entries.get(`${kind}:${key}`);
}
export function entityPath(kind: PublicIdentity["kind"], key: string) {
  return resolveIdentity(kind, key)?.path;
}
