import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  AdminLoginAuditEntry,
  MovieRequestEntry,
  MovieRequestStatus,
  MemberCreditCharge,
  MemberCreditLimitReason,
  MemberCreditSummary,
  MemberCreditUsageEntry,
  CreateMemberCodeRequest,
  GeneratedMemberAccessCode,
  MemberAccessCode,
  RegisterMemberRequest
} from "@wwpdw/shared";

type AccessBackend = "local" | "azure";

interface LocalAccessState {
  codes: Record<string, StoredMemberCode>;
  audit?: AdminLoginAuditEntry[];
  movieRequests?: StoredMovieRequest[];
}

interface StoredMemberCode {
  id: string;
  name: string;
  codeHash: string;
  codePreview: string;
  createdAt: string;
  expiresAt: string;
  creditBalance?: number;
  creditLimit?: number;
  creditsUsed?: number;
  usage?: StoredMemberCreditUsage[];
  revokedAt?: string;
  lastUsedAt?: string;
}

interface StoredMemberCreditUsage {
  id: string;
  at: string;
  credits: number;
  reason: "cache_reserved";
  assetKey: string;
  title: string;
  requestId?: string;
}

interface StoredMovieRequest {
  id: string;
  text: string;
  status: MovieRequestStatus;
  requestedAt: string;
  updatedAt: string;
  requestedByMemberId?: string;
  requestedByMemberName?: string;
}

type PayloadEntity = {
  partitionKey: string;
  rowKey: string;
  codeHash?: string;
  status?: string;
  payload: string;
};

const defaultAccountName = "stwwcachee9219db7";
const defaultMemberTableName = "membercodes";
const memberCreditUnitSymbol = "🍀";
const usageRetentionMs = 90 * 24 * 60 * 60 * 1000;
const noExpiryAt = "9999-12-31T23:59:59.999Z";
const loginAuditRetention = 500;
const movieRequestPartitionKey = "movie-request";
const movieRequestStatuses: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];

function backend(): AccessBackend {
  return process.env.CACHE_BACKEND === "azure" ? "azure" : "local";
}

function localStatePath() {
  const root = process.env.WWPDW_LOCAL_DATA_DIR ?? ".local-data";
  return path.join(root, "access-state.json");
}

function tableName() {
  return process.env.AZURE_STORAGE_MEMBER_TABLE ?? defaultMemberTableName;
}

function accountName() {
  return process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName;
}

function hashCode(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function codePreview(code: string) {
  return `${code.slice(0, 4)}...${code.slice(-2)}`;
}

function createRawMemberCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(12);
    const token = Array.from(bytes)
      .map((byte) => alphabet[byte % alphabet.length])
      .join("");
    if (/[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
      return token;
    }
  }

  return `A${Array.from(randomBytes(10)).map((byte) => alphabet[byte % alphabet.length]).join("")}1`;
}

