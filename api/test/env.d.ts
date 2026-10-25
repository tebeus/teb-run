// `env` di `cloudflare:workers` nei test ha i binding del Worker.
import type { Env as WorkerEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
