import type { RelationshipNetwork } from "./relationship-data";

// Keep each first-hop neighborhood in its own region. These are soft force
// targets, so dragging and collision avoidance remain part of the layout.
export function relationshipLayoutTargets(network: RelationshipNetwork) {
  const targets = new Map<string, { x: number; y: number; strength: number }>();
  const root = network.nodes.find(node => node.depth === 0)!;
  const first = network.nodes.filter(node => node.depth === 1);
  const firstIds = new Set(first.map(node => node.id));
  const parents = new Map<string, string[]>();
  for (const node of network.nodes.filter(node => node.depth === 2)) {
    parents.set(node.id, network.edges.flatMap(edge =>
      edge.source === node.id && firstIds.has(edge.target) ? [edge.target] :
      edge.target === node.id && firstIds.has(edge.source) ? [edge.source] : []));
  }
  const counts = new Map(first.map(node => [node.id, [...parents.values()].filter(ids => ids.includes(node.id)).length]));
  const groupRadius = (id: string) => 80 + Math.sqrt(counts.get(id) ?? 0) * 36;
  const largest = Math.max(80, ...first.map(node => groupRadius(node.id)));
  const weights = first.map(node => counts.get(node.id) ? groupRadius(node.id) + 90 : 45);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const radius = Math.max(largest + 220, totalWeight / Math.PI);
  targets.set(root.id, { x: 0, y: 0, strength: 0.9 });
  let consumed = 0;
  first.forEach((node, index) => {
    const angle = first.length === 1 ? Math.PI : -Math.PI / 2 + (consumed + weights[index] / 2 - weights[0] / 2) / totalWeight * Math.PI * 2;
    consumed += weights[index];
    targets.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, strength: 0.5 });
  });
  const ranks = new Map<string, number>();
  for (const node of network.nodes.filter(node => node.depth === 2)) {
    const ids = parents.get(node.id) ?? [];
    const owner = ids[0];
    const anchor = targets.get(owner) ?? targets.get(root.id)!;
    const rank = ranks.get(owner) ?? 0;
    ranks.set(owner, rank + 1);
    const angle = rank * 2.399963;
    const localRadius = groupRadius(owner) * Math.sqrt((rank + 0.5) / Math.max(1, counts.get(owner) ?? 1));
    let x = anchor.x, y = anchor.y;
    if (ids.length > 1) {
      x = ids.reduce((sum, id) => sum + targets.get(id)!.x, 0) / ids.length;
      y = ids.reduce((sum, id) => sum + targets.get(id)!.y, 0) / ids.length;
      // Shared people stay between their works, but out of the root's space.
      const length = Math.hypot(x, y);
      if (length < 180) { x = Math.cos(angle) * 180; y = Math.sin(angle) * 180; }
    } else {
      x += Math.cos(angle) * localRadius;
      y += Math.sin(angle) * localRadius;
    }
    targets.set(node.id, { x, y, strength: ids.length > 1 ? 0.18 : 0.25 });
  }
  return targets;
}
