import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { useSignalRef, useComputedRef } from '../src/hook/vue_adapter.js';
import { signal } from '../src/core/signal.js';

/** flush 自家 scheduler 的 microtask + Vue 的 nextTick */
async function flushAll(times = 2) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await nextTick();
}

describe('useSignalRef', () => {
  it('初始值等於 peek()；來源變動後會更新 Vue ref 與畫面', async () => {
    const s = signal(1);

    const Comp = defineComponent({
      setup() {
        const r = useSignalRef(s);
        return () => h('div', { 'data-testid': 'v' }, String(r.value));
      },
    });

    const wrapper = mount(Comp);
    // 初始快照
    expect(wrapper.get('[data-testid="v"]').text()).toBe('1');

    // 來源更新
    s.set(2);
    await flushAll();
    expect(wrapper.get('[data-testid="v"]').text()).toBe('2');

    s.set(5);
    await flushAll();
    expect(wrapper.get('[data-testid="v"]').text()).toBe('5');
  });

  it('元件卸載後更新來源不會噴錯（訂閱已解除）', async () => {
    const s = signal(10);

    const Comp = defineComponent({
      setup() {
        const r = useSignalRef(s);
        return () => h('div', { 'data-testid': 'v' }, String(r.value));
      },
    });

    const wrapper = mount(Comp);
    expect(wrapper.get('[data-testid="v"]').text()).toBe('10');

    await wrapper.unmount();

    // 卸載後更新：不應噴錯
    s.set(11);
    await flushAll();
    // 已卸載，無可斷言畫面；只要不 throw 即可
  });
});

describe('useComputedRef', () => {
  it('能從來源 signal 計算並在變更時更新', async () => {
    const a = signal(1);
    const b = signal(2);

    const Comp = defineComponent({
      setup() {
        const sum = useComputedRef(() => a.get() + b.get());
        return () => h('div', { 'data-testid': 'sum' }, String(sum.value));
      },
    });

    const wrapper = mount(Comp);

    // 初次會先用 peek 暖機，畫面應有初值
    expect(wrapper.get('[data-testid="sum"]').text()).toBe('3');

    a.set(10);
    b.set(20);
    await flushAll();
    expect(wrapper.get('[data-testid="sum"]').text()).toBe('30');

    // 卸載後更新來源不應噴錯（computed 已 dispose）
    await wrapper.unmount();
    a.set(100);
    b.set(200);
    await flushAll();
  });

  it('支援 equals：相等時不更新，不相等時更新', async () => {
    const src = signal({ n: 1, tag: 'x' });

    // 只比較 n 是否相等
    const Comp = defineComponent({
      setup() {
        const ref = useComputedRef(
          () => src.get(),
          (a, b) => a.n === b.n,
        );
        return () =>
          h(
            'div',
            { 'data-testid': 'obj' },
            JSON.stringify(ref.value),
          );
      },
    });

    const wrapper = mount(Comp);

    // 先觸發一次「不相等」讓畫面穩定
    src.set({ n: 2, tag: 'first' });
    await flushAll();
    const shown = wrapper.get('[data-testid="obj"]').text();

    // 相等（n 相同）：畫面不變
    src.set({ n: 2, tag: 'changed-but-equal' });
    await flushAll();
    const afterEqual = wrapper.get('[data-testid="obj"]').text();
    expect(afterEqual).toBe(shown);

    // 不相等（n 改變）：畫面更新
    src.set({ n: 3, tag: 'diff' });
    await flushAll();
    const afterDiff = wrapper.get('[data-testid="obj"]').text();
    expect(afterDiff).not.toBe(shown);
  });
});
