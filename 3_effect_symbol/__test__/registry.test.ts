import { describe, it, expect, vi } from 'vitest';
import type { Kind, Node } from '../graph.js';
import {
  SymbolRegistry,
  EffectSlot,
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

describe('SymbolRegistry', () => {
  it('set() stores instance on the node and get() retrieves it', () => {
    const node = makeNode();
    const inst = makeEffect();

    expect(SymbolRegistry.get(node)).toBeUndefined();

    SymbolRegistry.set(node, inst);
    expect(SymbolRegistry.get(node)).toBe(inst);
  });

  it('does not enumerate via Object.keys / for...in and is stored under the EffectSlot symbol', () => {
    const node = makeNode();
    const inst = makeEffect();

    SymbolRegistry.set(node, inst);

    // 不會出現在字串鍵的列舉中
    expect(Object.keys(node)).not.toContain(String(EffectSlot));

    // 以 Symbol 查詢能找到
    const symbols = Object.getOwnPropertySymbols(node);
    expect(symbols).toContain(EffectSlot);

    // 屬性描述：不可列舉（enumerable: false）、可配置（configurable: true）
    const desc = Object.getOwnPropertyDescriptor(node as any, EffectSlot);
    expect(desc).toBeDefined();
    expect(desc!.enumerable).toBe(false);
    expect(desc!.configurable).toBe(true);
    expect(desc!.value).toBe(inst);
  });

  it('delete() removes the symbol property so get() returns undefined', () => {
    const node = makeNode();
    const inst = makeEffect();
    SymbolRegistry.set(node, inst);

    // 確認存在
    expect(SymbolRegistry.get(node)).toBe(inst);

    // 刪除
    SymbolRegistry.delete(node);
    expect(SymbolRegistry.get(node)).toBeUndefined();

    // 確認 symbol 不在自有屬性列表中
    const symbolsAfter = Object.getOwnPropertySymbols(node);
    expect(symbolsAfter).not.toContain(EffectSlot);
  });

  it('set() can replace an existing instance (because property is configurable)', () => {
    const node = makeNode();
    const a = makeEffect();
    const b = makeEffect();

    SymbolRegistry.set(node, a);
    expect(SymbolRegistry.get(node)).toBe(a);

    // 重新設定應該替換掉 value
    SymbolRegistry.set(node, b);
    expect(SymbolRegistry.get(node)).toBe(b);

    // 驗證屬性仍為 non-enumerable & configurable
    const desc = Object.getOwnPropertyDescriptor(node as any, EffectSlot);
    expect(desc!.enumerable).toBe(false);
    expect(desc!.configurable).toBe(true);
  });

  it('operations are per-node isolated (setting on one node does not affect others)', () => {
    const n1 = makeNode();
    const n2 = makeNode();
    const inst = makeEffect();

    SymbolRegistry.set(n1, inst);
    expect(SymbolRegistry.get(n1)).toBe(inst);
    expect(SymbolRegistry.get(n2)).toBeUndefined();

    SymbolRegistry.delete(n1);
    expect(SymbolRegistry.get(n1)).toBeUndefined();
    expect(SymbolRegistry.get(n2)).toBeUndefined();
  });

  it('delete() on a node without the property is safe (no throw)', () => {
    const node = makeNode();
    expect(() => SymbolRegistry.delete(node)).not.toThrow();
    expect(SymbolRegistry.get(node)).toBeUndefined();
  });
});