function positiveInt(value: unknown, fallback: number, options: { min?: number; max?: number } = {}) {
  const raw = Number(value);
  const min = options.min ?? 0;
  const max = options.max ?? 10000;
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function defaultCredits() {
  return positiveInt(process.env.MEMBER_DEFAULT_CREDITS, 20, { min: 0, max: 10000 });
}

function usageEvents(code: StoredMemberCode) {
  return code.usage ?? [];
}

function movieRequestStatus(value: unknown): MovieRequestStatus {
  return movieRequestStatuses.includes(value as MovieRequestStatus) ? value as MovieRequestStatus : "new";
}

function usageCredits(events: StoredMemberCreditUsage[]) {
  return events.reduce((total, event) => total + Math.max(0, event.credits), 0);
}

function pruneUsage(code: StoredMemberCode, now = new Date()) {
  const cutoff = now.getTime() - usageRetentionMs;
  code.usage = usageEvents(code).filter((event) => {
    const at = new Date(event.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
}

function prepareStoredCode(code: StoredMemberCode, now = new Date()) {
  code.usage = usageEvents(code);
  if (code.creditBalance === undefined) {
    const legacyLimit = positiveInt(code.creditLimit, defaultCredits(), { min: 0, max: 10000 });
    const legacyUsed = positiveInt(code.creditsUsed, usageCredits(code.usage), { min: 0, max: 1000000 });
    code.creditBalance = Math.max(0, legacyLimit - legacyUsed);
  }
  code.creditBalance = positiveInt(code.creditBalance, defaultCredits(), { min: 0, max: 10000 });
  pruneUsage(code, now);
  return code;
}

function creditSummary(code: StoredMemberCode, now = new Date()): MemberCreditSummary {
  const prepared = prepareStoredCode(code, now);
  return {
    unit: "clover",
    unitSymbol: memberCreditUnitSymbol,
    remaining: prepared.creditBalance ?? 0
  };
}

function creditUsageList(code: StoredMemberCode, limit: number): MemberCreditUsageList {
  prepareStoredCode(code);
  const boundedLimit = positiveInt(limit, 50, { min: 1, max: 200 });
  const entries = usageEvents(code)
    .slice()
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, boundedLimit)
    .map((event) => ({
      id: event.id,
      credits: event.credits,
      reason: event.reason,
      assetKey: event.assetKey,
      title: event.title,
      chargedAt: event.at,
      requestId: event.requestId
    }));
  return {
    code: publicCode(code),
    entries
  };
}

function memberCreditDenial(summary: MemberCreditSummary, credits: number): MemberCreditLimitReason | undefined {
  if (summary.remaining < credits) {
    return "balance";
  }

  return undefined;
}

function memberName(value: string) {
  return value.trim().slice(0, 80) || "Family member";
}

function storedMemberCode(input: { name: string; rawCode: string; credits?: number }) {
  const now = new Date().toISOString();
  const stored: StoredMemberCode = {
    id: randomUUID(),
    name: memberName(input.name),
    codeHash: hashCode(input.rawCode),
    codePreview: codePreview(input.rawCode),
    createdAt: now,
    expiresAt: noExpiryAt,
    creditBalance: positiveInt(input.credits, defaultCredits(), { min: 0, max: 10000 }),
    usage: []
  };
  return stored;
}

function storedMovieRequest(input: CreateMovieRequestInput): StoredMovieRequest {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    text: input.text.trim().slice(0, 2000),
    status: "new",
    requestedAt: now,
    updatedAt: now,
    requestedByMemberId: input.memberId,
    requestedByMemberName: input.memberName
  };
}

function publicMovieRequest(request: StoredMovieRequest): MovieRequestEntry {
  const requestedAt = request.requestedAt || request.updatedAt || new Date(0).toISOString();
  return {
    id: request.id,
    text: request.text,
    status: movieRequestStatus(request.status),
    requestedAt,
    updatedAt: request.updatedAt || requestedAt,
    requestedByMemberId: request.requestedByMemberId,
    requestedByMemberName: request.requestedByMemberName
  };
}

function listMovieRequestEntries(requests: StoredMovieRequest[], input: ListMovieRequestsInput) {
  const boundedLimit = positiveInt(input.limit, 50, { min: 1, max: 200 });
  return requests
    .filter((request) => !input.memberId || request.requestedByMemberId === input.memberId)
    .map(publicMovieRequest)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    .slice(0, boundedLimit);
}

function setCreditsOnStoredCode(code: StoredMemberCode, credits: number) {
  prepareStoredCode(code);
  code.creditBalance = positiveInt(credits, 0, { min: 0, max: 10000 });
  return publicCode(code);
}

function chargeStoredCode(code: StoredMemberCode, input: ChargeMemberCreditsInput): MemberCreditChargeResult {
  const now = new Date();
  const credits = positiveInt(input.credits, 1, { min: 1, max: 10000 });
  prepareStoredCode(code, now);
  const summary = creditSummary(code, now);
  const denial = memberCreditDenial(summary, credits);
  if (denial) {
    return {
      ok: false,
      code: publicCode(code),
      reason: denial
    };
  }

  const charge: MemberCreditCharge = {
    credits,
    reason: "cache_reserved",
    assetKey: input.assetKey,
    title: input.title,
    chargedAt: now.toISOString()
  };
  const usage: StoredMemberCreditUsage = {
    id: randomUUID(),
    at: charge.chargedAt,
    credits,
    reason: charge.reason,
    assetKey: input.assetKey,
    title: input.title,
    requestId: input.requestId
  };
  code.usage = [usage, ...usageEvents(code)];
  code.creditBalance = Math.max(0, (code.creditBalance ?? 0) - credits);
  pruneUsage(code, now);

  return {
    ok: true,
    code: publicCode(code),
    charge
  };
}

function statusFor(code: StoredMemberCode): MemberAccessCode["status"] {
  if (code.revokedAt) {
    return "revoked";
  }

  return "active";
}

function publicCode(code: StoredMemberCode): MemberAccessCode {
  return {
    id: code.id,
    name: code.name,
    codePreview: code.codePreview,
    createdAt: code.createdAt,
    expiresAt: code.expiresAt,
    status: statusFor(code),
    lastUsedAt: code.lastUsedAt,
    credits: creditSummary(code)
  };
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function deserialize<T>(entity: Pick<PayloadEntity, "payload">) {
  return JSON.parse(entity.payload) as T;
}

function normalizeState(state: LocalAccessState): LocalAccessState {
  state.audit ??= [];
  state.movieRequests ??= [];
  return state;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface AccessIdentity {
  role: "admin" | "member";
  memberId?: string;
  memberName?: string;
  credits?: MemberCreditSummary;
}

export type MemberCreditChargeResult =
  | {
    ok: true;
    code: MemberAccessCode;
    charge: MemberCreditCharge;
  }
  | {
    ok: false;
    code: MemberAccessCode;
    reason: MemberCreditLimitReason;
  };

export type MemberRegistrationResult =
  | {
    ok: true;
    code: MemberAccessCode;
  }
  | {
    ok: false;
    reason: "duplicate";
  };

export type MemberPasscodeUpdateResult =
  | {
    ok: true;
    code: MemberAccessCode;
  }
  | {
    ok: false;
    reason: "not_found" | "duplicate" | "invalid_current";
  };

export interface MemberCreditUsageList {
  code: MemberAccessCode;
  entries: MemberCreditUsageEntry[];
}

export interface ChargeMemberCreditsInput {
  credits: number;
  assetKey: string;
  title: string;
  requestId?: string;
}

export interface CreateMovieRequestInput {
  text: string;
  memberId: string;
  memberName?: string;
}

export interface ListMovieRequestsInput {
  memberId?: string;
  limit: number;
}

export interface AccessStore {
  readonly backend: AccessBackend;
  readonly description: string;
  createMemberCode(input: CreateMemberCodeRequest): Promise<GeneratedMemberAccessCode>;
  registerMember(input: RegisterMemberRequest): Promise<MemberRegistrationResult>;
  listMemberCodes(): Promise<MemberAccessCode[]>;
  setMemberCredits(id: string, credits: number): Promise<MemberAccessCode | undefined>;
  setMemberPasscode(id: string, passcode: string): Promise<MemberPasscodeUpdateResult>;
  changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string): Promise<MemberPasscodeUpdateResult>;
  listMemberCreditUsage(id: string, limit: number): Promise<MemberCreditUsageList | undefined>;
  chargeMemberCredits(id: string, input: ChargeMemberCreditsInput): Promise<MemberCreditChargeResult | undefined>;
  createMovieRequest(input: CreateMovieRequestInput): Promise<MovieRequestEntry>;
  listMovieRequests(input: ListMovieRequestsInput): Promise<MovieRequestEntry[]>;
  updateMovieRequestStatus(id: string, status: MovieRequestStatus): Promise<MovieRequestEntry | undefined>;
  recordLoginAudit(entry: AdminLoginAuditEntry): Promise<void>;
  listLoginAudit(limit: number): Promise<AdminLoginAuditEntry[]>;
  revokeMemberCode(id: string): Promise<MemberAccessCode | undefined>;
  deleteMemberCode(id: string): Promise<boolean>;
  findMemberByCode(code: string): Promise<AccessIdentity | undefined>;
  getHealth(): Promise<Record<string, unknown>>;
}

export function createAccessStore(): AccessStore {
  return backend() === "azure" ? new AzureAccessStore() : new LocalAccessStore(localStatePath());
}

class LocalAccessStore implements AccessStore {
  readonly backend = "local" as const;
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getHealth() {
    return {
      backend: this.backend,
      statePath: this.statePath
    };
  }

  async createMemberCode(input: CreateMemberCodeRequest) {
    return this.updateState((state) => {
      let rawCode = createRawMemberCode();
      for (let attempt = 0; attempt < 10 && this.codeHashExists(state, hashCode(rawCode)); attempt += 1) {
        rawCode = createRawMemberCode();
      }
      const stored = storedMemberCode({
        name: input.name,
        rawCode,
        credits: input.credits
      });
      state.codes[stored.id] = stored;
      return {
        ...publicCode(stored),
        code: rawCode
      };
    });
  }

  async registerMember(input: RegisterMemberRequest) {
    return this.updateState((state) => {
      const codeHash = hashCode(input.passcode);
      if (this.codeHashExists(state, codeHash)) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      const stored = storedMemberCode({
        name: input.name,
        rawCode: input.passcode
      });
      state.codes[stored.id] = stored;
      return {
        ok: true as const,
        code: publicCode(stored)
      };
    });
  }

  async listMemberCodes() {
    const state = await this.readState();
    return Object.values(state.codes)
      .map(publicCode)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async setMemberCredits(id: string, credits: number) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      return setCreditsOnStoredCode(code, credits);
    });
  }

  async setMemberPasscode(id: string, passcode: string) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return {
          ok: false as const,
          reason: "not_found" as const
        };
      }

      const codeHash = hashCode(passcode);
      if (this.codeHashExists(state, codeHash, id)) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      code.codeHash = codeHash;
      code.codePreview = codePreview(passcode);
      return {
        ok: true as const,
        code: publicCode(code)
      };
    });
  }

  async changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return {
          ok: false as const,
          reason: "not_found" as const
        };
      }

      if (code.codeHash !== hashCode(currentPasscode)) {
        return {
          ok: false as const,
          reason: "invalid_current" as const
        };
      }

      const newCodeHash = hashCode(newPasscode);
      if (this.codeHashExists(state, newCodeHash, id)) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      code.codeHash = newCodeHash;
      code.codePreview = codePreview(newPasscode);
      return {
        ok: true as const,
        code: publicCode(code)
      };
    });
  }

  async listMemberCreditUsage(id: string, limit: number) {
    const state = await this.readState();
    const code = state.codes[id];
    return code ? creditUsageList(code, limit) : undefined;
  }

  async chargeMemberCredits(id: string, input: ChargeMemberCreditsInput) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      return chargeStoredCode(code, input);
    });
  }

  async createMovieRequest(input: CreateMovieRequestInput) {
    return this.updateState((state) => {
      const request = storedMovieRequest(input);
      state.movieRequests = [request, ...(state.movieRequests ?? [])].slice(0, 1000);
      return publicMovieRequest(request);
    });
  }

  async listMovieRequests(input: ListMovieRequestsInput) {
    const state = await this.readState();
    return listMovieRequestEntries(state.movieRequests ?? [], input);
  }

  async updateMovieRequestStatus(id: string, status: MovieRequestStatus) {
    return this.updateState((state) => {
      const request = (state.movieRequests ?? []).find((item) => item.id === id);
      if (!request) {
        return undefined;
      }

      request.status = movieRequestStatus(status);
      request.updatedAt = new Date().toISOString();
      return publicMovieRequest(request);
    });
  }

  async revokeMemberCode(id: string) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      code.revokedAt = new Date().toISOString();
      return publicCode(code);
    });
  }

  async recordLoginAudit(entry: AdminLoginAuditEntry) {
    await this.updateState((state) => {
      state.audit = [entry, ...(state.audit ?? [])].slice(0, loginAuditRetention);
    });
  }

  async listLoginAudit(limit: number) {
    const state = await this.readState();
    return (state.audit ?? [])
      .slice()
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit);
  }

  async deleteMemberCode(id: string) {
    return this.updateState((state) => {
      if (!state.codes[id]) {
        return false;
      }

      delete state.codes[id];
      return true;
    });
  }

  async findMemberByCode(code: string) {
    const state = await this.readState();
    const codeHash = hashCode(code);
    const match = Object.values(state.codes).find((item) => item.codeHash === codeHash);
    if (!match || statusFor(match) !== "active") {
      return undefined;
    }

    match.lastUsedAt = new Date().toISOString();
    await this.writeState(state);
    return {
      role: "member" as const,
      memberId: match.id,
      memberName: match.name,
      credits: creditSummary(match)
    };
  }

  private async readState(): Promise<LocalAccessState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as LocalAccessState);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return normalizeState({ codes: {} });
      }
      throw error;
    }
  }

  private codeHashExists(state: LocalAccessState, codeHash: string, exceptId?: string) {
    return Object.values(state.codes).some((item) => item.id !== exceptId && item.codeHash === codeHash);
  }

  private async writeState(state: LocalAccessState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(tempPath, this.statePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) {
          throw error;
        }
        await sleep(50 * (attempt + 1));
      }
    }
  }

  private async updateState<T>(mutator: (state: LocalAccessState) => T | Promise<T>) {
    const state = await this.readState();
    const result = await mutator(state);
    await this.writeState(state);
    return result;
  }
}

