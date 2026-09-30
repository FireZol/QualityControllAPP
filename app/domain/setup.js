'use strict';
// The "first setup" checklist on the home page (Administrator and Inginer only). Each step is worked out from the data,
// so it ticks itself off; the panel disappears once every step is done.
const backup = require('../lib/backup');

function checklist(db, config) {
  // data sheets of the families that are switched on: each needs an active revision before anyone can measure
  const docs = db.all(`SELECT d.id, EXISTS (SELECT 1 FROM spec_revisions r WHERE r.document_id = d.id AND r.status = 'activa') AS has_active
    FROM spec_documents d JOIN product_families f ON f.id = d.family_id
    WHERE f.active = 1 OR EXISTS (SELECT 1 FROM product_families g WHERE g.active = 1 AND json_extract(g.measures, '$.spec_family') = f.code)`);
  const sheetsActive = docs.filter((d) => d.has_active).length;
  const engineers = db.value("SELECT count(*) FROM users WHERE role = 'inginer' AND active = 1");
  const crewsEdited = !!db.get("SELECT 1 FROM audit_log WHERE action = 'list_edit' AND entity = 'crews'");
  const backups = backup.listBackups(backup.backupDir(db, config)).length;
  return [
    { key: 'engineers', done: engineers >= 2, n: engineers, href: '/admin/utilizatori' },
    { key: 'sheets', done: docs.length > 0 && sheetsActive === docs.length, n: sheetsActive, total: docs.length, href: '/fise' },
    { key: 'crews', done: crewsEdited, href: '/liste/schimburi' },
    { key: 'backup', done: backups > 0, href: '/admin/setari' },
  ];
}

const isComplete = (items) => items.every((i) => i.done);

module.exports = { checklist, isComplete };
