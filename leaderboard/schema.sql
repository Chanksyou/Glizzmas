CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  name TEXT,
  score INTEGER CHECK (score BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS runs_top_scores ON runs (score DESC, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS runs_pending ON runs (created_at) WHERE score IS NULL;