class AzureAccessStore implements AccessStore {
  readonly backend = "azure" as const;
  readonly description: string;

  private readonly table = new TableClient(
    `https://${accountName()}.table.core.windows.net`,
    tableName(),
    new DefaultAzureCredential()
  );
  private ready?: Promise<void>;

  constructor() {
    this.description = `azure:${accountName()}/${tableName()}`;
  }

  async getHealth() {
    await this.ensureReady();
    return {
      backend: this.backend,
      accountName: accountName(),
      tableName: tableName()
    };
  }

  async createMemberCode(input: CreateMemberCodeRequest) {
    await this.ensureReady();
    let rawCode = createRawMemberCode();
    for (let attempt = 0; attempt < 10 && await this.getStoredByCodeHash(hashCode(rawCode)); attempt += 1) {
      rawCode = createRawMemberCode();
    }
    const stored = storedMemberCode({
      name: input.name,
      rawCode,
      credits: input.credits
    });
    await this.save(stored);
    return {
      ...publicCode(stored),
      code: rawCode
    };
  }

  async registerMember(input: RegisterMemberRequest) {
    await this.ensureReady();
    if (await this.getStoredByCodeHash(hashCode(input.passcode))) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    const stored = storedMemberCode({
      name: input.name,
      rawCode: input.passcode
    });
    await this.save(stored);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async listMemberCodes() {
    await this.ensureReady();
    const codes: MemberAccessCode[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'member'"
      }
    });

