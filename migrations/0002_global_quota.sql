-- Keep existing visitor allowances; expire only temporary daily counters/claims.
ALTER TABLE demo_claims ADD COLUMN global_day TEXT NOT NULL DEFAULT '';
ALTER TABLE demo_counters ADD COLUMN expires_at INTEGER;
UPDATE demo_claims SET global_day=strftime('%Y-%m-%d',created_at / 1000,'unixepoch');
INSERT INTO demo_counters(scope,identifier,used,expires_at) SELECT 'global',global_day,count(*),max(created_at)+604800000 FROM demo_claims GROUP BY global_day;
CREATE INDEX demo_claim_age ON demo_claims(created_at);
CREATE INDEX demo_counter_expiry ON demo_counters(expires_at);
UPDATE demo_counters SET expires_at = unixepoch() * 1000 + 604800000 WHERE scope = 'network';
DROP TRIGGER debit_demo_quota;
CREATE TRIGGER debit_demo_quota AFTER INSERT ON demo_claims
BEGIN
  INSERT INTO demo_counters(scope,identifier,used) VALUES ('visitor',NEW.visitor,1)
    ON CONFLICT(scope,identifier) DO UPDATE SET used=used+1;
  INSERT INTO demo_counters(scope,identifier,used,expires_at) VALUES ('network',NEW.network_day,1,NEW.created_at+604800000)
    ON CONFLICT(scope,identifier) DO UPDATE SET used=used+1;
  INSERT INTO demo_counters(scope,identifier,used,expires_at) VALUES ('global',NEW.global_day,1,NEW.created_at+604800000)
    ON CONFLICT(scope,identifier) DO UPDATE SET used=used+1;
  DELETE FROM demo_claims WHERE created_at < NEW.created_at-604800000;
  DELETE FROM demo_counters WHERE expires_at < NEW.created_at;
END;
