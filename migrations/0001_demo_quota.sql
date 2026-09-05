-- Only pseudonymous quota identifiers; never audio, vocabulary or provider keys.
CREATE TABLE IF NOT EXISTS demo_counters (
  scope TEXT NOT NULL,
  identifier TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, identifier)
);
CREATE TABLE IF NOT EXISTS demo_claims (
  id TEXT PRIMARY KEY,
  visitor TEXT NOT NULL,
  network_day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS debit_demo_quota AFTER INSERT ON demo_claims
BEGIN
  INSERT INTO demo_counters(scope, identifier, used) VALUES ('visitor', NEW.visitor, 1)
    ON CONFLICT(scope, identifier) DO UPDATE SET used = used + 1;
  INSERT INTO demo_counters(scope, identifier, used) VALUES ('network', NEW.network_day, 1)
    ON CONFLICT(scope, identifier) DO UPDATE SET used = used + 1;
END;
