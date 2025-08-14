import type { Node } from "./graph.js";

export interface EffectInstanceLike {
  schedule(): void;
}

export interface EffectRegistry {
  get(node: Node): EffectInstanceLike | undefined;
  set(node: Node, inst: EffectInstanceLike): void;
  delete(node: Node): void;
}

const table = new WeakMap<Node, EffectInstanceLike>();

export const WeakMapRegistry: EffectRegistry = {
  get: (node) => table.get(node),
  set: (node, inst) => { table.set(node, inst); },
  delete: (node) => { table.delete(node); }
};