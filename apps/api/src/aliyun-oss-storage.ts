import OSS from "ali-oss";

interface OssStorageOptions {
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  objectPrefix?: string;
  signedUrlMinutes?: number;
  client?: Pick<OSS, "delete" | "head" | "listParts" | "listUploads" | "signatureUrl">;
}

export interface OssObjectInfo {
  contentLength?: number;
  contentType?: string;
  etag?: string;
}

export interface OssMultipartProgress {
  transferredBytes: number;
  partCount: number;
  lastProgressAt?: string;
}

function value(input: string | undefined) {
  return input?.trim() || undefined;
}

function positiveInteger(input: unknown, fallback: number) {
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function header(result: unknown, name: string) {
  const headers = (result as { res?: { headers?: Record<string, unknown> } })?.res?.headers;
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  return raw === undefined ? undefined : String(raw);
}

export class AliyunOssStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliyunOssStorageUnavailableError";
  }
}

export class AliyunOssStorage {
  private readonly client?: Pick<OSS, "delete" | "head" | "listParts" | "listUploads" | "signatureUrl">;
  private readonly prefix: string;
  private readonly signedUrlSeconds: number;
  readonly enabled: boolean;
  readonly reason?: string;

  constructor(options: OssStorageOptions = {}) {
    const accessKeyId = value(options.accessKeyId ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_ID);
    const accessKeySecret = value(options.accessKeySecret ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET);
    const securityToken = value(options.securityToken ?? process.env.ALIBABA_CLOUD_SECURITY_TOKEN);
    const region = value(options.region ?? process.env.ALIYUN_OSS_REGION);
    const bucket = value(options.bucket ?? process.env.ALIYUN_OSS_BUCKET);
    const endpoint = value(options.endpoint ?? process.env.ALIYUN_OSS_ENDPOINT);
    this.prefix = `${value(options.objectPrefix ?? process.env.ALIYUN_OSS_OBJECT_PREFIX) ?? "wwpdw/prepared"}/`;
    this.signedUrlSeconds = Math.min(
      6 * 60 * 60,
      positiveInteger(options.signedUrlMinutes ?? process.env.ALIYUN_OSS_SIGNED_URL_MINUTES, 360) * 60
    );
    const missing = [
      !accessKeyId ? "ALIBABA_CLOUD_ACCESS_KEY_ID" : undefined,
      !accessKeySecret ? "ALIBABA_CLOUD_ACCESS_KEY_SECRET" : undefined,
      !region ? "ALIYUN_OSS_REGION" : undefined,
      !bucket ? "ALIYUN_OSS_BUCKET" : undefined
    ].filter(Boolean);
    this.enabled = Boolean(options.client || missing.length === 0);
    this.reason = this.enabled ? undefined : `OSS preparation is missing ${missing.join(", ")}.`;
    this.client = options.client ?? (this.enabled ? new OSS({
      accessKeyId: accessKeyId!,
      accessKeySecret: accessKeySecret!,
      stsToken: securityToken,
      region: region!,
      bucket: bucket!,
      endpoint,
      secure: true
    }) : undefined);
  }

  private checkedObjectKey(objectKey: string) {
    const normalized = objectKey.replace(/^\/+/, "");
    if (!normalized.startsWith(this.prefix) || normalized.includes("..")) {
      throw new Error("OSS object is outside the preparation prefix.");
    }
    return normalized;
  }

  private requireClient() {
    if (!this.client) throw new AliyunOssStorageUnavailableError(this.reason ?? "OSS preparation is unavailable.");
    return this.client;
  }

  async head(objectKey: string): Promise<OssObjectInfo | undefined> {
    try {
      const result = await this.requireClient().head(this.checkedObjectKey(objectKey));
      const contentLength = positiveInteger(header(result, "content-length"), 0) || undefined;
      return {
        contentLength,
        contentType: header(result, "content-type"),
        etag: header(result, "etag")
      };
    } catch (error) {
      const status = (error as { status?: number; statusCode?: number }).status
        ?? (error as { statusCode?: number }).statusCode;
      if (status === 404 || (error as { code?: string }).code === "NoSuchKey") return undefined;
      throw error;
    }
  }

  async delete(objectKey: string) {
    await this.requireClient().delete(this.checkedObjectKey(objectKey));
  }

  async multipartProgress(objectKey: string): Promise<OssMultipartProgress | undefined> {
    const checkedObjectKey = this.checkedObjectKey(objectKey);
    const uploads = await this.requireClient().listUploads({
      prefix: checkedObjectKey,
      "max-uploads": 100
    });
    const upload = uploads.uploads
      .filter((item) => item.name === checkedObjectKey)
      .sort((left, right) => String(right.initiated).localeCompare(String(left.initiated)))[0];
    if (!upload) return undefined;

    const result = await this.requireClient().listParts(
      checkedObjectKey,
      upload.uploadId,
      { "max-parts": 1000, "part-number-marker": 0, "encoding-type": "url" }
    );
    const parts = result.parts.map((part) => ({
      size: positiveInteger((part as { Size?: unknown }).Size, 0),
      lastModified: String((part as { LastModified?: unknown }).LastModified ?? "")
    }));
    return {
      transferredBytes: parts.reduce((total, part) => total + part.size, 0),
      partCount: parts.length,
      lastProgressAt: parts.map((part) => part.lastModified).filter(Boolean).sort().at(-1)
    };
  }

  createSignedUrl(objectKey: string) {
    const expiresAt = new Date(Date.now() + this.signedUrlSeconds * 1000);
    return {
      url: this.requireClient().signatureUrl(this.checkedObjectKey(objectKey), {
        expires: this.signedUrlSeconds,
        response: { "content-disposition": "inline" }
      }),
      expiresAt: expiresAt.toISOString()
    };
  }
}
