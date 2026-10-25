-- La classifica mondiale e la sfida giornaliera (spec §2.1). Nessun IP,
-- nessun user agent, nessun identificativo del giocatore.
CREATE TABLE scores (
  id          INTEGER PRIMARY KEY,
  board       TEXT    NOT NULL CHECK (board IN ('run', 'daily')),
  day         TEXT    NOT NULL,
  mode        TEXT    NOT NULL CHECK (mode IN ('normal', 'hard')),
  initials    TEXT    NOT NULL CHECK (length(initials) = 3),
  score       INTEGER NOT NULL CHECK (score >= 0),
  car         TEXT    NOT NULL CHECK (car IN ('new', 'retro', 'sport', 'super')),
  stage_id    TEXT    NOT NULL,
  route       TEXT    NOT NULL,
  ending      INTEGER,
  duration_ms INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scores_board ON scores (board, mode, day, hidden, score DESC);
CREATE INDEX scores_all ON scores (board, mode, hidden, score DESC);
CREATE INDEX scores_new ON scores (created_at DESC);

-- Quante partite il server rifiuta, per giorno e motivo, senza nessun dato
-- della partita (spec §2.4a): per vedere subito se i limiti tagliano partite vere.
CREATE TABLE rejections (
  day    TEXT    NOT NULL,
  reason TEXT    NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason)
);
