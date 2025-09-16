import type { Node } from "../graph.js";

const ids = new WeakMap<Node, string>();
let seq = 0;
function getId(n: Node) {
  let id = ids.get(n);
  if (!id) {
    id = `${n.kind}#${++seq}`;
    ids.set(n, id);
  }
  return id;
}

export type InspectSnapshot = {
  id: string;
  kind: Node["kind"];
  inDegree: number;
  outDegree: number;
  deps: { id: string; kind: Node["kind"] }[];
  subs: { id: string; kind: Node["kind"] }[];
};

export function inspect(node: Node): InspectSnapshot {
  return {
    id: getId(node),
    kind: node.kind,
    inDegree: node.deps.size,
    outDegree: node.subs.size,
    deps: [...node.deps].map(n => ({ id: getId(n), kind: n.kind })),
    subs: [...node.subs].map(n => ({ id: getId(n), kind: n.kind })),
  };
}

export function logInspect(node: Node) {
  const snap = inspect(node);
  console.log(`[inspect] ${snap.id} (${snap.kind})  in=${snap.inDegree}  out=${snap.outDegree}`);
  if (snap.deps.length) {
    console.log("  deps ↑");
    console.table(snap.deps);
  } else {
    console.log("  deps ↑ (none)");
  }
  if (snap.subs.length) {
    console.log("  subs ↓");
    console.table(snap.subs);
  } else {
    console.log("  subs ↓ (none)");
  }
}

export function inspectRecursive(root: Node, depth = 1) {
  const seen = new Set<Node>();
  type Row = { from: string; to: string; dir: "deps" | "subs" };

  const rows: Row[] = [];
  const queue: Array<{ node: Node; dUp: number; dDown: number }> = [{ node: root, dUp: depth, dDown: depth }];
  seen.add(root);

  while (queue.length) {
    const { node, dUp, dDown } = queue.shift()!;
    const fromId = getId(node);

    if (dUp > 0) {
      for (const dep of node.deps) {
        rows.push({ from: getId(dep), to: fromId, dir: "deps" });
        if (!seen.has(dep)) {
          seen.add(dep);
          queue.push({ node: dep, dUp: dUp - 1, dDown: 0 });
        }
      }
    }
    if (dDown > 0) {
      for (const sub of node.subs) {
        rows.push({ from: fromId, to: getId(sub), dir: "subs" });
        if (!seen.has(sub)) {
          seen.add(sub);
          queue.push({ node: sub, dUp: 0, dDown: dDown - 1 });
        }
      }
    }
  }

  return {
    center: getId(root),
    nodes: [...seen].map(n => ({ id: getId(n), kind: n.kind })),
    edges: rows,
  };
}

export function toMermaid(root: Node, depth = 1) {
  const g = inspectRecursive(root, depth);
  const lines = ["graph TD"];
  for (const n of g.nodes) {
    lines.push(`  ${n.id.replace(/[^a-zA-Z0-9_#]/g, "_")}["${n.id}"]`);
  }
  for (const e of g.edges) {
    const a = e.from.replace(/[^a-zA-Z0-9_#]/g, "_");
    const b = e.to.replace(/[^a-zA-Z0-9_#]/g, "_");
    lines.push(`  ${a} --> ${b}`);
  }
  return lines.join("\n");
}
