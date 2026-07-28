import OSS from "ali-oss";

const defaultObjectKey = "wwpdw/poc/browser-inline-range.mp4";
const maximumSignedUrlMinutes = 60;

interface OssSigningClient {
  signatureUrl(
    objectKey: string,
    options: {
      expires: number;
      response: { "content-disposition": string };
    }
  ): string;
}

interface OssClientOptions {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint?: string;
  region: string;
  secure: boolean;
  stsToken?: string;
}

type OssClientFactory = (options: OssClientOptions) => OssSigningClient;

export interface AliyunOssPocStatus {
  enabled: boolean;
  expiresMinutes: number;
  objectKey?: string;
  reason?: string;
}

function envValue(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() || undefined;
}

function signedUrlMinutes(environment: NodeJS.ProcessEnv) {
  const parsed = Number(envValue(environment, "ALIYUN_OSS_SIGNED_URL_MINUTES") ?? 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(maximumSignedUrlMinutes, Math.max(1, Math.floor(parsed)));
}

export class AliyunOssPocUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliyunOssPocUnavailableError";
  }
}

export function createAliyunOssPoc(
  environment: NodeJS.ProcessEnv = process.env,
  clientFactory: OssClientFactory = (options) => new OSS(options)
) {
  const explicitlyEnabled = envValue(environment, "ALIYUN_OSS_POC_ENABLED") === "true";
  const accessKeyId = envValue(environment, "ALIBABA_CLOUD_ACCESS_KEY_ID");
  const accessKeySecret = envValue(environment, "ALIBABA_CLOUD_ACCESS_KEY_SECRET");
  const region = envValue(environment, "ALIYUN_OSS_REGION");
  const bucket = envValue(environment, "ALIYUN_OSS_BUCKET");
  const endpoint = envValue(environment, "ALIYUN_OSS_ENDPOINT");
  const stsToken = envValue(environment, "ALIBABA_CLOUD_SECURITY_TOKEN");
  const objectKey = envValue(environment, "ALIYUN_OSS_POC_OBJECT_KEY") ?? defaultObjectKey;
  const expiresMinutes = signedUrlMinutes(environment);
  const missing = [
    !accessKeyId ? "ALIBABA_CLOUD_ACCESS_KEY_ID" : undefined,
    !accessKeySecret ? "ALIBABA_CLOUD_ACCESS_KEY_SECRET" : undefined,
    !region ? "ALIYUN_OSS_REGION" : undefined,
    !bucket ? "ALIYUN_OSS_BUCKET" : undefined
  ].filter((value): value is string => Boolean(value));
  const enabled = explicitlyEnabled && missing.length === 0;
  let client: OssSigningClient | undefined;

  function status(): AliyunOssPocStatus {
    if (!explicitlyEnabled) {
      return {
        enabled: false,
        expiresMinutes,
        reason: "OSS playback POC is disabled."
      };
    }
    if (missing.length > 0) {
      return {
        enabled: false,
        expiresMinutes,
        reason: `OSS playback POC is missing configuration: ${missing.join(", ")}.`
      };
    }
    return {
      enabled: true,
      expiresMinutes,
      objectKey
    };
  }

  function createSignedUrl() {
    const currentStatus = status();
    if (!enabled || !accessKeyId || !accessKeySecret || !region || !bucket) {
      throw new AliyunOssPocUnavailableError(
        currentStatus.reason ?? "OSS playback POC is not configured."
      );
    }
    client ??= clientFactory({
      accessKeyId,
      accessKeySecret,
      bucket,
      endpoint,
      region,
      secure: true,
      stsToken
    });
    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000);
    return {
      expiresAt: expiresAt.toISOString(),
      url: client.signatureUrl(objectKey, {
        expires: expiresMinutes * 60,
        response: { "content-disposition": "inline" }
      })
    };
  }

  return { createSignedUrl, status };
}
