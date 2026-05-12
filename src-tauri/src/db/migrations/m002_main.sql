CREATE TABLE interview (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    recorded_at TEXT,
    audio_path TEXT,
    notes TEXT,
    transcript_status TEXT NOT NULL
        CHECK (transcript_status IN ('none','in_progress','complete','failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE speaker (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    label_raw TEXT NOT NULL,
    display_name TEXT,
    UNIQUE(interview_id, label_raw)
);

CREATE TABLE segment (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speaker(id),
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    text TEXT NOT NULL,
    order_index INTEGER NOT NULL
);
CREATE INDEX idx_segment_interview ON segment(interview_id, order_index);

CREATE TABLE cluster (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE category (
    id INTEGER PRIMARY KEY,
    cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tag (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);

CREATE TABLE tagged_span (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text_snapshot TEXT NOT NULL,
    audio_start_sec REAL NOT NULL,
    audio_end_sec REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_span_interview ON tagged_span(interview_id);
CREATE INDEX idx_span_segment ON tagged_span(segment_id);

CREATE TABLE span_tag (
    span_id INTEGER NOT NULL REFERENCES tagged_span(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE RESTRICT,
    source TEXT NOT NULL
        CHECK (source IN ('manual','ai_suggested','ai_accepted')),
    PRIMARY KEY (span_id, tag_id)
);

CREATE TABLE memo (
    id INTEGER PRIMARY KEY,
    span_id INTEGER NOT NULL UNIQUE REFERENCES tagged_span(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE ai_run (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL
        CHECK (kind IN ('transcribe','pretag','codebook_gen','find_more')),
    interview_id INTEGER REFERENCES interview(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('running','complete','failed','cancelled')),
    error TEXT,
    token_usage_json TEXT,
    result_summary TEXT
);
