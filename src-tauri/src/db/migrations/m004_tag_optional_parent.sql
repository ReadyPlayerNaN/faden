CREATE TABLE tag_new (
    id INTEGER PRIMARY KEY,
    category_id INTEGER REFERENCES category(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);
INSERT INTO tag_new (id, category_id, name, description, color, order_index)
SELECT id, category_id, name, description, color, order_index FROM tag;
DROP TABLE tag;
ALTER TABLE tag_new RENAME TO tag;
