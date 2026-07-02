import {
  errorLogFields,
  logInfo,
  logWarn,
  type ResolveResult,
  type SearchResult
} from "@wwpdw/shared";

const directFilePattern = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const textLikeContentPattern = /(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript)|\+json|\+xml)/i;
const videoContentPattern = /^video\//i;

interface SourceSnapshot {
  url: string;
  status: number;
  contentType?: string;
  body: string;
}

interface AiResolutionPayload {
  directUrl?: unknown;
  confidence?: unknown;
  reason?: unknown;
  notes?: unknown;
}

type AiApiKind = "responses" | "chat";
type AiModelPreset = keyof typeof aiModelPresets;

const aiModelPresets = {
  compass: {
    model: "qwen3.7-plus",
    lane: "balanced-a"
  },
  spark: {
    model: "qwen3.6-flash",
    lane: "fast-a"
  },
  summit: {
    model: "qwen3.7-max",
    lane: "smart-a"
  },
  harbor: {
    model: "deepseek-v4-pro",
    lane: "balanced-b"
  },
  glint: {
    model: "deepseek-v4-flash",
    lane: "fast-b"
  }
} as const;

const aiModelPresetAliases: Record<string, AiModelPreset> = {
  balanced: "compass",
  "balanced-a": "compass",
  fast: "spark",
  "fast-a": "spark",
  smart: "summit",
  "smart-a": "summit",
  pro: "summit",
  "balanced-b": "harbor",
  "fast-b": "glint"
};

function observedAt() {
  return new Date().toISOString();
}

function resultFor(input: Omit<ResolveResult, "observedAt">): ResolveResult {
  return {
    ...input,
    observedAt: observedAt()
  };
}

function envFlag(value: string | undefined, defaultValue: boolean) {
  if (!value || value.toLowerCase() === "auto") {
    return defaultValue;
  }

  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function apiKindFromEnv(value: string | undefined): AiApiKind | undefined {
  if (value === "responses" || value === "chat") {
    return value;
  }

  return undefined;
}

function normalizePreset(value: string | undefined): AiModelPreset | undefined {
  const normalized = value?.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return undefined;
  }

  if (normalized in aiModelPresets) {
    return normalized as AiModelPreset;
  }

  return aiModelPresetAliases[normalized];
}

function aiResolverConfig() {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const bailianApiKey = process.env.BAILIAN_API_KEY?.trim() ?? process.env.DASHSCOPE_API_KEY?.trim();
  const usesBailian = !openAiApiKey && Boolean(bailianApiKey);
  const apiKey = openAiApiKey ?? bailianApiKey;
  const modelPreset = normalizePreset(process.env.WWPDW_AI_RESOLVER_MODEL_PRESET) ?? (usesBailian ? "compass" : undefined);
  const presetModel = modelPreset ? aiModelPresets[modelPreset].model : undefined;
  const model = (
    process.env.WWPDW_AI_RESOLVER_MODEL ??
    process.env.OPENAI_MODEL ??
    process.env.BAILIAN_MODEL ??
    process.env.DASHSCOPE_MODEL ??
    presetModel ??
    "gpt-4.1-mini"
  ).trim();
  const enabled = envFlag(process.env.WWPDW_AI_RESOLVER_ENABLED, Boolean(apiKey));
  const explicitApiUrl = process.env.WWPDW_AI_RESOLVER_API_URL?.trim();
  const apiKind =
    apiKindFromEnv(process.env.WWPDW_AI_RESOLVER_API_KIND) ??
    (usesBailian || explicitApiUrl?.includes("/chat/completions") ? "chat" : "responses");
  const baseUrl = (
    process.env.OPENAI_BASE_URL ??
    process.env.BAILIAN_BASE_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    (usesBailian ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  const apiUrl = explicitApiUrl || `${baseUrl}/${apiKind === "chat" ? "chat/completions" : "responses"}`;
  const authHeader = (process.env.WWPDW_AI_RESOLVER_AUTH_HEADER ?? "authorization").toLowerCase();

  return {
    apiKey,
    model,
    modelPreset,
    enabled,
    apiKind,
    apiUrl,
    authHeader,
    requestTimeoutMs: numberFromEnv("WWPDW_AI_RESOLVER_TIMEOUT_MS", 25_000, 1_000, 120_000),
    fetchTimeoutMs: numberFromEnv("WWPDW_AI_RESOLVER_FETCH_TIMEOUT_MS", 10_000, 1_000, 60_000),
    fetchMaxBytes: numberFromEnv("WWPDW_AI_RESOLVER_FETCH_MAX_BYTES", 120_000, 4_096, 1_000_000)
  };
}

function cleanText(value: unknown, maxLength = 600) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : undefined;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isKnownMediaUrl(value: string) {
  return directFilePattern.test(value) || notionHostedFilePattern.test(value);
}

function responseText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object"
    ? choices[0] as Record<string, unknown>
    : undefined;
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? firstChoice.message as Record<string, unknown>
    : undefined;
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = item && typeof item === "object"
      ? (item as Record<string, unknown>).content
      : undefined;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const text = (contentItem as Record<string, unknown>).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }

  return parts.join("\n").trim() || undefined;
}

