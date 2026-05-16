CREATE TABLE ai_run_stage (
    id INTEGER PRIMARY KEY,
    ai_run_id INTEGER NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL
        CHECK (stage_key IN (
            'analyze_source',
            'prepare_chunks',
            'encode_chunks',
            'transcribe_chunks',
            'compose_transcript',
            'finalize'
        )),
    order_index INTEGER NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('pending','running','complete','failed','cancelled','retrying','skipped')),
    total_count INTEGER,
    completed_count INTEGER,
    failed_count INTEGER,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (ai_run_id, stage_key)
);
CREATE INDEX idx_ai_run_stage_run ON ai_run_stage(ai_run_id, order_index);

CREATE TABLE ai_run_task (
    id INTEGER PRIMARY KEY,
    ai_run_stage_id INTEGER NOT NULL REFERENCES ai_run_stage(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('encode_chunk','transcribe_chunk')),
    chunk_index INTEGER NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('pending','running','complete','failed','cancelled','retrying','skipped')),
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (ai_run_stage_id, chunk_index)
);
CREATE INDEX idx_ai_run_task_stage ON ai_run_task(ai_run_stage_id, chunk_index);
