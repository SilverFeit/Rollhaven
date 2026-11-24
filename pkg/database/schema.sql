CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
    current_turn_index INTEGER DEFAULT 0,
    active_campaign_id TEXT DEFAULT 'default',
    fog_enabled INTEGER DEFAULT 0,
    fog_revealed_json TEXT DEFAULT '[]',
    round_number INTEGER DEFAULT 1,
    scene_cards_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    system_name TEXT DEFAULT 'D&D 5e / Universal',
    status TEXT DEFAULT 'ACTIVE',
    settings_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_sessions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
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
    role TEXT DEFAULT 'PLAYER',
    membership_status TEXT DEFAULT 'ACTIVE',
    conditions_json TEXT DEFAULT '[]',
    aura_radius INTEGER DEFAULT 0,
    aura_color TEXT DEFAULT '#a855f7',
    stats_json TEXT DEFAULT '{}',
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
    campaign_id TEXT DEFAULT 'default',
    player_id TEXT DEFAULT '',
    roller_id TEXT DEFAULT '',
    player_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT NOT NULL,
    visibility TEXT DEFAULT 'PUBLIC',
    command_id TEXT DEFAULT '',
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
    conditions_json TEXT DEFAULT '[]',
    aura_radius INTEGER DEFAULT 0,
    aura_color TEXT DEFAULT '',
    in_initiative INTEGER DEFAULT 0,
    initiative INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS map_scenes (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    map_rows INTEGER DEFAULT 12,
    map_cols INTEGER DEFAULT 16,
    map_image_path TEXT DEFAULT '',
    map_grid_color TEXT DEFAULT '#ffffff',
    map_grid_opacity REAL DEFAULT 0.35,
    fog_enabled INTEGER DEFAULT 0,
    fog_revealed_json TEXT DEFAULT '[]',
    entities_json TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_notes (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT DEFAULT 'Diario',
    visibility TEXT DEFAULT 'PRIVATE',
    recipients_json TEXT DEFAULT '[]',
    allow_edit INTEGER DEFAULT 0,
    version INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_role TEXT DEFAULT 'PLAYER',
    author_color TEXT DEFAULT '#a855f7',
    body TEXT NOT NULL,
    visibility TEXT DEFAULT 'CAMPAIGN',
    recipients_json TEXT DEFAULT '[]',
    command_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roll_tables (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    entries_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_commands (
    command_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    result_json TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaign_sessions_campaign ON campaign_sessions(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_notes_campaign ON campaign_notes(campaign_id, visibility, updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_campaign ON chat_messages(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roll_tables_campaign ON roll_tables(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_campaign ON audit_events(campaign_id, id);
CREATE INDEX IF NOT EXISTS idx_action_log_campaign ON action_log(campaign_id, visibility, id);
