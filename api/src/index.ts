// Il Worker della classifica mondiale e della sfida giornaliera di TEB RUN:
// l'ingresso esporta solo il gestore (workerd non accetta altro), la logica
// sta in `app.ts`.

import { handle } from './app';
import type { Env } from './env';
import { empty, secure } from './http';

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return secure(await handle(request, env));
    } catch {
      // Niente dettagli fuori, niente corpi nei log.
      return secure(empty(500));
    }
  },
} satisfies ExportedHandler<Env>;
