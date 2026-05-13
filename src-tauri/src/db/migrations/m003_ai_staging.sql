CREATE TABLE proposal (
    id INTEGER PRIMARY KEY,
    ai_run_id INTEGER NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('codebook_gen','pretag','find_more')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','rejected')),
    created_at TEXT NOT NULL,
    decided_at TEXT
);
CREATE INDEX idx_proposal_run ON proposal(ai_run_id);
