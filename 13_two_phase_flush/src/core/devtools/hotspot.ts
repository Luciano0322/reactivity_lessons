import type { Node } from "../graph.js";

export type HotspotStats = {
  updates: number;
  lastTs: number;
  freqPerMin: number;
  durTotal: number;
  durCount: number;
};

let stats = new WeakMap<Node, HotspotStats>();
const liveNodes = new Set<Node>();
const alpha = 0.2;

const now = () => (globalThis.performance?.now?.() ?? Date.now());

function getStats(n: Node): HotspotStats {
  let s = stats.get(n);
  if (!s) {
    s = { updates: 0, lastTs: now(), freqPerMin: 0, durTotal: 0, durCount: 0 };
    stats.set(n, s);
  }
  return s;
}

// ── 對外 API ───
export function registerNode(n: Node) { liveNodes.add(n); }
export function unregisterNode(n: Node) { liveNodes.delete(n); }

export function recordUpdate(node: Node) {
  const s = getStats(node);
  const t = now();
  const dt = Math.max(1, t - s.lastTs);
  const instFreqPerMin = (1000 / dt) * 60;
  s.freqPerMin = alpha * instFreqPerMin + (1 - alpha) * s.freqPerMin;
  s.updates += 1;
  s.lastTs = t;
}

export function withTiming<T>(node: Node, fn: () => T): T {
  recordUpdate(node);
  const t0 = now();
  try {
    return fn();
  } finally {
    const d = now() - t0;
    const s = getStats(node);
    s.durTotal += d;
    s.durCount += 1;
  }
}

export function allNodes(): Iterable<Node> { return liveNodes; }

export function topHotspots(
  n = 5,
  by: "freq" | "updates" | "avgTime" = "freq",
  nodes: Iterable<Node> = liveNodes
) {
  const rows = [] as Array<{
    kind: Node["kind"];
    updates: number;
    freqPerMin: number;
    avgMs: number;
    inDegree: number;
    outDegree: number;
  }>;
  for (const nd of nodes) {
    const s = stats.get(nd);
    if (!s) continue;
    rows.push({
      kind: nd.kind,
      updates: s.updates,
      freqPerMin: Number(s.freqPerMin.toFixed(2)),
      avgMs: s.durCount ? Number((s.durTotal / s.durCount).toFixed(2)) : 0,
      inDegree: nd.deps.size,
      outDegree: nd.subs.size,
    });
  }
  switch (by) {
    case "updates": rows.sort((a, b) => b.updates - a.updates); break;
    case "avgTime": rows.sort((a, b) => b.avgMs - a.avgMs || b.updates - a.updates); break;
    default:        rows.sort((a, b) => b.freqPerMin - a.freqPerMin || b.updates - a.updates);
  }
  return rows.slice(0, n);
}

export function logTopHotspots(
  n = 5,
  by: "freq" | "updates" | "avgTime" = "freq",
  nodes: Iterable<Node> = liveNodes
) {
  const rows = topHotspots(n, by, nodes).map(r => ({
    kind: r.kind,
    updates: r.updates,
    "freq (/min)": r.freqPerMin,
    "avg ms": r.avgMs,
    "in-degree": r.inDegree,
    "out-degree": r.outDegree
  }));
  console.table(rows);
}

export function resetHotspots() {
  stats = new WeakMap<Node, HotspotStats>();
  liveNodes.clear();
}
