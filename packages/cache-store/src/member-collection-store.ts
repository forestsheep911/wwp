import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

export class CollectionConflict extends Error {}
export interface CollectionDocumentStore {
  read<T>(key: string): Promise<{ value: T; etag: string } | undefined>;
  write<T>(key: string, value: T, etag?: string): Promise<void>;
}
const safeKey = (key: string) => createHash("sha256").update(key).digest("hex");

export class LocalCollectionDocumentStore implements CollectionDocumentStore {
  constructor(private readonly root: string) {}
  async read<T>(key: string) {
    try {
      const raw = await readFile(path.join(this.root, safeKey(key) + ".json"), "utf8");
      return { value: JSON.parse(raw) as T, etag: createHash("sha256").update(raw).digest("hex") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async write<T>(key: string, value: T, etag?: string) {
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, safeKey(key) + ".json");
    let lock;
    try { lock = await open(target + ".lock", "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CollectionConflict("片单正在更新，请刷新后重试。");
      throw error;
    }
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      if ((await this.read(key))?.etag !== etag) throw new CollectionConflict("片单已在其他设备更新，请重新预览。");
      await writeFile(temporary, JSON.stringify(value), "utf8");
      await rename(temporary, target);
    } finally {
      await lock.close();
      await unlink(target + ".lock");
      await unlink(temporary).catch(() => {});
    }
  }
}

export class AzureCollectionDocumentStore implements CollectionDocumentStore {
  private readonly container;
  private ready?: Promise<unknown>;
  constructor() {
    const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const service = connection ? BlobServiceClient.fromConnectionString(connection) : new BlobServiceClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "stwwcachee9219db7"}.blob.core.windows.net`, new DefaultAzureCredential()
    );
    // Dedicated private container. Never generate public or SAS URLs for these documents.
    this.container = service.getContainerClient("member-collections");
  }
  private async ensureReady() {
    this.ready ??= this.container.createIfNotExists().catch(error => { this.ready = undefined; throw error; });
    await this.ready;
  }
  async read<T>(key: string) {
    await this.ensureReady();
    try {
      const response = await this.container.getBlobClient(safeKey(key) + ".json").download();
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody!) chunks.push(Buffer.from(chunk));
      return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as T, etag: response.etag! };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return undefined;
      throw error;
    }
  }
  async write<T>(key: string, value: T, etag?: string) {
    await this.ensureReady();
    try {
      await this.container.getBlockBlobClient(safeKey(key) + ".json").uploadData(Buffer.from(JSON.stringify(value)), {
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json", blobCacheControl: "private, no-store" }
      });
    } catch (error) {
      if ([409, 412].includes((error as { statusCode?: number }).statusCode ?? 0)) throw new CollectionConflict("片单已在其他设备更新，请重新预览。");
      throw error;
    }
  }
}
export function createCollectionDocumentStore(): CollectionDocumentStore {
  return (process.env.WWPDW_AUTH_BACKEND ?? process.env.CACHE_BACKEND) === "azure"
    ? new AzureCollectionDocumentStore()
    : new LocalCollectionDocumentStore(path.resolve(process.env.LOCAL_DATA_DIR ?? ".local-data", "member-collections"));
}
