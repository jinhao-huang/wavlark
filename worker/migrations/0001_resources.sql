CREATE TABLE resources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    published_at INTEGER
) STRICT;

CREATE INDEX resources_publication_order
    ON resources (published_at DESC, id DESC)
    WHERE published_at IS NOT NULL;

CREATE VIEW published_resources AS
    SELECT id, name, description, size_bytes, published_at
    FROM resources
    WHERE published_at IS NOT NULL;
