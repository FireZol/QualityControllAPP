-- Marks the point from which passwords are stored with the stronger scrypt setting (N=65536) and upgraded silently at sign-in.
-- Programs older than this cannot check such passwords. A program that knows migrations only up to 15 either refuses this
-- database (from the audit build on) or - if older still - must be started on the backup taken just before this migration
-- ("Backup înainte de migrare" in the log, in the backup folder). See docs/SECURITY.md, "Going back to an older version".
CREATE TABLE IF NOT EXISTS app_info (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO app_info(key, value) VALUES ('password_hash', 'scrypt N=65536; older programs cannot sign in');
