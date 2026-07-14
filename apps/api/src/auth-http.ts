import type http from "node:http";

export const sessionCookieName = "wwpdw_session";
export const csrfHeaderName = "x-wwpdw-csrf-token";

export function allowedOrigins(value = process.env.WWPDW_ALLOWED_WEB_ORIGINS ?? "") {
  return new Set(value.split(",").map((item) => item.trim().replace(/\/$/, "")).filter(Boolean));
}

export function requestOrigin(request: http.IncomingMessage) {
  const raw = request.headers.origin;
  return typeof raw === "string" ? raw.replace(/\/$/, "") : undefined;
}

export function applyCors(request: http.IncomingMessage, response: http.ServerResponse) {
  const origin = requestOrigin(request);
  if (!origin || !allowedOrigins().has(origin)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", `content-type,x-request-id,${csrfHeaderName}`);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Expose-Headers", "x-request-id");
  response.setHeader("Vary", "Origin");
  return true;
}

export function readCookie(request: http.IncomingMessage, name = sessionCookieName) {
  const item = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
}

export function sessionCookie(value: string, expiresAt: string) {
  const secure = process.env.NODE_ENV !== "development";
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=None; ${secure ? "Secure; " : ""}Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV !== "development";
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=None; ${secure ? "Secure; " : ""}Max-Age=0`;
}

export function csrfValid(request: http.IncomingMessage, expected: string) {
  return request.headers[csrfHeaderName] === expected;
}
