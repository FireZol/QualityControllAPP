-- The first build is the conductor QC measuring tool. Finished-cable testing, batches/certificates and
-- analytics stay in the code but are switched off until the owner turns them on (Setări -> Module).
-- Existing data is untouched; the finished-cable family is only hidden when nothing was measured on it.
UPDATE product_families SET active = 0
 WHERE code = 'CABLE_LV' AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.family_id = product_families.id);
