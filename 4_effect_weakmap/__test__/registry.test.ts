import { describe, it, expect, vi } from 'vitest';
import type { Node, Kind } from '../graph.js';
import {
  WeakMapRegistry,
  type EffectInstanceLike,
} from '../registry.js';

function makeNode(kind: Kind = 'effect'): Node {
  return {
    kind,
    deps: new Set<Node>(),
    subs: new Set<Node>(),
  };
}

function makeEffect(): EffectInstanceLike {
  return { schedule: vi.fn() };
}

describe('WeakMapRegistry', () => {
  it('get() returns undefined for unknown node', () => {
    const node = makeNode();
    expect(WeakMapRegistry.get(node)).toBeUndefined();
  });

  it('set() stores instance for a node; get() retrieves the same instance', () => {
    const node = makeNode();
    const inst = makeEffect();

    WeakMapRegistry.set(node, inst);
    expect(WeakMapRegistry.get(node)).toBe(inst);
  });

  it('set() can replace an existing instance for the same node', () => {
    const node = makeNode();
    const a = makeEffect();
    const b = makeEffect();

    WeakMapRegistry.set(node, a);
    expect(WeakMapRegistry.get(node)).toBe(a);

    WeakMapRegistry.set(node, b);
    expect(WeakMapRegistry.get(node)).toBe(b);
  });

  it('delete() removes mapping so subsequent get() is undefined', () => {
    const node = makeNode();
    const inst = makeEffect();

    WeakMapRegistry.set(node, inst);
    expect(WeakMapRegistry.get(node)).toBe(inst);

    WeakMapRegistry.delete(node);
    expect(WeakMapRegistry.get(node)).toBeUndefined();
  });

  it('delete() on missing key is safe (no throw)', () => {
    const node = makeNode();
    expect(() => WeakMapRegistry.delete(node)).not.toThrow();
    expect(WeakMapRegistry.get(node)).toBeUndefined();
  });

  it('mappings are per-node isolated', () => {
    const n1 = makeNode();
    const n2 = makeNode();
    const i1 = makeEffect();

    WeakMapRegistry.set(n1, i1);

    expect(WeakMapRegistry.get(n1)).toBe(i1);
    expect(WeakMapRegistry.get(n2)).toBeUndefined();

    WeakMapRegistry.delete(n1);
    expect(WeakMapRegistry.get(n1)).toBeUndefined();
    expect(WeakMapRegistry.get(n2)).toBeUndefined();
  });
});
