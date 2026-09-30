-- Each user picks the language of the screens (ro, en; hu may follow). NULL = the application default (Romanian).
ALTER TABLE users ADD COLUMN language TEXT;