function parseJsonObject(text: string): AiResolutionPayload | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" ? parsed as AiResolutionPayload : undefined;
  } catch {
    return undefined;
  }
}

async function readResponsePrefix(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }

      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;

      if (value.byteLength > remaining) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchSourceSnapshot(sourceUrl: string): Promise<SourceSnapshot | undefined> {
  if (!isHttpUrl(sourceUrl)) {
    return undefined;
  }

  const config = aiResolverConfig();
  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": "wwpdw-ai-resolver/0.1"
      }
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    if (contentType && !textLikeContentPattern.test(contentType)) {
      return {
        url: response.url,
        status: response.status,
        contentType,
        body: ""
      };
    }

    return {
      url: response.url,
      status: response.status,
      contentType,
      body: await readResponsePrefix(response, config.fetchMaxBytes)
    };
  } catch (error) {
    logWarn("worker.ai_resolver.snapshot_failed", {
      sourceUrl,
      ...errorLogFields(error)
    });
    return undefined;
  }
}

async function candidateLooksPlayable(url: string) {
  if (!isHttpUrl(url)) {
    return false;
  }

  if (isKnownMediaUrl(url)) {
    return true;
  }

  const config = aiResolverConfig();
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: {
        "User-Agent": "wwpdw-ai-resolver/0.1"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    return response.ok && (
      videoContentPattern.test(contentType) ||
      isKnownMediaUrl(response.url) ||
      directFilePattern.test(contentDisposition) ||
      (contentType.includes("application/octet-stream") && Number.isFinite(contentLength) && contentLength > 0)
    );
  } catch {
    return false;
  }
}

function authHeaders(config: ReturnType<typeof aiResolverConfig>): Record<string, string> {
  if (config.authHeader === "api-key") {
    return { "api-key": config.apiKey ?? "" };
  }

  return { Authorization: `Bearer ${config.apiKey}` };
}

async function askModel(input: {
  asset: SearchResult;
  ruleResult: ResolveResult;
  snapshot?: SourceSnapshot;
}) {
  const config = aiResolverConfig();
  const systemPrompt = [
    "You resolve private media catalog entries into direct playable video URLs.",
    "Return JSON only with directUrl, confidence, reason, and notes.",
    "Only set directUrl when it is an http(s) URL that points directly to a video file or signed video object.",
    "If the provided page requires browser automation, login, JavaScript execution, or a network inspector, leave directUrl empty."
  ].join(" ");
  const userPrompt = JSON.stringify({
    asset: {
      assetKey: input.asset.assetKey,
      title: input.asset.title,
      source: input.asset.source,
      sourceUrl: input.asset.sourceUrl,
      sourcePageId: input.asset.sourcePageId,
      sourceBreadcrumb: input.asset.sourceBreadcrumb,
      summary: input.asset.summary
    },
    ruleResult: input.ruleResult,
    fetchedSource: input.snapshot
  });
  const body = config.apiKind === "chat"
    ? {
      model: config.model,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    }
    : {
      model: config.model,
      store: false,
      max_output_tokens: 500,
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    };

  const response = await fetch(config.apiUrl, {
    method: "POST",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI resolver request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const payload = await response.json() as unknown;
  const text = responseText(payload);
  return text ? parseJsonObject(text) : undefined;
}

export async function resolveWithAiFallback(
  asset: SearchResult,
  ruleResult: ResolveResult
): Promise<ResolveResult | undefined> {
  const config = aiResolverConfig();
  if (!config.enabled) {
    return undefined;
  }

  if (!config.apiKey) {
    return resultFor({
      kind: "needs_ai",
      layer: "ai",
      confidence: 0,
      url: ruleResult.url,
      reason: "AI resolver is enabled but OPENAI_API_KEY is not configured."
    });
  }

  const startedAt = Date.now();
  try {
    const snapshot = await fetchSourceSnapshot(asset.sourceUrl);
    const payload = await askModel({ asset, ruleResult, snapshot });
    const directUrl = cleanText(payload?.directUrl, 8_000);
    const confidence = typeof payload?.confidence === "number"
      ? Math.min(1, Math.max(0, payload.confidence))
      : 0.4;
    const reason = cleanText(payload?.reason);
    const notes = cleanText(payload?.notes, 1_000);

    if (directUrl && await candidateLooksPlayable(directUrl)) {
      logInfo("worker.ai_resolver.resolved", {
        assetKey: asset.assetKey,
        confidence,
        durationMs: Date.now() - startedAt
      });
      return resultFor({
        kind: "direct_file",
        layer: "ai",
        confidence,
        url: directUrl,
        reason,
        notes
      });
    }

    return resultFor({
      kind: "needs_browser",
      layer: "ai",
      confidence,
      url: asset.sourceUrl,
      reason: reason ?? "AI resolver did not find a validated direct media URL.",
      notes
    });
  } catch (error) {
    logWarn("worker.ai_resolver.failed", {
      assetKey: asset.assetKey,
      durationMs: Date.now() - startedAt,
      ...errorLogFields(error)
    });
    return resultFor({
      kind: "needs_ai",
      layer: "ai",
      confidence: 0,
      url: ruleResult.url,
      reason: error instanceof Error ? error.message : "AI resolver failed."
    });
  }
}
