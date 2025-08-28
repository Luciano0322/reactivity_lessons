import '@testing-library/jest-dom/vitest';
// minimal shim so testing-library's fireEvent can read process.env
// (only what it touches;不會汙染 node 環境)
Object.defineProperty(globalThis as any, 'process', {
  value: { env: { NODE_ENV: 'test' } },
  writable: false,
});
