import type { StageDef } from '../types';
import type { StageGraph } from './stage-graph';

/**
 * Il grafo `graph` con il traffico del giorno (sfida DAILY): ogni tappa che
 * esce da `first` e `next` riceve `trafficSalt`, come `modeGraph` le dà la
 * modalità. Il motore di gara non sa niente della sfida; tracciato, tempi e
 * finali restano quelli del grafo sotto. Pura.
 */
export function dailyGraph(graph: StageGraph, trafficSalt: number): StageGraph {
  const salted = (stage: StageDef): StageDef => ({ ...stage, trafficSalt });
  return {
    first: () => salted(graph.first()),
    next(stage, side) {
      const next = graph.next(stage, side);
      return next === null ? null : salted(next);
    },
    endingOf: (stage) => graph.endingOf(stage),
  };
}
