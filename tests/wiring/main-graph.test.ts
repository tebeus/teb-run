import { describe, expect, test } from 'vitest';
// `?raw` è il modo di Vite di importare un file come testo: `@types/node` non è
// fra le dipendenze, quindi `node:fs` non sarebbe compilabile.
import MAIN from '../../src/main.ts?raw';

/**
 * `src/main.ts` tocca il DOM e non si può importare in Node, ma la scelta del
 * grafo è una riga di testo: leggerla è l'unico modo di impedire che il gioco
 * torni a girare sul grafo di prova senza che nessun test se ne accorga.
 */
describe('src/main.ts graph wiring', () => {
  test('imports REAL_GRAPH from game/stages', () => {
    expect(MAIN).toMatch(/import\s*\{[^}]*\bREAL_GRAPH\b[^}]*\}\s*from\s*'\.\/game\/stages'/);
  });

  test('binds the local graph const to REAL_GRAPH', () => {
    expect(MAIN).toMatch(/const\s+graph\s*=\s*REAL_GRAPH\s*;/);
  });

  test('takes the first stage from the graph instead of a literal', () => {
    // `main.ts` del binario E legge la const locale: `graph.first()`. F accetta
    // entrambe le forme, perché scambiare la const è già sufficiente.
    expect(MAIN).toMatch(/firstStage:\s*(graph|REAL_GRAPH)\.first\(\)/);
  });

  test('never mentions the demo graph or the demo stage', () => {
    expect(MAIN).not.toContain('DEMO_GRAPH');
    expect(MAIN).not.toContain('demo-graph');
    expect(MAIN).not.toContain('DEMO_STAGE');
    expect(MAIN).not.toContain('demo-stage');
  });
});
