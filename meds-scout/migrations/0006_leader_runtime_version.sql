-- Align the singleton active Leader runtime configuration with the deployed
-- strategy policy. Financial history and historical account rows are untouched.
UPDATE leader_runtime_config
SET account_id='H250',
    version='leader-hunt-v8.3-capital-rotation',
    normal_enabled=0
WHERE id=1;
