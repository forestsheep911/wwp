import { commitNavigation, useLocationRoute, historyEntryKey } from "../navigation";
import { readSession, writeSession } from "../session-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { Graph, NodeEvent, type IEvent, type NodeData } from "@antv/g6";
import { ArrowLeft, Focus, List, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { browseAssets, getPerson } from "../../api";
import { Button } from "../../components/ui/button";
import { buildRelationshipNetwork, canExploreRelationship, workRelationships, SECOND_LEVEL_LIMIT, type RelationshipNode, type RelationshipNetworkNode, type RelationshipView } from "../relationship-data";
import { createRelationshipLoader } from "../relationship-loader";
import { bindRelationshipTouch } from "../relationship-touch";
import { relationshipLayoutTargets } from "../relationship-layout";
import type { RelationshipSeed } from "./RelationshipExplorer";

const INITIAL_LIMIT = 60;
const BRANCH_BATCH = 12;

async function fitGraph(instance: Graph) {
  await instance.fitView({ when: "always" }, false);
  if (!instance.destroyed && instance.getZoom() > 1) await instance.zoomTo(1, false);
}

export default function RelationshipGraph({ seed, onClose, onNavigate }: { seed: RelationshipSeed; onClose: () => void; onNavigate?: (node: RelationshipNode) => boolean }) {
  const route = useLocationRoute();
  const routeRef = useRef(route); routeRef.current = route;
  const entryKey = historyEntryKey();
  const savedView = readSession<{ query: string; listOpen: boolean }>(`graph-ui:${entryKey}`, { query: "", listOpen: false });
  const updateParameter = (key: string, value: number) => commitNavigation({ ...routeRef.current, params: { ...routeRef.current.params, [key]: String(value) } }, "push");
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const loader = useRef<ReturnType<typeof createRelationshipLoader> | null>(null);
  if (!loader.current) loader.current = createRelationshipLoader({
    person: getPerson,
    works: (id, offset, signal) => browseAssets(100, offset, { mode: "paged", personId: id, signal })
  });
  const generation = useRef(0);
  const navigating = useRef(false);
  const failedNode = useRef<RelationshipNode | undefined>(undefined);
  const navigate = useRef<(node: RelationshipNode) => void>(() => {});
  const [view, setView] = useState<RelationshipView>();
  const [history, setHistory] = useState<RelationshipView[]>([]);
  const limit = Math.min(600, Math.max(INITIAL_LIMIT, Number(route.params?.limit) || INITIAL_LIMIT));
  const setLimit = (value: number) => updateParameter("limit", value);
  const [loading, setLoading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [branchProgress, setBranchProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<RelationshipNode>();
  const [retry, setRetry] = useState(0);
  const [hovered, setHovered] = useState<RelationshipNetworkNode>();
  const [listOpen, setListOpen] = useState(savedView.listOpen);
  const [query, setQuery] = useState(savedView.query);
  const depth: 1 | 2 = route.params?.depth === "1" ? 1 : 2;
  const setDepth = (value: number) => updateParameter("depth", value);
  const branchLimit = Math.min(120, Math.max(BRANCH_BATCH, Number(route.params?.branches) || BRANCH_BATCH));
  const setBranchLimit = (value: number | ((previous: number) => number)) => updateParameter("branches", typeof value === "function" ? value(branchLimit) : value);
  const [expansionRetry, setExpansionRetry] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const [expansion, setExpansion] = useState<{ rootId: string; branches: RelationshipView[]; error: string }>({ rootId: "", branches: [], error: "" });
  const seedId = "work" in seed ? workRelationships(seed.work).center.id : `person:${seed.person.personId}`;

  async function open(node: RelationshipNode, initial = false) {
    const token = ++generation.current;
    loader.current!.cancelPending();
    navigating.current = true;
    setLoadingLabel(node.label);
    setLoading(true);
    setExpanding(false);
    setError("");
    setUnavailable(undefined);
    try {
      const next = await loader.current!.resolve(node, () => token === generation.current);
      if (token !== generation.current) return;
      failedNode.current = undefined;
      if (!initial && view) setHistory(previous => [...previous, view]);
      setView(next);

      setHovered(undefined);

    } catch (cause) {
      if (token === generation.current) {
        failedNode.current = node;
        setError(cause instanceof Error ? cause.message : "关系加载失败，请重试。");
      }
    } finally {
      if (token === generation.current) { navigating.current = false; setLoading(false); }
    }
  }
  navigate.current = node => {
    if (!canExploreRelationship(node)) { setUnavailable(node); return; }
    if (!navigating.current && !drawing && node.id !== view?.center.id) {
      if (onNavigate) { if (!onNavigate(node)) setUnavailable(node); }
      else void open(node);
    }
  };

  useEffect(() => {
    setHistory([]);
    if ("person" in seed) loader.current!.rememberPerson(seed.person);
    void open("work" in seed ? workRelationships(seed.work).center : {
      id: `person:${seed.person.personId}`, label: seed.person.names.primary ?? "未命名人物", personId: seed.person.personId
    }, true);
    return () => { generation.current++; loader.current!.cancelPending(); };
  }, [seedId, retry]);

  useEffect(() => {
    if (!view || depth === 1 || loading) { setExpanding(false); return; }
    let active = true;
    const token = generation.current;
    const current = () => active && token === generation.current;
    const candidates = view.neighbors.slice(0, limit).filter(canExploreRelationship).slice(0, branchLimit);
    setBranchProgress({ done: 0, total: candidates.length });
    setExpanding(true);
    void (async () => {
      const branches: RelationshipView[] = [];
      let message = "";
      for (const node of candidates) {
        if (!current()) return;
        try {
          branches.push(await loader.current!.resolve(node, current, true));
          if (current()) setBranchProgress({ done: branches.length, total: candidates.length });
        }
        catch {
          if (!current()) return;
          message = "部分二层关系暂未加载，已保留成功展开的分支。";
          break;
        }
      }
      if (!current()) return;
      setExpansion({ rootId: view.center.id, branches, error: message });
      setExpanding(false);
    })();
    return () => { active = false; };
  }, [view, depth, limit, branchLimit, expansionRetry, loading]);

  const network = useMemo(() => view ? buildRelationshipNetwork(
    view, expansion.rootId === view.center.id ? expansion.branches : [], depth, limit
  ) : undefined, [view, expansion, depth, limit]);

  // A neighborhood owns its simulation, so closing or navigating stops its ticks.
  useEffect(() => {
    const host = container.current;
    if (!host || !network) return;
    setDrawing(true);
    const width = host.clientWidth;
    const height = host.clientHeight;
    // Each async renderer owns a separate DOM surface. A fast cache hit may
    // replace the network before G6 initializes its element container.
    const surface = document.createElement("div");
    surface.style.width = "100%";
    surface.style.height = "100%";
    host.appendChild(surface);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = relationshipLayoutTargets(network);
    const nodes: NodeData[] = network.nodes.map((node, index) => {
      const color = node.id.startsWith("work:") ? "#fbbf24" : "#6ee7b7";
      const pending = !canExploreRelationship(node);
      const target = targets.get(node.id)!;
      return {
        id: node.id, type: "circle", data: { relationship: node },
        style: {
          x: target.x,
          y: target.y,
          size: node.depth === 2 ? 11 : index ? 18 : 32,
          fill: pending ? "#475569" : color,
          fillOpacity: node.depth === 2 ? 0.65 : 1,
          stroke: index ? "#020617" : color,
          lineWidth: index ? 2 : 4,
          halo: !index, haloFill: color, haloFillOpacity: 0.10, haloLineWidth: 14,
          labelText: node.label, labelFontSize: index ? 12 : 16,
          labelFontWeight: index ? 400 : 600,
          labelFill: pending ? "#94a3b8" : "#e2e8f0",
          labelPlacement: "bottom", labelOffsetY: 9,
          labelMaxWidth: 130, labelWordWrap: true, labelMaxLines: 2,
          labelBackground: true, labelBackgroundFill: "#020617",
          labelBackgroundFillOpacity: 0.85, labelPadding: [2, 4],
          cursor: pending ? "help" : "pointer"
        }
      };
    });
    const instance = new Graph({
      container: surface, width, height, padding: width < 600 ? 32 : 60, animation: false,
      data: { nodes, edges: network.edges.map(edge => ({
        id: edge.id, source: edge.source, target: edge.target,
        data: { role: edge.role },
        style: { strokeOpacity: edge.depth === 2 ? 0.35 : 0.7 }
      })) },
      layout: {
        type: "d3-force", animation: !reducedMotion,
        center: false,
        x: { x: (node: { id: string }) => targets.get(node.id)!.x, strength: (node: { id: string }) => targets.get(node.id)!.strength },
        y: { y: (node: { id: string }) => targets.get(node.id)!.y, strength: (node: { id: string }) => targets.get(node.id)!.strength },
        link: { distance: (edge: { source: string | { id: string }; target: string | { id: string } }) => {
          const source = targets.get(typeof edge.source === "string" ? edge.source : edge.source.id)!;
          const target = targets.get(typeof edge.target === "string" ? edge.target : edge.target.id)!;
          return Math.max(100, Math.hypot(source.x - target.x, source.y - target.y));
        }, strength: 0.15 },
        manyBody: { strength: -260 },
        collide: { radius: 60, strength: 0.9, iterations: 3 },
        alphaDecay: 0.065, velocityDecay: 0.45
      },
      behaviors: ["drag-canvas", "zoom-canvas", { type: "drag-element-force", fixed: false },
        { type: "fix-element-size", state: "", enable: true,
          node: [{ shape: "key" }, { shape: "label" }, { shape: "halo" }], edgeFilter: () => false },
        { type: "auto-adapt-label", padding: 5,
          sortNode: (a: NodeData, b: NodeData) => {
            const left = a.data?.relationship as RelationshipNetworkNode;
            const right = b.data?.relationship as RelationshipNetworkNode;
            return Math.sign(left.depth - right.depth || right.via.length - left.via.length) as -1 | 0 | 1;
          } }],
      edge: { style: { stroke: "#334155", lineWidth: 1, strokeOpacity: 0.7 } },
      zoomRange: [0.15, 3]
    });
    graph.current = instance;
    let active = true;
    let settled = false;
    let draggedAt = 0;
    const eventNode = (event: IEvent) => {
      if (!active) return;
      if (!("target" in event) || !event.target || !("id" in event.target)) return;
      return instance.getNodeData(event.target.id).data?.relationship as RelationshipNetworkNode | undefined;
    };
    instance.on(NodeEvent.DRAG_END, () => { draggedAt = Date.now(); });
    instance.on(NodeEvent.CLICK, event => {
      if (Date.now() - draggedAt < 250) return;
      const node = eventNode(event);
      if (node) navigate.current(node);
    });
    instance.on(NodeEvent.POINTER_OVER, event => {
      const node = eventNode(event);
      setHovered(node);
    });
    instance.on(NodeEvent.POINTER_OUT, event => {
      setHovered(undefined);
    });
    const reportRenderError = () => { if (active) { setDrawing(false); setError("图表绘制失败，可打开关系列表继续探索。"); } };
    const unbindTouch = bindRelationshipTouch(surface, instance, () => active && settled, id => {
      setHovered(undefined);
      const node = instance.getNodeData(id).data?.relationship as RelationshipNetworkNode | undefined;
      if (node) navigate.current(node);
    }, reportRenderError);
    const rendering = instance.render().then(async () => {
      settled = true;
      if (!active) return;
      const viewport = readSession<{ zoom: number; position: [number, number] } | undefined>(`graph-view:${entryKey}`, undefined);
      if (viewport) { await instance.zoomTo(viewport.zoom, false); await instance.translateTo(viewport.position, false); }
      else await fitGraph(instance);
      if (active) setDrawing(false);
    }).catch(reportRenderError);
    const observer = new ResizeObserver(() => {
      if (!active || !host.clientWidth || !host.clientHeight) return;
      instance.setSize(host.clientWidth, host.clientHeight);
      if (settled) void fitGraph(instance).catch(reportRenderError);
    });
    observer.observe(host);
    const saveViewport = () => { if (settled && !instance.destroyed) writeSession(`graph-view:${entryKey}`, { zoom: instance.getZoom(), position: instance.getPosition() }); };
    window.addEventListener("pagehide", saveViewport);
    return () => {
      saveViewport(); window.removeEventListener("pagehide", saveViewport);
      active = false;
      unbindTouch();
      observer.disconnect();
      graph.current = null;
      surface.remove();
      if (settled) instance.destroy();
      else void rendering.then(() => { if (!instance.destroyed) instance.destroy(); });
    };
  }, [network, retry]);

  const visibleCount = Math.min(limit, view?.neighbors.length ?? 0);
  const secondCount = network?.nodes.filter(node => node.depth === 2).length ?? 0;
  const eligibleBranches = view?.neighbors.slice(0, limit).filter(canExploreRelationship).length ?? 0;
  const activeExpansion = expansion.rootId === view?.center.id ? expansion : undefined;
  const filtered = network?.nodes.filter(node => node.depth > 0 && `${node.label} ${node.role ?? ""} ${node.via.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  const fit = () => { if (graph.current) void fitGraph(graph.current).catch(() => setError("暂时无法调整视图，请重试。")); };
  const cancelNavigation = () => {
    generation.current++; loader.current!.cancelPending(); navigating.current = false;
    setLoading(false); setError(""); setHovered(undefined); failedNode.current = undefined;
    setUnavailable(undefined);
  };
  const restore = (index: number) => {
    cancelNavigation();
    setView(history[index]); setHistory(history.slice(0, index));
    setLimit(INITIAL_LIMIT); setBranchLimit(BRANCH_BATCH); setQuery(""); setListOpen(false);
  };
  useEffect(() => { writeSession(`graph-ui:${entryKey}`, { query, listOpen }); }, [query, listOpen, entryKey]);
  const backLabel = onNavigate && window.history.state?.from ? "返回上个中心" : loading && view ? "取消切换" : history.length ? "返回上个中心" : "返回详情";

  return <div className="relative flex min-h-0 flex-1 flex-col">
    <nav aria-label="探索导航" className="grid shrink-0 grid-cols-2 items-center gap-x-3 border-b border-white/5 px-3 py-2 sm:grid-cols-[1fr_minmax(0,2fr)_1fr] sm:px-6">
      <Button variant="ghost" className="justify-self-start" title={loading && view ? "停止本次切换，保留当前中心" : history.length ? `返回：${history[history.length - 1].center.label}` : "关闭关系图，返回详情"} onClick={() => {
        if (onNavigate) { if (window.history.state?.from) window.history.back(); else onClose(); }
        else if (loading && view) cancelNavigation();
        else if (history.length) restore(history.length - 1);
        else onClose();
      }}><ArrowLeft className="h-4 w-4" />{backLabel}</Button>
      <div className="col-span-2 row-start-2 min-w-0 px-3 pb-2 text-center sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:py-1">
        <p className="mb-1 text-[11px] tracking-widest text-slate-500">当前中心</p>
        <strong className="block truncate text-base font-medium text-slate-100" title={view?.center.label}>{view?.center.label ?? loadingLabel}</strong>
        <span className="sr-only" role="status">{loading ? "正在加载关系…" : expanding ? "正在展开第二层…" : `一层 ${visibleCount}${depth === 2 ? ` · 二层 ${secondCount}` : ""}`}</span>
      </div>
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        {history.length > 0 && <Button variant="ghost" title={`回到：${history[0].center.label}`} onClick={() => restore(0)}><RotateCcw className="h-4 w-4" />回到起点</Button>}
      </div>
    </nav>
    {error && <div role="alert" className="flex shrink-0 items-center gap-3 bg-rose-950/40 px-5 text-sm text-rose-200">{error}<Button variant="ghost" disabled={loading} onClick={() => {
      if (failedNode.current) void open(failedNode.current, !view); else setRetry(retry + 1);
    }}>重试</Button></div>}
    {depth === 2 && activeExpansion?.error && <div role="alert" className="flex shrink-0 items-center gap-3 bg-amber-950/30 px-5 text-xs text-amber-200">{activeExpansion.error}<Button variant="ghost" disabled={expanding || loading} onClick={() => setExpansionRetry(value => value + 1)}>重试二层</Button></div>}
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={container} className="relative h-full w-full overflow-hidden bg-slate-950" aria-label="影视人物关系图" />
      {unavailable && <div role="status" className="absolute inset-x-4 top-4 z-20 mx-auto max-w-md rounded-xl border border-slate-600 bg-slate-900 p-4 shadow-xl">
        <p className="font-medium text-slate-100">{unavailable.label}</p>
        <p className="mt-2 text-sm text-slate-300">已收录这条主创关系，但尚未关联到人物资料，暂时无法继续展开。</p>
        <Button variant="ghost" className="mt-2" onClick={() => setUnavailable(undefined)}>知道了</Button>
      </div>}
      {(loading || drawing) && <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/75 backdrop-blur-sm" role="status" aria-live="polite" aria-busy="true">
        <div className="mx-5 flex max-w-sm flex-col items-center rounded-2xl border border-white/10 bg-slate-900 px-8 py-7 text-center shadow-2xl">
          <Loader2 className="relationship-loading-spinner mb-4 h-8 w-8 animate-spin text-emerald-300" aria-hidden="true" />
          <p className="text-base font-medium text-slate-100">{loading ? `正在加载「${loadingLabel}」` : "正在排列关系图"}</p>
          <p className="mt-2 text-sm text-slate-400">{loading ? "稍等一下，加载完成后即可继续探索" : "即将显示关联人物与作品"}</p>
          {loading && view && <Button variant="ghost" className="mt-4" onClick={cancelNavigation}>取消加载</Button>}
        </div>
      </div>}
      {expanding && !loading && !drawing && <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center" role="status" aria-live="polite">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300/20 bg-slate-900/95 px-4 py-3 text-sm text-slate-200 shadow-xl">
          <Loader2 className="relationship-loading-spinner h-4 w-4 shrink-0 animate-spin text-emerald-300" aria-hidden="true" />
          <span>补充第二层 {branchProgress.done}/{branchProgress.total}<span className="ml-2 text-xs text-slate-400">可继续点击探索</span></span>
        </div>
      </div>}
      {view && !view.neighbors.length && <p className="pointer-events-none absolute inset-x-0 top-8 text-center text-sm text-slate-500">暂未收录关联关系。</p>}
      {hovered && <div className="pointer-events-none absolute left-4 top-4 max-w-[min(28rem,80%)] rounded-lg border border-white/10 bg-slate-900/95 px-4 py-3 shadow-xl">
        <p className="text-sm text-slate-100">{hovered.label}</p>
        <p className="mt-1 text-xs text-slate-400">{hovered.depth === 2 ? `第二层 · 经 ${hovered.via.join("、")}` : hovered.role ?? "当前中心"}{!canExploreRelationship(hovered) ? " · 资料待补" : ""}</p>
      </div>}
      <div className="absolute bottom-4 right-4 flex gap-1 rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-xl">
        <Button variant="ghost" size="icon" aria-label="缩小" onClick={() => { void graph.current?.zoomBy(0.8); }}><Minus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="放大" onClick={() => { void graph.current?.zoomBy(1.25); }}><Plus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="适应画布" onClick={fit}><Focus className="h-4 w-4" /></Button>
      </div>
      <div className="pointer-events-none absolute bottom-6 left-4 flex gap-3 rounded-lg bg-slate-950/90 px-2 py-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-400" />作品</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-300" />人物</span>
      </div>
      {listOpen && <aside aria-label="关系列表" className="absolute bottom-20 left-3 top-3 flex w-[min(340px,calc(100%-1.5rem))] flex-col rounded-xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
        <label className="mb-2 text-xs text-slate-400" htmlFor="relationship-search">查找关联人物或作品</label>
        <input id="relationship-search" className="mb-3 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入名称或关系…" />
        <div className="min-h-0 flex-1 overflow-y-auto">{filtered.map(node => <button type="button" key={node.id} className="block w-full rounded-lg px-3 py-3 text-left hover:bg-slate-800 focus-visible:outline-emerald-300 disabled:opacity-50" disabled={loading} onClick={() => { navigate.current(node); setListOpen(false); }}>
          <span className="block text-sm text-slate-200">{node.label}</span>
          <span className="mt-1 block text-xs text-slate-500">{node.depth === 2 ? `第二层 · 经 ${node.via.join("、")}` : node.role}{!canExploreRelationship(node) ? " · 资料待补" : ""}</span>
        </button>)}{!filtered.length && <p className="p-3 text-sm text-slate-500">没有匹配的关系。</p>}</div>
      </aside>}
    </div>
    <footer className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-2 border-t border-white/5 px-3 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:grid-cols-[1fr_auto_1fr] sm:px-6">
      <Button variant="ghost" className="justify-self-start" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}><List className="h-4 w-4" />关系列表</Button>
      <div className="flex items-center gap-2" role="group" aria-label="关系深度">
        <span className="text-xs text-slate-400">展开</span>
        <div className="flex rounded-lg bg-slate-900 p-1">
          {([1, 2] as const).map(value => <button key={value} type="button" aria-pressed={depth === value} title={value === 1 ? "仅显示直接关联" : "再显示关联节点的作品或主创"} className={`min-h-9 rounded-md px-3 text-xs transition ${depth === value ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-100"}`} onClick={() => setDepth(value)}>{value} 层</button>)}
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:col-span-1 sm:justify-end">
        <span>直接关联 {visibleCount}</span>
        {depth === 2 && <span>· 二层关联 {secondCount}</span>}
        {visibleCount < (view?.neighbors.length ?? 0) && <Button variant="ghost" disabled={loading} onClick={() => setLimit(limit + INITIAL_LIMIT)}>显示更多</Button>}
        {depth === 2 && secondCount < (network?.secondTotal ?? 0) && <span>（上限 {SECOND_LEVEL_LIMIT}）</span>}
        {depth === 2 && branchLimit < eligibleBranches && <Button variant="ghost" disabled={loading || expanding} onClick={() => setBranchLimit(value => value + BRANCH_BATCH)}>继续展开</Button>}
      </div>
    </footer>
  </div>;
}
