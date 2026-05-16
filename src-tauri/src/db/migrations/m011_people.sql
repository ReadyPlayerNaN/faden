CREATE TABLE person (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

ALTER TABLE speaker ADD COLUMN person_id INTEGER REFERENCES person(id) ON DELETE SET NULL;
CREATE INDEX idx_speaker_person_id ON speaker(person_id);
