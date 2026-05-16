CREATE TABLE category_new (
    id INTEGER PRIMARY KEY,
    cluster_id INTEGER REFERENCES cluster(id) ON DELETE RESTRICT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    order_index INTEGER NOT NULL
);
INSERT INTO category_new (id, cluster_id, name, description, color, order_index)
SELECT id, cluster_id, name, description, color, order_index FROM category;
DROP TABLE category;
ALTER TABLE category_new RENAME TO category;