    for await (const entity of entities) {
      codes.push(publicCode(deserialize<StoredMemberCode>(entity)));
    }

    return codes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async setMemberCredits(id: string, credits: number) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    const code = setCreditsOnStoredCode(stored, credits);
    await this.save(stored);
    return code;
  }

  async setMemberPasscode(id: string, passcode: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return {
        ok: false as const,
        reason: "not_found" as const
      };
    }

    const codeHash = hashCode(passcode);
    const duplicate = await this.getStoredByCodeHash(codeHash);
    if (duplicate && duplicate.stored.id !== id) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    stored.codeHash = codeHash;
    stored.codePreview = codePreview(passcode);
    await this.save(stored);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return {
        ok: false as const,
        reason: "not_found" as const
      };
    }

    if (stored.codeHash !== hashCode(currentPasscode)) {
      return {
        ok: false as const,
        reason: "invalid_current" as const
      };
    }

    const newCodeHash = hashCode(newPasscode);
    const duplicate = await this.getStoredByCodeHash(newCodeHash);
    if (duplicate && duplicate.stored.id !== id) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    stored.codeHash = newCodeHash;
    stored.codePreview = codePreview(newPasscode);
    await this.save(stored);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async listMemberCreditUsage(id: string, limit: number) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    return stored ? creditUsageList(stored, limit) : undefined;
  }

  async chargeMemberCredits(id: string, input: ChargeMemberCreditsInput) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    const result = chargeStoredCode(stored, input);
    await this.save(stored);
    return result;
  }

  async createMovieRequest(input: CreateMovieRequestInput) {
    await this.ensureReady();
    const request = storedMovieRequest(input);
    await this.saveMovieRequest(request);
    return publicMovieRequest(request);
  }

  async listMovieRequests(input: ListMovieRequestsInput) {
    await this.ensureReady();
    const requests: StoredMovieRequest[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${movieRequestPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      requests.push(deserialize<StoredMovieRequest>(entity));
    }

    return listMovieRequestEntries(requests, input);
  }

  async updateMovieRequestStatus(id: string, status: MovieRequestStatus) {
    await this.ensureReady();
    const request = await this.getMovieRequest(id);
    if (!request) {
      return undefined;
    }

    request.status = movieRequestStatus(status);
    request.updatedAt = new Date().toISOString();
    await this.saveMovieRequest(request);
    return publicMovieRequest(request);
  }

  async revokeMemberCode(id: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    stored.revokedAt = new Date().toISOString();
    await this.save(stored);
    return publicCode(stored);
  }

  async recordLoginAudit(entry: AdminLoginAuditEntry) {
    await this.ensureReady();
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: "audit",
        rowKey: `${entry.at}-${entry.id}`,
        status: entry.role,
        payload: serialize(entry)
      },
      "Replace"
    );
  }

  async listLoginAudit(limit: number) {
    await this.ensureReady();
    const events: AdminLoginAuditEntry[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'audit'"
      }
    });

    for await (const entity of entities) {
      events.push(deserialize<AdminLoginAuditEntry>(entity));
    }

    return events
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit);
  }

  async deleteMemberCode(id: string) {
    await this.ensureReady();
    try {
      await this.table.deleteEntity("member", id);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async findMemberByCode(code: string) {
    await this.ensureReady();
    const codeHash = hashCode(code);
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq 'member' and codeHash eq '${codeHash}'`
      }
    });

    for await (const entity of entities) {
      const stored = deserialize<StoredMemberCode>(entity);
      if (statusFor(stored) !== "active") {
        return undefined;
      }

      stored.lastUsedAt = new Date().toISOString();
      await this.save(stored);
      return {
        role: "member" as const,
        memberId: stored.id,
        memberName: stored.name,
        credits: creditSummary(stored)
      };
    }

    return undefined;
  }

  private async ensureReady() {
    this.ready ??= this.createTableIfMissing();
    await this.ready;
  }

  private async createTableIfMissing() {
    try {
      await this.table.createTable();
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
  }

  private async getStored(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>("member", id);
      return deserialize<StoredMemberCode>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async getStoredByCodeHash(codeHash: string) {
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq 'member' and codeHash eq '${codeHash}'`
      }
    });

    for await (const entity of entities) {
      return {
        id: entity.rowKey,
        stored: deserialize<StoredMemberCode>(entity)
      };
    }

    return undefined;
  }

  private async save(code: StoredMemberCode) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: "member",
        rowKey: code.id,
        codeHash: code.codeHash,
        status: statusFor(code),
        payload: serialize(code)
      },
      "Replace"
    );
  }

  private async getMovieRequest(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>(movieRequestPartitionKey, id);
      return deserialize<StoredMovieRequest>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async saveMovieRequest(request: StoredMovieRequest) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: movieRequestPartitionKey,
        rowKey: request.id,
        status: movieRequestStatus(request.status),
        payload: serialize(request)
      },
      "Replace"
    );
  }
}
