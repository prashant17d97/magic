import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

/** jsdom has no clipboard, and ObjectId is built around copy-to-clipboard. */
Object.assign(navigator, {
  clipboard: { writeText: vi.fn(async () => undefined) },
});

/** Recharts measures its container, which jsdom reports as zero. */
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
