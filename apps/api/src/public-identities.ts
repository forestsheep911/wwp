import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicEntityPath, type PublicIdentity, type PublicEntityKind } from "@wwpdw/shared";
export interface IdentityCandidate { kind: PublicEntityKind; key: string; title: string; aliases?: string[] }
interface Registry { version: 1; entries: PublicIdentity[] }
/** Durable identity registry, separate from disposable indexes. Serialized writes and atomic replacement. */
export class PublicIdentityStore {
  private queue: Promise<unknown> = Promise.resolve();
  private state?: Registry;
  constructor(readonly filename: string) {}
  sync(candidates: IdentityCandidate[]): Promise<PublicIdentity[]> {
    const task = this.queue.then(async () => {
      if (!this.state) {
        try { this.state = JSON.parse(await readFile(this.filename, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.state = { version: 1, entries: [] }; }
        if (this.state?.version !== 1 || !Array.isArray(this.state.entries)) throw new Error("Invalid public identity registry");
      }
      const next: Registry = structuredClone(this.state!);
      const active: PublicIdentity[] = [];
      const lookup = new Map<string, PublicIdentity>();
      const removed = new Set<PublicIdentity>();
      const added: PublicIdentity[] = [];
      const index = (entry: PublicIdentity) => { for (const key of [entry.key, entry.id, ...entry.aliases]) lookup.set(`${entry.kind}:${key}`, entry); };
      next.entries.forEach(index);
      for (const candidate of candidates) {
        const keys = new Set([candidate.key, ...(candidate.aliases ?? [])]);
        const matches = [...new Set([...keys].map(key => lookup.get(`${candidate.kind}:${key}`)).filter((entry): entry is PublicIdentity => Boolean(entry)))];
        // Multiple prior public identities can converge only through explicit catalog aliases.
        const entry = matches[0] ?? { kind: candidate.kind, id: `${{ work: "w", person: "p", video: "v" }[candidate.kind]}_${randomUUID().replaceAll("-", "")}`, key: candidate.key, title: candidate.title, path: "", aliases: [] };
        entry.aliases = [...new Set([...entry.aliases, entry.key, ...keys, ...matches.flatMap(e => [e.id, e.key, ...e.aliases])])].filter(key => key !== entry.id && key !== candidate.key);
        entry.key = candidate.key; entry.title = candidate.title;
        entry.path = publicEntityPath(entry.kind, entry.id, entry.title);
        for (const match of matches) if (match !== entry) removed.add(match);
        if (!matches.length) added.push(entry);
        index(entry); active.push(entry);
      }
      next.entries = [...next.entries, ...added].filter(entry => !removed.has(entry));
      if (JSON.stringify(next) !== JSON.stringify(this.state)) {
        await mkdir(path.dirname(this.filename), { recursive: true });
        try { await copyFile(this.filename, `${this.filename}.bak`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const temp = `${this.filename}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(next), "utf8"); await rename(temp, this.filename); this.state = next;
      }
      return [...new Set(active.map(entry => lookup.get(`${entry.kind}:${entry.key}`)!))];
    });
    this.queue = task.catch(() => undefined); return task;
  }
}
