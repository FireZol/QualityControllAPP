-- Default custom values of a meeting series (pre-release list, item 8): every meeting the series makes starts with them, and can be changed
-- by hand afterwards. One row per series and field; an empty default is stored as '' (nothing is deleted).
CREATE TABLE meeting_series_custom (
  series_id INTEGER NOT NULL REFERENCES meeting_series(id),
  field_id  INTEGER NOT NULL REFERENCES custom_fields(id),
  value     TEXT NOT NULL,
  PRIMARY KEY (series_id, field_id)
);
