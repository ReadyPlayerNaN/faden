PRAGMA foreign_keys=OFF;

CREATE TABLE segment_new (
    id INTEGER PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interview(id) ON DELETE CASCADE,
    speaker_id INTEGER REFERENCES speaker(id) ON DELETE SET NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    text TEXT NOT NULL,
    order_index INTEGER NOT NULL
);

INSERT INTO segment_new (id, interview_id, speaker_id, start_sec, end_sec, text, order_index)
SELECT id, interview_id, speaker_id, start_sec, end_sec, text, order_index
FROM segment;

DROP TABLE segment;
ALTER TABLE segment_new RENAME TO segment;
CREATE INDEX idx_segment_interview ON segment(interview_id, order_index);

PRAGMA foreign_keys=ON;
