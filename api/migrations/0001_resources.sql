CREATE TABLE resources (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    published_at INTEGER,
    expires_at INTEGER,
    CHECK ((published_at IS NULL) <> (expires_at IS NULL))
) STRICT;

CREATE INDEX resources_publication_order
    ON resources (published_at DESC, id DESC)
    WHERE published_at IS NOT NULL;

CREATE INDEX resources_expiration
    ON resources (expires_at)
    WHERE published_at IS NULL;

CREATE VIEW published_resources AS
    SELECT id, path, description, size_bytes, published_at
    FROM resources
    WHERE published_at IS NOT NULL;
