import type { PublicPersonDetail, SearchResult } from "@wwpdw/shared";
import { groupPersonWorksByWork, personDepartmentLabel } from "./person-route";

export interface RelationshipNode {
  id: string;
  label: string;
  role?: string;
  personId?: string;
  work?: SearchResult;
  workId?: string;
  sourcePersonId?: string;
}
export interface RelationshipView { center: RelationshipNode; neighbors: RelationshipNode[] }
export function workNode(work: SearchResult): RelationshipNode {
  return { id: `work:${work.metadata?.work?.workId ?? work.metadata?.workId ?? work.assetKey}`, label: work.title, work };
}
export function workRelationships(work: SearchResult): RelationshipView {
  const nodes = new Map<string, RelationshipNode>();
  for (const credit of work.metadata?.work?.credits ?? []) {
    const id = credit.personId ? `person:${credit.personId}` : `pending:${workNode(work).id}:${credit.name}`;
    const role = personDepartmentLabel(credit.department);
    const existing = nodes.get(id);
    if (existing) existing.role = [...new Set([...(existing.role ?? "").split(" / "), role])].join(" / ");
    else nodes.set(id, { id, label: credit.name, personId: credit.personId, role });
  }
  return { center: workNode(work), neighbors: [...nodes.values()] };
}
export function personRelationships(person: PublicPersonDetail, works: SearchResult[]): RelationshipView {
  const byId = new Map(works.map(work => [work.metadata?.work?.workId ?? work.metadata?.workId, work]));
  return {
    center: { id: `person:${person.personId}`, personId: person.personId, label: person.names.primary ?? "未命名人物" },
    neighbors: groupPersonWorksByWork(person.works).map(credit => {
      const work = byId.get(credit.workId);
      return { ...(work ? workNode(work) : { id: `work:${credit.workId}`, label: credit.title ?? credit.workId }),
        workId: credit.workId, sourcePersonId: person.personId, role: credit.roleLabels.join(" / ") };
    })
  };
}

export const SECOND_LEVEL_LIMIT = 60;
export interface RelationshipNetworkNode extends RelationshipNode {
  depth: 0 | 1 | 2;
  via: string[];
}
export interface RelationshipNetwork {
  nodes: RelationshipNetworkNode[];
  edges: { id: string; source: string; target: string; role: string; depth: 1 | 2 }[];
  secondTotal: number;
}

export function canExploreRelationship(node: RelationshipNode) {
  return Boolean(node.personId || node.work || (node.workId && node.sourcePersonId));
}

// Only expand supplied first-level branches: never recursively traverse a
// second-level node. IDs, rather than names, define shared people and works.
export function buildRelationshipNetwork(
  view: RelationshipView,
  branches: RelationshipView[],
  depth: 1 | 2,
  firstLimit: number,
  secondLimit = SECOND_LEVEL_LIMIT
): RelationshipNetwork {
  const first = view.neighbors.slice(0, firstLimit);
  const nodes = new Map<string, RelationshipNetworkNode>();
  nodes.set(view.center.id, { ...view.center, depth: 0, via: [] });
  first.forEach(node => nodes.set(node.id, { ...node, depth: 1, via: [view.center.label] }));
  const edges = new Map<string, RelationshipNetwork["edges"][number]>();
  const connect = (source: string, target: string, role: string, level: 1 | 2) => {
    if (source === target) return;
    const id = JSON.stringify([source, target].sort());
    const existing = edges.get(id);
    if (existing) existing.role = [...new Set([existing.role, role].filter(Boolean))].join(" / ");
    else edges.set(id, { id, source, target, role, depth: level });
  };
  first.forEach(node => connect(view.center.id, node.id, node.role ?? "", 1));
  if (depth === 1) return { nodes: [...nodes.values()], edges: [...edges.values()], secondTotal: 0 };

  const firstIds = new Set(first.map(node => node.id));
  const candidates = new Map<string, { node: RelationshipNode; parents: Map<string, string>; rank: number }>();
  for (const branch of branches) {
    if (!firstIds.has(branch.center.id)) continue;
    branch.neighbors.forEach((node, rank) => {
      if (node.id === view.center.id) return;
      if (firstIds.has(node.id)) {
        connect(branch.center.id, node.id, node.role ?? "", 2);
        return;
      }
      const candidate = candidates.get(node.id) ?? { node, parents: new Map(), rank };
      candidate.parents.set(branch.center.id, branch.center.label);
      candidate.rank = Math.min(candidate.rank, rank);
      if (node.work && !candidate.node.work) candidate.node = node;
      candidates.set(node.id, candidate);
    });
  }
  // Shared connections first; round-robin rank then spreads the remaining
  // budget across branches instead of consuming it with one long filmography.
  const selected = [...candidates.values()]
    .sort((a, b) => b.parents.size - a.parents.size || a.rank - b.rank || a.node.id.localeCompare(b.node.id))
    .slice(0, secondLimit);
  selected.forEach(({ node, parents }) => nodes.set(node.id, { ...node, depth: 2, via: [...parents.values()] }));
  for (const branch of branches) {
    if (!firstIds.has(branch.center.id)) continue;
    for (const node of branch.neighbors) {
      if (nodes.get(node.id)?.depth === 2) connect(branch.center.id, node.id, node.role ?? "", 2);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], secondTotal: candidates.size };
}
