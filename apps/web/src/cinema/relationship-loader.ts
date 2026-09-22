import type { PublicPersonDetail, SearchResponse, SearchResult } from "@wwpdw/shared";
import { personRelationships, workNode, workRelationships, type RelationshipNode } from "./relationship-data";

interface RelationshipSource {
  person: (id: string, signal: AbortSignal) => Promise<PublicPersonDetail>;
  works: (id: string, offset: number, signal: AbortSignal) => Promise<SearchResponse>;
}
export function createRelationshipLoader(source: RelationshipSource, spacingMs = 250) {
  const people = new Map<string, PublicPersonDetail>();
  const works = new Map<string, SearchResult>();
  const pages = new Map<string, { results: SearchResult[]; offset?: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  let nextAt = 0;
  let cooldownUntil = 0;
  let epoch = 0;
  let activeRequest: AbortController | undefined;
  const check = (current: () => boolean) => { if (!current()) throw new Error("加载已取消"); };
  // A single queue covers all reads, including overlapping navigation and
  // expansion. A canceled job never launches its remaining branch requests.
  function read<T>(request: (signal: AbortSignal) => Promise<T>, current: () => boolean): Promise<T> {
    const version = epoch;
    const valid = () => current() && version === epoch;
    const job = queue.then(async () => {
      check(valid);
      if (Date.now() < cooldownUntil) throw new Error("服务请求较多，请稍后重试。");
      const delay = nextAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      check(valid);
      nextAt = Date.now() + spacingMs;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = setTimeout(() => controller.abort(new Error("加载超时，请重试。")), 20_000);
      try {
        const result = await request(controller.signal);
        check(valid);
        return result;
      }
      catch (error) {
        const failure = error as { statusCode?: number; retryAfterMs?: number };
        if (failure.statusCode === 429) cooldownUntil = Date.now() + Math.max(failure.retryAfterMs ?? 0, 60_000);
        throw error;
      }
      finally { clearTimeout(timeout); if (activeRequest === controller) activeRequest = undefined; }
    });
    queue = job.catch(() => {});
    return job;
  }
  async function person(id: string, current: () => boolean) {
    const cached = people.get(id);
    if (cached) return cached;
    const result = await read(signal => source.person(id, signal), current);
    people.set(id, result);
    return result;
  }
  async function loadWorks(id: string, current: () => boolean, target?: string) {
    const state = pages.get(id) ?? { results: [], offset: 0 };
    pages.set(id, state);
    while (state.offset !== undefined && (!target || !works.has(`work:${target}`))) {
      check(current);
      const offset = state.offset;
      const page = await read(signal => source.works(id, offset, signal), current);
      state.results.push(...page.results);
      page.results.forEach(work => works.set(workNode(work).id, work));
      state.offset = page.nextOffset !== undefined && page.nextOffset > offset ? page.nextOffset : undefined;
    }
    return state.results;
  }
  return {
    cancelPending() { epoch++; activeRequest?.abort(new Error("加载已取消")); },
    rememberPerson(profile: PublicPersonDetail) { people.set(profile.personId, profile); },
    async resolve(node: RelationshipNode, current: () => boolean, branch = false) {
      check(current);
      if (node.work) works.set(node.id, node.work);
      if (!works.has(node.id) && node.workId && node.sourcePersonId) {
        await loadWorks(node.sourcePersonId, current, node.workId);
      }
      check(current);
      const work = works.get(node.id);
      if (work) return workRelationships(work);
      if (!node.personId) throw new Error("这部作品的可探索资料暂未收录。");
      const profile = await person(node.personId, current);
      check(current);
      // The profile already contains the filmography. Show it immediately;
      // hydrate work credits only when expanding or selecting that work.
      const assets = [...works.values()];
      check(current);
      return personRelationships(profile, assets);
    }
  };
}
