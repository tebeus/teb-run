// `window.__tebrun` è dichiarato in src/main.ts, che gli e2e non importano:
// questa dichiarazione dà a `npx tsc --noEmit` lo stesso tipo.
import type { DebugHandles } from '../src/main';

declare global {
  interface Window {
    __tebrun?: DebugHandles;
  }
}
