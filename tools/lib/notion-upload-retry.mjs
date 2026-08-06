import { setTimeout as sleep } from "node:timers/promises";

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const TRANSIENT_CODE = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

export function isTransientNotionUploadError(error) {
  if (TRANSIENT_STATUS.has(Number(error?.status))) return true;
  if (TRANSIENT_CODE.has(error?.code) || TRANSIENT_CODE.has(error?.errno)) return true;
  const message = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
  // Notion uses 409 for both real resource conflicts and a recoverable
  // multipart-transfer failure. Only the latter is safe to retry.
  if (Number(error?.status) === 409 && /failed to upload file.*try again later/i.test(message)) return true;
  return /fetch failed|socket hang up|connection reset|timed out|timeout occurred|bad gateway/i.test(message);
}

export async function withTransientNotionUploadRetry(operation, options = {}) {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientNotionUploadError(error)) throw error;
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new Error("Transient Notion upload retry exhausted.");
}
