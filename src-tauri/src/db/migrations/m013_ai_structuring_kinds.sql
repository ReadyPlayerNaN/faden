PRAGMA foreign_keys=OFF;

CREATE TABLE ai_run_new (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL
        CHECK (kind IN ('transcribe','pretag','codebook_gen','find_more','categorize','cluster')),
    interview_id INTEGER REFERENCES interview(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('running','complete','failed','cancelled')),
    error TEXT,
    token_usage_json TEXT,
    result_summary TEXT,
    raw_output TEXT,
    input_json TEXT
);

INSERT INTO ai_run_new (
    id,
    kind,
    interview_id,
    model,
    prompt,
    started_at,
    completed_at,
    status,
    error,
    token_usage_json,
    result_summary,
    raw_output,
    input_json
)
SELECT
    id,
    kind,
    interview_id,
    model,
    prompt,
    started_at,
    completed_at,
    status,
    error,
    token_usage_json,
    result_summary,
    raw_output,
    input_json
FROM ai_run;

DROP TABLE ai_run;
ALTER TABLE ai_run_new RENAME TO ai_run;

CREATE TABLE proposal_new (
    id INTEGER PRIMARY KEY,
    ai_run_id INTEGER NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('codebook_gen','pretag','find_more','categorize','cluster')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','rejected')),
    created_at TEXT NOT NULL,
    decided_at TEXT
);

INSERT INTO proposal_new (id, ai_run_id, kind, payload_json, status, created_at, decided_at)
SELECT id, ai_run_id, kind, payload_json, status, created_at, decided_at
FROM proposal;

DROP TABLE proposal;
ALTER TABLE proposal_new RENAME TO proposal;
CREATE INDEX idx_proposal_run ON proposal(ai_run_id);

PRAGMA foreign_keys=ON;
