CREATE TABLE download_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_mbps REAL NOT NULL CHECK (public_mbps >= 0),
    admin_mbps REAL NOT NULL CHECK (admin_mbps >= 0)
) STRICT;

INSERT INTO download_settings VALUES (1, 2, 0);
