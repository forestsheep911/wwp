import type {
  MovieSummaryMode,
  MovieSummaryRequest,
  MovieSummaryResponse,
  SearchResult
} from "@wwpdw/shared";

type AiModelPreset = keyof typeof aiModelPresets;

const aiModelPresets = {
  compass: "qwen3.7-plus",
  spark: "qwen3.6-flash",
  summit: "qwen3.7-max",
  harbor: "deepseek-v4-pro",
  glint: "deepseek-v4-flash"
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

interface SummaryPayload {
  summary?: unknown;
}

export class AiSummaryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSummaryConfigError";
  }
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

function numberFromEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function summaryConfig() {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const bailianApiKey = process.env.BAILIAN_API_KEY?.trim() ?? process.env.DASHSCOPE_API_KEY?.trim();
  const usesBailian = !openAiApiKey && Boolean(bailianApiKey);
  const apiKey = openAiApiKey ?? bailianApiKey;
  const preset = normalizePreset(process.env.WWPDW_AI_SUMMARY_MODEL_PRESET) ?? "spark";
  const model = (
    process.env.WWPDW_AI_SUMMARY_MODEL ??
    aiModelPresets[preset] ??
    process.env.BAILIAN_MODEL ??
    process.env.DASHSCOPE_MODEL ??
    process.env.OPENAI_MODEL ??
    (usesBailian ? "qwen3.6-flash" : "gpt-4.1-mini")
  ).trim();
  const baseUrl = (
    process.env.WWPDW_AI_SUMMARY_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.BAILIAN_BASE_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    (usesBailian ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");

  return {
    apiKey,
    model,
    apiUrl: process.env.WWPDW_AI_SUMMARY_API_URL?.trim() || `${baseUrl}/chat/completions`,
    authHeader: (process.env.WWPDW_AI_SUMMARY_AUTH_HEADER ?? "authorization").toLowerCase(),
    timeoutMs: numberFromEnv("WWPDW_AI_SUMMARY_TIMEOUT_MS", 20_000, 1_000, 120_000)
  };
}

function authHeaders(config: ReturnType<typeof summaryConfig>): Record<string, string> {
  if (config.authHeader === "api-key") {
    return { "api-key": config.apiKey ?? "" };
  }

  return { Authorization: `Bearer ${config.apiKey}` };
}

function compactResult(result: SearchResult) {
  const metadata = result.metadata;
  const work = metadata?.work;
  const externalIds = metadata?.external?.omdb?.imdbId
    ? { ...metadata?.externalIds, imdb: metadata.external.omdb.imdbId }
    : metadata?.externalIds;
  return {
    title: result.title,
    sourceSummary: result.summary,
    sourceBreadcrumb: result.sourceBreadcrumb,
    durationLabel: result.durationLabel,
    metadata: {
      kind: metadata?.kind ?? work?.kind ?? metadata?.type,
      year: metadata?.year ?? metadata?.release?.year ?? work?.release?.year,
      releaseDate: metadata?.releaseDate ?? metadata?.release?.date ?? work?.release?.date,
      genres: metadata?.genres ?? work?.genres,
      countries: work?.countries,
      directors: metadata?.directors ?? work?.credits
        ?.filter((credit) => credit.department === "directing")
        .map((credit) => credit.name),
      people: metadata?.people,
      description: metadata?.description ?? metadata?.info ?? metadata?.external?.omdb?.plot,
      titles: metadata?.titles?.map((title) => title.title) ?? work?.titles.map((title) => title.title),
      externalIds
    }
  };
}

function promptForMode(mode: MovieSummaryMode) {
  if (mode === "spoiler") {
    return [
      "写一段中文剧透版剧情说明，可以包含关键转折、结局、人物命运和主题落点。",
      "不要只是改写原始简介，要补足故事推进、人物动机和冲突如何收束。",
      "目标长度 320-520 字；如果原始资料本来就很短，也要尽量给出比原始简介更完整的信息。"
    ].join("");
  }

  return [
    "写一段中文非剧透剧情简介。不要剧透结局、最终选择、真凶、重大反转或最后命运。",
    "但它必须比原始简介更有信息量，而不是更短的压缩版：补充主角处境、人物关系、心理困境、主要冲突、故事氛围和观看看点。",
    "可以说明前中段会出现的压力来源和情感拉扯；结尾用开放式表达，但不要用空泛问题收尾。",
    "目标长度 260-420 字；除非资料极少，不要少于 220 字。"
  ].join("");
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const choices: unknown[] = Array.isArray(record.choices)
    ? record.choices
    : [];
  const firstChoice = choices[0] && typeof choices[0] === "object"
    ? choices[0] as Record<string, unknown>
    : undefined;
  const message = firstChoice?.message && typeof firstChoice.message === "object"
    ? firstChoice.message as Record<string, unknown>
    : undefined;
  return typeof message?.content === "string" ? message.content : undefined;
}

function parseSummary(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const payload = JSON.parse(trimmed) as SummaryPayload;
    return typeof payload.summary === "string" ? payload.summary.trim() : "";
  } catch {
    return trimmed;
  }
}

export async function summarizeMovie(input: MovieSummaryRequest): Promise<MovieSummaryResponse> {
  const config = summaryConfig();
  if (!config.apiKey) {
    throw new AiSummaryConfigError("AI summary is not configured.");
  }

  const response = await fetch(config.apiUrl, {
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config)
    },
    body: JSON.stringify({
      model: config.model,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: [
            "你是家庭影院片库的中文电影简介助手。",
            "只返回 JSON，格式为 {\"summary\":\"...\"}。",
            "不要提模型、接口、片库内部字段或供应商。",
            "如果资料里已有原始简介，你的任务是增补和重组织信息，不是缩写它。",
            "优先使用片名、年份、导演、演员、类型、原始简介和外部 plot。",
            "如果资料不足，可以结合公开常识概括，但不要编造具体版本信息。"
          ].join("")
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: promptForMode(input.mode),
            movie: compactResult(input.result)
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI summary request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const text = responseText(await response.json() as unknown);
  const summary = text ? parseSummary(text) : "";
  if (!summary) {
    throw new Error("AI summary response was empty.");
  }

  return {
    mode: input.mode,
    title: input.result.title,
    summary,
    generatedAt: new Date().toISOString()
  };
}
