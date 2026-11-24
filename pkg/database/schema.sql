CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1,
    map_enabled INTEGER DEFAULT 0,
    map_rows INTEGER DEFAULT 10,
    map_cols INTEGER DEFAULT 10,
    map_image_path TEXT DEFAULT '',
    map_grid_color TEXT DEFAULT '#ffffff',
    map_grid_opacity REAL DEFAULT 0.35,
    current_turn_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    initiative INTEGER NOT NULL,
    race_icon TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    character_sheet_path TEXT DEFAULT '',
    token_x INTEGER DEFAULT 0,
    token_y INTEGER DEFAULT 0,
    token_hidden INTEGER DEFAULT 0,
    turn_order INTEGER DEFAULT 0,
    manual_order INTEGER DEFAULT 0,
    is_connected INTEGER DEFAULT 1,
    client_ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    latency_ms INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_notes (
    player_id TEXT PRIMARY KEY,
    content TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dm_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    player_id TEXT DEFAULT '',
    player_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT NOT NULL,
    result_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_entities (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    size INTEGER DEFAULT 1,
    color_hex TEXT NOT NULL,
    hp_current INTEGER DEFAULT 0,
    hp_max INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    is_hidden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);
