// GENERATO da `npm run gen:limits` (tests/shared/limits-table.test.ts): non
// modificare a mano. I numeri del gioco che servono al server per i controlli
// di plausibilità (spec classifica e sfida, §2.4), senza importare motore,
// sprite e catalogo. Un test fallisce se il gioco cambia e questa tabella no.

export const LIMITS = {
  "maxSpeedSegmentsPerSecond": 60,
  "scoreRate": 100,
  "levelScoreStep": 0.25,
  "overtakePoints": 50,
  "checkpointBonusPerSecond": 1000,
  "finishBonusPerSecond": 5000,
  "gameoverDecelS": 2,
  "lastLevel": 4,
  "endingCount": 5,
  "stages": {
    "0-0": {
      "level": 0,
      "index": 0,
      "length": 3256,
      "limit": {
        "normal": 110,
        "hard": 75
      },
      "grace": {
        "normal": 30,
        "hard": 0
      },
      "cars": {
        "normal": 42,
        "hard": 67
      }
    },
    "1-0": {
      "level": 1,
      "index": 0,
      "length": 3343,
      "limit": {
        "normal": 73,
        "hard": 70
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 55,
        "hard": 88
      }
    },
    "1-1": {
      "level": 1,
      "index": 1,
      "length": 3343,
      "limit": {
        "normal": 70,
        "hard": 67
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 55,
        "hard": 88
      }
    },
    "2-0": {
      "level": 2,
      "index": 0,
      "length": 3429,
      "limit": {
        "normal": 85,
        "hard": 80
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 68,
        "hard": 108
      }
    },
    "2-1": {
      "level": 2,
      "index": 1,
      "length": 3429,
      "limit": {
        "normal": 79,
        "hard": 76
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 68,
        "hard": 108
      }
    },
    "2-2": {
      "level": 2,
      "index": 2,
      "length": 3429,
      "limit": {
        "normal": 77,
        "hard": 74
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 68,
        "hard": 108
      }
    },
    "3-0": {
      "level": 3,
      "index": 0,
      "length": 3516,
      "limit": {
        "normal": 86,
        "hard": 87
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 81,
        "hard": 129
      }
    },
    "3-1": {
      "level": 3,
      "index": 1,
      "length": 3527,
      "limit": {
        "normal": 89,
        "hard": 87
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 82,
        "hard": 132
      }
    },
    "3-2": {
      "level": 3,
      "index": 2,
      "length": 3516,
      "limit": {
        "normal": 85,
        "hard": 82
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 81,
        "hard": 129
      }
    },
    "3-3": {
      "level": 3,
      "index": 3,
      "length": 3544,
      "limit": {
        "normal": 88,
        "hard": 84
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 85,
        "hard": 136
      }
    },
    "4-0": {
      "level": 4,
      "index": 0,
      "length": 3602,
      "limit": {
        "normal": 90,
        "hard": 89
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 94,
        "hard": 150
      }
    },
    "4-1": {
      "level": 4,
      "index": 1,
      "length": 3631,
      "limit": {
        "normal": 89,
        "hard": 88
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 98,
        "hard": 157
      }
    },
    "4-2": {
      "level": 4,
      "index": 2,
      "length": 3602,
      "limit": {
        "normal": 90,
        "hard": 91
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 94,
        "hard": 150
      }
    },
    "4-3": {
      "level": 4,
      "index": 3,
      "length": 3660,
      "limit": {
        "normal": 93,
        "hard": 87
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 102,
        "hard": 164
      }
    },
    "4-4": {
      "level": 4,
      "index": 4,
      "length": 3573,
      "limit": {
        "normal": 80,
        "hard": 75
      },
      "grace": {
        "normal": 0,
        "hard": 0
      },
      "cars": {
        "normal": 89,
        "hard": 143
      }
    }
  }
} as const;

export type StageLimits = (typeof LIMITS.stages)[keyof typeof LIMITS.stages];

/** I limiti della tappa `id`, o null se non è una delle 15. Pura. */
export function stageLimits(id: string): StageLimits | null {
  return Object.prototype.hasOwnProperty.call(LIMITS.stages, id) ? LIMITS.stages[id as keyof typeof LIMITS.stages] : null;
}

/** La tappa dopo `id` dal lato `side` (griglia triangolare), o null. Pura. */
export function nextStageId(id: string, side: 'L' | 'R'): string | null {
  const s = stageLimits(id);
  if (s === null) return null;
  const next = `${s.level + 1}-${side === 'L' ? s.index : s.index + 1}`;
  return stageLimits(next) === null ? null : next;
}

/** Il finale 1..5 dell'ultima tappa `id`, o null fuori dall'ultimo livello. Pura. */
export function endingOfStage(id: string): number | null {
  const s = stageLimits(id);
  if (s === null || s.level !== LIMITS.lastLevel) return null;
  return Math.min(s.index, LIMITS.endingCount - 1) + 1;
}
