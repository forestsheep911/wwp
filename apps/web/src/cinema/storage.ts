export const historyStorageKey = "wwpdw-playback-history";
export const favoriteStorageKey = "wwpdw-favorites";
export const themeStorageKey = "wwpdw-theme";

export function memberScopedStorageKey(key: string, memberId?: string) {
  return memberId ? `${key}:${memberId}` : key;
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}
