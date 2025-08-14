import { describe, it, expect } from 'vitest';
import {
  type Node,
  type Kind,
  link,
  unlink,
  withObserver,
  track,
} from '../graph.js';

function makeNode(kind: Kind): Node {
  return {
    kind,
    deps: new Set<Node>(),
    subs: new Set<Node>(),
  };
}

describe('graph link/unlink', () => {
  it('link: adds bidirectional edges (from.deps, to.subs)', () => {
    const from = makeNode('computed');
    const to = makeNode('signal');

    link(from, to);

    expect(from.deps.has(to)).toBe(true);
    expect(to.subs.has(from)).toBe(true);
  });

  it('link: prevents signal -> * dependencies', () => {
    const from = makeNode('signal');
    const to = makeNode('computed');

    expect(() => link(from, to)).toThrowError(
      /Signal nodes cannot depend on others/
    );
  });

  it('link: idempotent for duplicate calls due to Set semantics', () => {
    const from = makeNode('computed');
    const to = makeNode('signal');

    link(from, to);
    link(from, to); // duplicate

    expect(from.deps.size).toBe(1);
    expect(to.subs.size).toBe(1);
  });

  it('unlink: removes bidirectional edges', () => {
    const from = makeNode('computed');
    const to = makeNode('signal');

    link(from, to);
    unlink(from, to);

    expect(from.deps.has(to)).toBe(false);
    expect(to.subs.has(from)).toBe(false);
  });

  it('unlink: safe if edge does not exist', () => {
    const from = makeNode('computed');
    const to = makeNode('signal');

    // no link
    unlink(from, to); // should not throw

    expect(from.deps.size).toBe(0);
    expect(to.subs.size).toBe(0);
  });
});

describe('withObserver + track', () => {
  it('track: no-op when there is no current observer', () => {
    const dep = makeNode('signal');
    // 呼叫 track，但沒有 withObserver 作用中
    track(dep);
    // 既沒有 observer，也不會有任何邊
    expect(dep.subs.size).toBe(0);
    expect(dep.deps.size).toBe(0);
  });

  it('track: creates edge currentObserver -> dep', () => {
    const obs = makeNode('effect');
    const dep = makeNode('signal');

    withObserver(obs, () => {
      track(dep);
    });

    expect(obs.deps.has(dep)).toBe(true);
    expect(dep.subs.has(obs)).toBe(true);
  });

  it('track: repeated track is idempotent due to Set', () => {
    const obs = makeNode('computed');
    const dep = makeNode('signal');

    withObserver(obs, () => {
      track(dep);
      track(dep);
    });

    expect(obs.deps.size).toBe(1);
    expect(dep.subs.size).toBe(1);
  });

  it('withObserver: restores previous observer (nesting)', () => {
    const outer = makeNode('effect');
    const inner = makeNode('computed');
    const dep1 = makeNode('signal');
    const dep2 = makeNode('signal');

    withObserver(outer, () => {
      // outer 觀察
      track(dep1);

      withObserver(inner, () => {
        // inner 觀察
        track(dep2);
      });

      // 回到 outer
      track(dep1);
    });

    // outer 應該只連到 dep1
    expect(outer.deps.has(dep1)).toBe(true);
    expect(outer.deps.has(dep2)).toBe(false);
    expect(dep1.subs.has(outer)).toBe(true);

    // inner 應該只連到 dep2
    expect(inner.deps.has(dep2)).toBe(true);
    expect(inner.deps.has(dep1)).toBe(false);
    expect(dep2.subs.has(inner)).toBe(true);
  });

  it('track: throws when current observer is a signal (because link checks it)', () => {
    const observer = makeNode('signal');
    const dep = makeNode('signal');

    expect(() =>
      withObserver(observer, () => {
        track(dep);
      })
    ).toThrowError(/Signal nodes cannot depend on others/);
  });
});
