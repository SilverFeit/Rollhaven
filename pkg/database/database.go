package database

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// CurrentSchemaVersion tracks the SQLite migration version for Rollhaven.
const CurrentSchemaVersion = 4

// Open initializes a pure-Go SQLite database at dbPath, ensures its parent directory exists,
// configures WAL mode and foreign keys, and applies idempotent schema migrations.
func Open(dbPath string) (*sql.DB, error) {
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

	dsn := dbPath
	if dbPath != ":memory:" {
		dsn = fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)", dbPath)
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Single writer connection prevents SQLITE_BUSY under concurrent WebSocket bursts.
	db.SetMaxOpenConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	if dbPath == ":memory:" {
		if _, err := db.Exec("PRAGMA foreign_keys = ON;"); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("enable foreign keys: %w", err)
		}
	}

	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	if err := applyColumnMigrations(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply column migrations: %w", err)
	}

	if _, err := db.Exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`, CurrentSchemaVersion); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("record schema version: %w", err)
	}

	return db, nil
}

// applyColumnMigrations upgrades existing v1.x SQLite files cleanly without losing player/campaign data.
func applyColumnMigrations(db *sql.DB) error {
	alterStatements := []string{
		`ALTER TABLE sessions ADD COLUMN active_campaign_id TEXT DEFAULT 'default'`,
		`ALTER TABLE players ADD COLUMN role TEXT DEFAULT 'PLAYER'`,
		`ALTER TABLE players ADD COLUMN membership_status TEXT DEFAULT 'ACTIVE'`,
		`ALTER TABLE action_log ADD COLUMN campaign_id TEXT DEFAULT 'default'`,
		`ALTER TABLE action_log ADD COLUMN roller_id TEXT DEFAULT ''`,
		`ALTER TABLE action_log ADD COLUMN visibility TEXT DEFAULT 'PUBLIC'`,
		`ALTER TABLE action_log ADD COLUMN command_id TEXT DEFAULT ''`,
	}
	for _, stmt := range alterStatements {
		if _, err := db.Exec(stmt); err != nil {
			msg := strings.ToLower(err.Error())
			if strings.Contains(msg, "duplicate column name") {
				continue
			}
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	return nil
}
