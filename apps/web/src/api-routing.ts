export function normalizeApiBaseUrl(value?: string) {
  return (value ?? "").replace(/\/$/, "");
}

export function apiRequestUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path}`;
}

export function healthRequestUrl(baseUrl: string) {
  return apiRequestUrl(baseUrl, baseUrl ? "/health" : "/api/health");
}
