// Package db owns the Turso/libSQL connection and the double-entry schema.
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

// ── schema ───────────────────────────────────────────────────────────────────
//
// Double-entry, GnuCash-style. Every movement of money is a txn with two or
// more splits whose amounts sum to zero. There is no separate "category" or
// "transfer" concept: a category IS an income/expense account, and a transfer
// is simply a txn whose splits both land on asset/liability accounts.
//
// Sign convention (standard accounting, and the reason net worth just falls
// out of a SUM): a split's amount is positive when value flows INTO the
// account and negative when it flows OUT.
//
//	asset      balance > 0  → cash you hold
//	liability  balance < 0  → debt you owe (display as -balance)
//	income     balance < 0  → money earned  (display as -balance)
//	expense    balance > 0  → money spent
//	equity     balance < 0  → opening balances
//
// Net worth is therefore SUM(balance) over asset+liability accounts — debt is
// already negative, so it subtracts itself. Nothing is typed in by hand.
var schema = []string{
	// in_goal excludes an account from the goal tracker while keeping it in the
	// books — for depreciating assets like a car, its loan, or unvested 401k,
	// which are real but aren't the milestone being aimed at.
	`CREATE TABLE IF NOT EXISTS accounts (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		name         TEXT NOT NULL UNIQUE,
		type         TEXT NOT NULL,
		subtype      TEXT NOT NULL DEFAULT '',
		budget_group TEXT NOT NULL DEFAULT '',
		sort         INTEGER NOT NULL DEFAULT 0,
		archived     INTEGER NOT NULL DEFAULT 0,
		in_goal      INTEGER NOT NULL DEFAULT 1
	)`,

	`CREATE TABLE IF NOT EXISTS txns (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		date        TEXT NOT NULL,
		month       TEXT NOT NULL,
		description TEXT NOT NULL,
		created_at  TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	`CREATE INDEX IF NOT EXISTS idx_txns_month ON txns (month, date DESC, id DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_txns_description ON txns (description)`,

	`CREATE TABLE IF NOT EXISTS splits (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		txn_id       INTEGER NOT NULL,
		account_id   INTEGER NOT NULL,
		amount_cents INTEGER NOT NULL
	)`,

	`CREATE INDEX IF NOT EXISTS idx_splits_txn ON splits (txn_id)`,
	`CREATE INDEX IF NOT EXISTS idx_splits_account ON splits (account_id)`,

	// Monthly spending target per expense account.
	`CREATE TABLE IF NOT EXISTS budgets (
		month        TEXT NOT NULL,
		account_id   INTEGER NOT NULL,
		amount_cents INTEGER NOT NULL,
		PRIMARY KEY (month, account_id)
	)`,

	// Single-row goal config. months remaining is derived from target_month
	// rather than being a number you decrement by hand every month.
	`CREATE TABLE IF NOT EXISTS goal (
		id               INTEGER PRIMARY KEY CHECK (id = 1),
		goal_cents       INTEGER NOT NULL DEFAULT 10000000,
		target_month     TEXT NOT NULL DEFAULT '2029-07',
		emergency_months INTEGER NOT NULL DEFAULT 6
	)`,
}

// legacyTables are the pre-double-entry tables. They're renamed rather than
// dropped so nothing is destroyed by the upgrade — recover with
// `SELECT * FROM transactions_v1` if anything looks wrong after the switch.
var legacyTables = []string{"transactions", "transfers", "months", "net_worth"}

func migrate(conn *sql.DB) error {
	// The old `accounts` and `budgets` tables share names with new ones but
	// have incompatible columns, so they're retired first.
	for _, t := range append([]string{"accounts", "budgets"}, legacyTables...) {
		if err := retireLegacy(conn, t); err != nil {
			return err
		}
	}

	for i, stmt := range schema {
		if _, err := conn.Exec(stmt); err != nil {
			return fmt.Errorf("statement %d: %w", i, err)
		}
	}

	// Column additions to tables that already exist from an earlier version.
	if err := ensureColumn(conn, "accounts", "in_goal", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}
	if err := ensureColumn(conn, "goal", "emergency_months", "INTEGER NOT NULL DEFAULT 6"); err != nil {
		return err
	}
	if err := normalizeSubtypes(conn); err != nil {
		return err
	}

	if _, err := conn.Exec(
		`INSERT INTO goal (id, goal_cents, target_month) VALUES (1, ?, ?)
		 ON CONFLICT (id) DO NOTHING`,
		DefaultGoalCents, DefaultTargetMonth,
	); err != nil {
		return fmt.Errorf("seed goal: %w", err)
	}

	return seedAccounts(conn)
}

// retireLegacy renames a pre-double-entry table to <name>_v1, once. If the _v1
// name is already taken the table has already been retired on a previous boot,
// so the current table (if any) is left alone.
func retireLegacy(conn *sql.DB, name string) error {
	exists, err := tableExists(conn, name)
	if err != nil || !exists {
		return err
	}

	// A v2 table is identified by a column only the new schema has.
	if name == "accounts" {
		isNew, err := hasColumn(conn, "accounts", "type")
		if err != nil {
			return err
		}
		if isNew {
			return nil
		}
	}
	if name == "budgets" {
		isNew, err := hasColumn(conn, "budgets", "account_id")
		if err != nil {
			return err
		}
		if isNew {
			return nil
		}
	}

	archived, err := tableExists(conn, name+"_v1")
	if err != nil {
		return err
	}
	if archived {
		// Already have an archive from a previous upgrade; drop the stale copy.
		_, err := conn.Exec("DROP TABLE " + quoteIdent(name))
		return err
	}

	_, err = conn.Exec("ALTER TABLE " + quoteIdent(name) + " RENAME TO " + quoteIdent(name+"_v1"))
	if err != nil {
		return fmt.Errorf("retire %s: %w", name, err)
	}
	return nil
}

func tableExists(conn *sql.DB, name string) (bool, error) {
	var n int64
	err := conn.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name,
	).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("check table %s: %w", name, err)
	}
	return n > 0, nil
}

// ensureColumn adds a column if the table doesn't already have it, so upgrades
// are idempotent across reboots.
func ensureColumn(conn *sql.DB, table, column, decl string) error {
	present, err := hasColumn(conn, table, column)
	if err != nil || present {
		return err
	}
	if _, err := conn.Exec(
		"ALTER TABLE " + quoteIdent(table) + " ADD COLUMN " + column + " " + decl,
	); err != nil {
		return fmt.Errorf("add %s.%s: %w", table, column, err)
	}
	return nil
}

func hasColumn(conn *sql.DB, table, column string) (bool, error) {
	rows, err := conn.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false, fmt.Errorf("table_info %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
