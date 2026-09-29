-- Stage 2: wire measurement (class I-II and class V) and the owner's corrections of 2026-09-29.
-- On a fresh database every statement is a no-op (tables are still empty): the first-start seed already holds the final state.

-- RM is checked against the compacted minimum number of wires (Al 50 RM: min 6)
UPDATE shapes SET iec_group = 'compactat' WHERE code = 'RM' AND iec_group = 'circular';

-- extruded Al conductors need a machine
INSERT INTO machines(name, machine_type_id)
  SELECT 'Conform Extruder', t.id FROM machine_types t
   WHERE t.name = 'Sector / extrudare' AND NOT EXISTS (SELECT 1 FROM machines WHERE name = 'Conform Extruder');

-- wire families become active for measurement; class V wire reads its constructions from the class V data sheet
UPDATE product_families SET active = 1 WHERE code = 'SARMA_CL12';
UPDATE product_families SET active = 1, measures = json_set(measures, '$.spec_family', 'FLEXIBIL_CL5') WHERE code = 'SARMA_CL5';

-- class V wire diameter: nominal from the sheet, min / max undetermined until the engineers set them
INSERT INTO limits(construction_id, level, quantity, nominal, min, max, unit, informative, tolerance_text)
  SELECT c.id, 'sarma', 'd', c.wire_d, NULL, NULL, 'mm', 0, NULL
    FROM constructions c JOIN product_families f ON f.id = c.family_id
   WHERE f.code = 'FLEXIBIL_CL5' AND c.wire_d IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM limits l WHERE l.construction_id = c.id AND l.level = 'sarma' AND l.quantity = 'd');
