import { useSyncExternalStore } from "react";
import { cinemaHistoryState, routeFromLocation, routeUrl, type CinemaRoute } from "./routing";
import { readSession, writeSession } from "./session-state";
export const routeEvent = "wwp-route-changed";
function notify() { window.dispatchEvent(new Event(routeEvent)); }
export function historyEntryKey() { return window.history.state?.entryKey ?? window.location.pathname + window.location.search; }
export function commitNavigation(route: CinemaRoute, mode: "push" | "replace") {
  const url = routeUrl(route);
  const previous = window.history.state;
  if (mode === "push" && url !== window.location.pathname + window.location.search) {
    saveScroll();
    window.history.pushState({ ...cinemaHistoryState(route), entryKey: crypto.randomUUID(), from: window.location.pathname + window.location.search, graphOrigin: route.graph ? previous?.graphOrigin ?? window.location.pathname + window.location.search : undefined }, "", url);
  } else window.history.replaceState({ ...previous, ...cinemaHistoryState(route), entryKey: previous?.entryKey ?? crypto.randomUUID() }, "", url);
  notify();
}
export function navigatePage(route: CinemaRoute, mode: "push" | "replace" = "push") {
  commitNavigation(route, mode); window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}
export function backTo(fallback: CinemaRoute) {
  if (window.history.state?.from) window.history.back(); else navigatePage(fallback, "replace");
}
export function subscribeRoute(callback: () => void) {
  window.addEventListener(routeEvent, callback); window.addEventListener("popstate", callback);
  return () => { window.removeEventListener(routeEvent, callback); window.removeEventListener("popstate", callback); };
}
export function useLocationRoute() {
  useSyncExternalStore(subscribeRoute, () => window.location.pathname + window.location.search, () => "/");
  return routeFromLocation();
}
interface ScrollScene { top: number; anchor?: string; offset?: number }
export function saveScroll(key = historyEntryKey()) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/works/"],a[href^="/people/"],a[href^="/forum/"]')];
  const anchor = links.filter(link => link.getBoundingClientRect().height > 0 && link.getBoundingClientRect().top >= 0).sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  writeSession(`scroll:${key}`, { top: window.scrollY, anchor: anchor?.getAttribute("href") ?? undefined, offset: anchor?.getBoundingClientRect().top } satisfies ScrollScene);
}
export function restoreScroll() {
  const key = historyEntryKey();
  const saved = readSession<ScrollScene | number>(`scroll:${key}`, 0);
  const scene = typeof saved === "number" ? { top: saved } : saved;
  let frame = 0; let attempts = 0; let cancelled = false; let userInteracted = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { cancelled = true; userInteracted = true; cancelAnimationFrame(frame); };
  const restore = () => {
    if (cancelled || key !== historyEntryKey()) return;
    const anchor = scene.anchor ? [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find(link => link.getAttribute("href") === scene.anchor && link.getBoundingClientRect().height > 0) : undefined;
    const top = anchor ? window.scrollY + anchor.getBoundingClientRect().top - (scene.offset ?? 0) : scene.top;
    window.scrollTo(0, Math.min(top, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
    if ((!anchor && scene.anchor || document.documentElement.scrollHeight - innerHeight < top) && attempts++ < 180) frame = requestAnimationFrame(restore);
  };
  const save = () => { if (!userInteracted) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (key === historyEntryKey()) saveScroll(key); }, 150); };
  frame = requestAnimationFrame(restore);
  window.addEventListener("scroll", save, { passive: true });
  for (const event of ["wheel", "touchstart", "keydown"]) window.addEventListener(event, cancel, { once: true });
  return () => { cancel(); clearTimeout(saveTimer); window.removeEventListener("scroll", save); for (const event of ["wheel", "touchstart", "keydown"]) window.removeEventListener(event, cancel); };
}
