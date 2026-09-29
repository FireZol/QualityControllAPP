-- Stage 3: flexible class 5 conductors (suvita, toron, lita) become active for measurement.
-- On a fresh database this is a no-op: the first-start seed already holds the final state.
UPDATE product_families SET active = 1 WHERE code = 'FLEXIBIL_CL5';

-- one default machine for every process that had none (names are editable in Nomenclatoare -> Utilaje)
INSERT INTO machines(name, machine_type_id)
  SELECT 'TREFILARE 1', t.id FROM machine_types t WHERE t.name = 'Trefilare' AND NOT EXISTS (SELECT 1 FROM machines WHERE name = 'TREFILARE 1');
INSERT INTO machines(name, machine_type_id)
  SELECT 'TREFILARE MF 1', t.id FROM machine_types t WHERE t.name = 'Trefilare multifilară' AND NOT EXISTS (SELECT 1 FROM machines WHERE name = 'TREFILARE MF 1');
