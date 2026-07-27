import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

export type SessionSubject =
  | { role: "admin"; authProvider?: "passcode" | "oauth"; mfaVerifiedAt?: string }
  | { role: "member"; memberId: string; memberName: string; authProvider?: "passcode" | "oauth"; mfaVerifiedAt?: string };

export interface SessionRecord {
  id: string;
  secretHash: string;
  csrfToken: string;
  subject: SessionSubject;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
  device?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  id: string;
  secret: string;
  cookieValue: string;
  csrfToken: string;
  record: SessionRecord;
}

export interface AuthenticatedSession {
  id: string;
  subject: SessionSubject;
  csrfToken: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  renewed: boolean;
}

interface SessionState { sessions: Record<string, SessionRecord> }
interface SessionStoreOptions {
  backend?: "local" | "azure";
  localDataDir?: string;
  accountName?: string;
  tableName?: string;
  now?: () => Date;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
  renewalThresholdMs?: number;
}

const sessionPartitionKey = "session";
const defaultIdleTtlMs = 30 * 24 * 60 * 60 * 1000;
const defaultAbsoluteTtlMs = 90 * 24 * 60 * 60 * 1000;
const defaultRenewalThresholdMs = 24 * 60 * 60 * 1000;

function positiveDuration(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) * 1000 : fallback;
}

function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function rawSecret() { return randomBytes(32).toString("base64url"); }
function subjectKey(subject: SessionSubject) { return subject.role === "admin" ? "admin" : `member:${subject.memberId}`; }
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SessionStore {
  private readonly now: () => Date;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly renewalThresholdMs: number;
  private readonly backend: "local" | "azure";
  private readonly statePath: string;
  private readonly table?: TableClient;

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idleTtlMs = options.idleTtlMs ?? positiveDuration(process.env.WWPDW_SESSION_IDLE_SECONDS, defaultIdleTtlMs);
    this.absoluteTtlMs = options.absoluteTtlMs ?? positiveDuration(process.env.WWPDW_SESSION_ABSOLUTE_SECONDS, defaultAbsoluteTtlMs);
    this.renewalThresholdMs = options.renewalThresholdMs ?? positiveDuration(process.env.WWPDW_SESSION_RENEWAL_SECONDS, defaultRenewalThresholdMs);
    const configuredBackend =
      process.env.WWPDW_SESSION_BACKEND ??
      process.env.WWPDW_AUTH_BACKEND ??
      process.env.CACHE_BACKEND;
    this.backend = options.backend ?? (configuredBackend === "azure" ? "azure" : "local");
    this.statePath = path.join(options.localDataDir ?? process.env.WWPDW_LOCAL_DATA_DIR ?? ".local-data", "session-state.json");
    if (this.backend === "azure") {
      const account = options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "stwwcachee9219db7";
      const table = options.tableName ?? process.env.AZURE_STORAGE_MEMBER_TABLE ?? "membercodes";
      this.table = new TableClient(`https://${account}.table.core.windows.net`, table, new DefaultAzureCredential());
    }
  }

  async create(subject: SessionSubject, metadata: Pick<SessionRecord, "device" | "ipAddress" | "userAgent"> = {}): Promise<IssuedSession> {
    const now = this.now();
    const secret = rawSecret();
    const record: SessionRecord = {
      id: randomUUID(), secretHash: sha256(secret), csrfToken: rawSecret(), subject,
      createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
      idleExpiresAt: new Date(now.getTime() + this.idleTtlMs).toISOString(),
      absoluteExpiresAt: new Date(now.getTime() + this.absoluteTtlMs).toISOString(), ...metadata
    };
    await this.put(record);
    return { id: record.id, secret, cookieValue: `${record.id}.${secret}`, csrfToken: record.csrfToken, record };
  }

  async authenticate(cookieValue: string | undefined): Promise<AuthenticatedSession | undefined> {
    const [id, secret, ...extra] = (cookieValue ?? "").split(".");
    if (!id || !secret || extra.length) return undefined;
    const record = await this.get(id);
    const now = this.now();
    if (!record || record.revokedAt || new Date(record.idleExpiresAt) <= now || new Date(record.absoluteExpiresAt) <= now || !safeEqual(record.secretHash, sha256(secret))) return undefined;
    const remaining = new Date(record.idleExpiresAt).getTime() - now.getTime();
    const absolute = new Date(record.absoluteExpiresAt).getTime();
    const nextIdle = Math.min(absolute, now.getTime() + this.idleTtlMs);
    const renewed = remaining <= this.renewalThresholdMs;
    record.lastSeenAt = now.toISOString();
    if (renewed) record.idleExpiresAt = new Date(nextIdle).toISOString();
    await this.put(record);
    return { id: record.id, subject: record.subject, csrfToken: record.csrfToken, idleExpiresAt: record.idleExpiresAt, absoluteExpiresAt: record.absoluteExpiresAt, renewed };
  }

  async listForSubject(subject: SessionSubject) {
    const records = await this.list();
    return records.filter((record) => subjectKey(record.subject) === subjectKey(subject) && !record.revokedAt)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
  async listActive() {
    return (await this.list()).filter((record) => !record.revokedAt).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
  async revoke(id: string, reason = "logout") { const record = await this.get(id); if (!record) return false; record.revokedAt = this.now().toISOString(); record.revokedReason = reason; await this.put(record); return true; }
  async revokeSubject(subject: SessionSubject, exceptId?: string, reason = "subject_revoked") {
    const records = await this.listForSubject(subject);
    for (const record of records) {
      if (record.id !== exceptId) await this.revoke(record.id, reason);
    }
  }

  private async readLocal(): Promise<SessionState> { try { return JSON.parse(await readFile(this.statePath, "utf8")) as SessionState; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {} }; throw e; } }
  private async writeLocal(state: SessionState) { await mkdir(path.dirname(this.statePath), { recursive: true }); const temp = `${this.statePath}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temp, this.statePath); }
  private async get(id: string) { if (!this.table) return (await this.readLocal()).sessions[id]; try { const entity = await this.table.getEntity<Record<string, unknown>>(sessionPartitionKey, id); return JSON.parse(String(entity.payload)) as SessionRecord; } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return undefined; throw e; } }
  private async put(record: SessionRecord) { if (!this.table) { const state = await this.readLocal(); state.sessions[record.id] = record; await this.writeLocal(state); return; } await this.table.upsertEntity({ partitionKey: sessionPartitionKey, rowKey: record.id, subjectKey: subjectKey(record.subject), revokedAt: record.revokedAt ?? "", payload: JSON.stringify(record) }, "Replace"); }
  private async list() { if (!this.table) return Object.values((await this.readLocal()).sessions); const records: SessionRecord[] = []; for await (const entity of this.table.listEntities<Record<string, unknown>>({ queryOptions: { filter: `PartitionKey eq '${sessionPartitionKey}'` } })) records.push(JSON.parse(String(entity.payload)) as SessionRecord); return records; }
}

export function createSessionStore(options: SessionStoreOptions = {}) { return new SessionStore(options); }
