package database

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

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

	return db, nil
}
