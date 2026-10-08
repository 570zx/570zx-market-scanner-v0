-- Price levels / zones per watched symbol (JSON array of {low, high, label}).
ALTER TABLE watchlist ADD COLUMN levels TEXT;
-- Session of the latest bar (pre / regular / post) and the feed used.
ALTER TABLE snapshots ADD COLUMN session TEXT;
ALTER TABLE snapshots ADD COLUMN feed TEXT;
