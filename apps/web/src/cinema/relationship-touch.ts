import type { Graph } from "@antv/g6";

type Point = [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Own touch gestures at the DOM boundary so G6's mouse drag/click behaviors
// cannot interpret a pinch as a node drag or a synthetic click.
export function bindRelationshipTouch(
  surface: HTMLElement,
  graph: Graph,
  ready: () => boolean,
  select: (id: string) => void,
  reportError: () => void
) {
  const pointers = new Map<number, Point>();
  let start: Point = [0, 0];
  let moved = false;
  let multiTouch = false;
  let pinch: { distance: number; zoom: number; center: Point } | undefined;
  let lastTouch = 0;
  surface.style.touchAction = "none";
  const point = (event: PointerEvent): Point => {
    const rect = surface.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const beginPinch = () => {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.max(1, distance(a, b)), zoom: graph.getZoom(), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  };
  const onPointer = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    lastTouch = Date.now();
    if (!ready()) return;
    const current = point(event);
    if (event.type === "pointerdown") {
      pointers.set(event.pointerId, current);
      surface.setPointerCapture(event.pointerId);
      if (pointers.size === 1) { start = current; moved = false; multiTouch = false; }
      if (pointers.size === 2) { multiTouch = true; beginPinch(); }
      return;
    }
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    if (event.type === "pointermove") {
      pointers.set(event.pointerId, current);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        void graph.zoomTo(pinch.zoom * distance(a, b) / pinch.distance, false, pinch.center).catch(reportError);
      } else if (pointers.size === 1 && !multiTouch) {
        if (distance(start, current) > 10) moved = true;
        if (moved) void graph.translateBy([current[0] - previous[0], current[1] - previous[1]], false).catch(reportError);
      }
      return;
    }
    pointers.delete(event.pointerId);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (pointers.size === 2) beginPinch();
    else pinch = undefined;
    if (event.type !== "pointerup" || pointers.size || moved || multiTouch || distance(start, current) > 10) return;
    // First honor the renderer's hit test, including visible node labels.
    const nodes = graph.getNodeData();
    const ids = new Set(nodes.map(node => node.id));
    const canvasPoint = graph.getCanvasByViewport(current);
    const hit = graph.getCanvas().document.elementFromPointSync(canvasPoint[0], canvasPoint[1]);
    for (let element = hit; element; element = element.parentElement as typeof hit) {
      if (ids.has(element.id)) { select(element.id); return; }
    }
    // Fall back to a 44px touch target around small dots.
    let nearest: { id: string; distance: number } | undefined;
    for (const node of nodes) {
      const position = graph.getViewportByCanvas(graph.getElementPosition(node.id));
      const delta = distance(current, [position[0], position[1]]);
      if (delta <= 22 && (!nearest || delta < nearest.distance)) nearest = { id: node.id, distance: delta };
    }
    if (nearest) select(nearest.id);
  };
  const suppressTouch = (event: TouchEvent) => { event.preventDefault(); event.stopPropagation(); };
  const suppressClick = (event: MouseEvent) => {
    if (Date.now() - lastTouch < 800) { event.preventDefault(); event.stopPropagation(); }
  };
  const options = { capture: true, passive: false };
  const events = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  events.forEach(type => surface.addEventListener(type, onPointer, options));
  const touchEvents = ["touchstart", "touchmove", "touchend"] as const;
  touchEvents.forEach(type => surface.addEventListener(type, suppressTouch, options));
  surface.addEventListener("click", suppressClick, true);
  return () => {
    events.forEach(type => surface.removeEventListener(type, onPointer, true));
    touchEvents.forEach(type => surface.removeEventListener(type, suppressTouch, true));
    surface.removeEventListener("click", suppressClick, true);
    pointers.clear();
  };
}
