export type Signal<T> = {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
};

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const get = () => value;
  const set = (next: T | ((p: T) => T)) => {
    const nxtVal = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
    const isEqual = Object.is(value, nxtVal);
    if (!isEqual) value = nxtVal;
  };
  return { get, set };
}
