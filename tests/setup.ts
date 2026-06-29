import "@testing-library/jest-dom/vitest";

const testStorage = new Map<string, string>();

const localStorageMock: Storage = {
  get length() {
    return testStorage.size;
  },
  clear() {
    testStorage.clear();
  },
  getItem(key: string) {
    return testStorage.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(testStorage.keys())[index] ?? null;
  },
  removeItem(key: string) {
    testStorage.delete(key);
  },
  setItem(key: string, value: string) {
    testStorage.set(key, String(value));
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});
