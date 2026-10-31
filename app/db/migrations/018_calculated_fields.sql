-- Calculated fields (owner 2026-10-31): a custom number field may carry a formula (domain/formula.js). The formula is stored with field ids
-- ({12}), so renaming a field never breaks it. Results are stored in custom_values like any other value; every version of a formula is kept.
ALTER TABLE custom_fields ADD COLUMN formula TEXT;      -- NULL = an ordinary field; the type of a calculated field is 'number'
ALTER TABLE custom_fields ADD COLUMN decimals INTEGER;  -- decimals of the result (calculated fields only)

CREATE TABLE custom_formula_history (
  id         INTEGER PRIMARY KEY,
  field_id   INTEGER NOT NULL REFERENCES custom_fields(id),
  formula    TEXT NOT NULL,
  decimals   INTEGER,
  changed_at TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_custom_formula_history_field ON custom_formula_history(field_id, id);
