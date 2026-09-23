const prefix = "wwp-session-v1:";
let scope = "guest";
const memory = new Map<string, { at: number; value: unknown }>();
export function setSessionScope(value: string) { scope = value; }
export function clearSessionState() {
  memory.clear();
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch { /* unavailable */ }
}
export function readSession<T>(key: string, fallback: T): T {
  const fullKey = `${prefix}${scope}:${key}`;
  const cached = memory.get(fullKey);
  if (cached && Date.now() - cached.at < 12 * 60 * 60_000) return cached.value as T;
  try {
    const raw = sessionStorage.getItem(fullKey);
    if (raw) { const entry = JSON.parse(raw); if (entry.version === 1 && Date.now() - entry.at < 12 * 60 * 60_000) return entry.value; }
  } catch { /* quota, privacy mode, corrupt cache */ }
  return fallback;
}
export function writeSession(key: string, value: unknown, compactValue?: unknown) {
  const fullKey = `${prefix}${scope}:${key}`;
  memory.set(fullKey, { at: Date.now(), value });
  if (memory.size > 80) memory.delete(memory.keys().next().value!);
  try {
    let serialized = JSON.stringify({ version: 1, at: Date.now(), value });
    if (serialized.length > 1_000_000) {
      if (compactValue === undefined) { sessionStorage.removeItem(fullKey); return; }
      serialized = JSON.stringify({ version: 1, at: Date.now(), value: compactValue });
    }
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith(prefix));
    if (keys.length >= 80 && !keys.includes(fullKey)) sessionStorage.removeItem(keys[0]);
    sessionStorage.setItem(fullKey, serialized);
  } catch { /* memory fallback */ }
}
