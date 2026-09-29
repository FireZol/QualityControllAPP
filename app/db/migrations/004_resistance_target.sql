-- The engineers may set the resistance target (R max at 20 C) on a data sheet row: `limits` gains quantity 'r20'.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt (nothing references `limits`).
CREATE TABLE limits_new (
  id INTEGER PRIMARY KEY,
  construction_id INTEGER NOT NULL REFERENCES constructions(id),
  level TEXT NOT NULL CHECK (level IN ('sarma','funie','conductor','suvita','toron','lita')),
  quantity TEXT NOT NULL CHECK (quantity IN ('d','h','l','mass','r20')),
  nominal REAL, min REAL, max REAL,
  unit TEXT NOT NULL,
  informative INTEGER NOT NULL DEFAULT 0,
  tolerance_text TEXT,
  UNIQUE (construction_id, level, quantity)
);
INSERT INTO limits_new(id, construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text)
  SELECT id, construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text FROM limits;
DROP TABLE limits;
ALTER TABLE limits_new RENAME TO limits;
