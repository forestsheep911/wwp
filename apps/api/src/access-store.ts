import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  CreateMemberCodeRequest,
  GeneratedMemberAccessCode,
  MemberAccessCode
} from "@wwpdw/shared";

type AccessBackend = "local" | "azure";

interface LocalAccessState {
  codes: Record<string, StoredMemberCode>;
}

interface StoredMemberCode {
  id: string;
  name: string;
  codeHash: string;
  codePreview: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
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
  return `${code.slice(0, 8)}...${code.slice(-4)}`;
}

function createRawMemberCode() {
  const token = Array.from(randomBytes(9))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `fam-${token.slice(0, 6)}-${token.slice(6, 12)}-${token.slice(12, 18)}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function statusFor(code: StoredMemberCode): MemberAccessCode["status"] {
  if (code.revokedAt) {
    return "revoked";
  }

  if (new Date(code.expiresAt).getTime() <= Date.now()) {
    return "expired";
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
    lastUsedAt: code.lastUsedAt
  };
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function deserialize<T>(entity: Pick<PayloadEntity, "payload">) {
  return JSON.parse(entity.payload) as T;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

export interface AccessIdentity {
  role: "admin" | "member";
  memberId?: string;
  memberName?: string;
}

export interface AccessStore {
  readonly backend: AccessBackend;
  readonly description: string;
  createMemberCode(input: CreateMemberCodeRequest): Promise<GeneratedMemberAccessCode>;
  listMemberCodes(): Promise<MemberAccessCode[]>;
  revokeMemberCode(id: string): Promise<MemberAccessCode | undefined>;
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
      const rawCode = createRawMemberCode();
      const now = new Date().toISOString();
      const stored: StoredMemberCode = {
        id: randomUUID(),
        name: input.name.trim() || "Family member",
        codeHash: hashCode(rawCode),
        codePreview: codePreview(rawCode),
        createdAt: now,
        expiresAt: addDays(Math.max(1, Math.min(365, Math.floor(input.days || 30))))
      };
      state.codes[stored.id] = stored;
      return {
        ...publicCode(stored),
        code: rawCode
      };
    });
  }

  async listMemberCodes() {
    const state = await this.readState();
    return Object.values(state.codes)
      .map(publicCode)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
      memberName: match.name
    };
  }

  private async readState(): Promise<LocalAccessState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as LocalAccessState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { codes: {} };
      }
      throw error;
    }
  }

  private async writeState(state: LocalAccessState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
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
    const rawCode = createRawMemberCode();
    const now = new Date().toISOString();
    const stored: StoredMemberCode = {
      id: randomUUID(),
      name: input.name.trim() || "Family member",
      codeHash: hashCode(rawCode),
      codePreview: codePreview(rawCode),
      createdAt: now,
      expiresAt: addDays(Math.max(1, Math.min(365, Math.floor(input.days || 30))))
    };
    await this.save(stored);
    return {
      ...publicCode(stored),
      code: rawCode
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
        memberName: stored.name
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
}
