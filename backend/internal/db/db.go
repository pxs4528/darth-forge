// Package db owns the Turso/libSQL connection and schema for the budget tool.
//
// Turso is SQLite-over-HTTP, so the driver is pure Go and the backend still
// builds with CGO_ENABLED=0. Everything below is plain database/sql.
package db

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

// Open dials Turso using TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, then applies
// the schema. Returns an error (rather than panicking) so the server can boot
// without a database and simply serve 503 on budget routes.
func Open() (*sql.DB, error) {
	url := strings.TrimSpace(os.Getenv("TURSO_DATABASE_URL"))
	if url == "" {
		return nil, fmt.Errorf("TURSO_DATABASE_URL is not set")
	}

	dsn := url
	if token := strings.TrimSpace(os.Getenv("TURSO_AUTH_TOKEN")); token != "" {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn = dsn + sep + "authToken=" + token
	}

	conn, err := sql.Open("libsql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open libsql: %w", err)
	}

	// Each query is an HTTP round trip; a small pool is plenty and keeps us
	// well inside Turso's free-tier connection limits.
	conn.SetMaxOpenConns(4)
	conn.SetMaxIdleConns(2)
	conn.SetConnMaxLifetime(30 * time.Minute)

	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping libsql: %w", err)
	}

	if err := migrate(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return conn, nil
}

// schema is applied on every boot. Every statement is idempotent, so this is
// safe to re-run; when you add a table or index, append it here.
var schema = []string{
	// One row per budgeting month. income_cents defaults to a 2-paycheck month.
	`CREATE TABLE IF NOT EXISTS months (
		month             TEXT PRIMARY KEY,
		income_cents      INTEGER NOT NULL DEFAULT 575200,
		three_paycheck    INTEGER NOT NULL DEFAULT 0,
		match_401k_cents  INTEGER NOT NULL DEFAULT 24500,
		created_at        TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	// Per-month budget target for each category. Seeded from the previous
	// month so edits carry forward instead of resetting every month.
	`CREATE TABLE IF NOT EXISTS budgets (
		month        TEXT NOT NULL,
		category     TEXT NOT NULL,
		amount_cents INTEGER NOT NULL,
		PRIMARY KEY (month, category)
	)`,

	`CREATE TABLE IF NOT EXISTS transactions (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		month        TEXT NOT NULL,
		date         TEXT NOT NULL,
		description  TEXT NOT NULL,
		amount_cents INTEGER NOT NULL,
		category     TEXT NOT NULL,
		created_at   TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	`CREATE INDEX IF NOT EXISTS idx_tx_month ON transactions (month, date DESC, id DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_description ON transactions (description)`,

	// Net-worth snapshot per month, powering the $100k tracker.
	`CREATE TABLE IF NOT EXISTS net_worth (
		month               TEXT PRIMARY KEY,
		hysa_cents          INTEGER NOT NULL DEFAULT 0,
		brokerage_cents     INTEGER NOT NULL DEFAULT 0,
		k401_vested_cents   INTEGER NOT NULL DEFAULT 0,
		k401_unvested_cents INTEGER NOT NULL DEFAULT 0,
		months_remaining    INTEGER NOT NULL DEFAULT 36,
		goal_cents          INTEGER NOT NULL DEFAULT 10000000,
		updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
}

func migrate(conn *sql.DB) error {
	for i, stmt := range schema {
		if _, err := conn.Exec(stmt); err != nil {
			return fmt.Errorf("statement %d: %w", i, err)
		}
	}
	return nil
}
