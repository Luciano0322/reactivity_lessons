import type { Node } from "../graph.js";

// 以 WeakMap 發 ID，不污染 Node 結構
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
  inDegree: number;   // deps.size
  outDegree: number;  // subs.size
  deps: { id: string; kind: Node["kind"] }[];
  subs: { id: string; kind: Node["kind"] }[];
};

// 取得單一節點的扁平快照（不遞迴）
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

// 友善輸出：上游 / 下游各一張表 + 概要
export function logInspect(node: Node) {
  const snap = inspect(node);
  // 概要
  console.log(`[inspect] ${snap.id} (${snap.kind})  in=${snap.inDegree}  out=${snap.outDegree}`);
  // 上游
  if (snap.deps.length) {
    console.log("  deps ↑");
    console.table(snap.deps);
  } else {
    console.log("  deps ↑ (none)");
  }
  // 下游
  if (snap.subs.length) {
    console.log("  subs ↓");
    console.table(snap.subs);
  } else {
    console.log("  subs ↓ (none)");
  }
}

// 小範圍遞迴展開（避免循環）：向上/向下各走 depth 層
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
          queue.push({ node: dep, dUp: dUp - 1, dDown: 0 }); // 向上繼續
        }
      }
    }
    if (dDown > 0) {
      for (const sub of node.subs) {
        rows.push({ from: fromId, to: getId(sub), dir: "subs" });
        if (!seen.has(sub)) {
          seen.add(sub);
          queue.push({ node: sub, dUp: 0, dDown: dDown - 1 }); // 向下繼續
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

//（加碼）輸出 Mermaid，用於文件示意
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
