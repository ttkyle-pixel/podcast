ALTER TABLE works ADD COLUMN season_number INTEGER NOT NULL DEFAULT 2;

UPDATE works
SET issue_number = CASE
  WHEN lower(issue_number) LIKE 'season2 %' THEN ltrim(substr(issue_number, 9))
  WHEN lower(issue_number) LIKE 'season 2 %' THEN ltrim(substr(issue_number, 10))
  ELSE issue_number
END;

CREATE INDEX IF NOT EXISTS idx_works_season_date
ON works(season_number DESC, published_at DESC, id DESC);
