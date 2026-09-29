-- MEDS v8.6 exit-liquidity cohort.
-- Execution-model and risk-gate change, so it is a new strategy cohort:
--   * dust equity exits may fill up to one share against a fresh displayed bid
--   * unresolved exit intents block entries only above 5% of starting equity
--   * entries below $2.50 modeled notional are rejected
-- v8.5 trades, positions and events are preserved unchanged and keep their
-- own version tag. Open v8.5 positions close into the v8.5 cohort.
-- No schema change; paper_meta stays at 13. Live execution remains disabled.

UPDATE leader_runtime_config
SET account_id='H250',
    version='leader-hunt-v8.6-exit-liquidity',
    normal_enabled=0
WHERE id=1;
