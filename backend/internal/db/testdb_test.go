package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	// Pure-Go SQLite, test-only. The production binary talks to Turso over
	// HTTP and never links this in, so CGO_ENABLED=0 builds are unaffected.
	_ "modernc.org/sqlite"
)

// newTestDB gives each test a private on-disk database with the real schema
// applied, so migrations and SQL are exercised rather than mocked.
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()

	conn, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	if err := migrate(conn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return conn
}

// account creates an account and returns its id.
func account(t *testing.T, conn *sql.DB, name, accountType string) int64 {
	t.Helper()
	a, err := CreateAccount(conn, Account{Name: name, Type: accountType, InGoal: true})
	if err != nil {
		t.Fatalf("create account %s: %v", name, err)
	}
	return a.ID
}

// entry books a from → to movement and returns the created entry.
func entry(t *testing.T, conn *sql.DB, date, desc string, from, to int64, cents int64) *Entry {
	t.Helper()
	e, err := CreateEntry(conn, Entry{
		Date:        date,
		Month:       date[:7],
		Description: desc,
		Splits: []Split{
			{AccountID: from, AmountCents: -cents},
			{AccountID: to, AmountCents: cents},
		},
	})
	if err != nil {
		t.Fatalf("create entry %q: %v", desc, err)
	}
	return e
}

// splitIDFor finds the split an entry posted to a given account.
func splitIDFor(t *testing.T, conn *sql.DB, txnID, accountID int64) int64 {
	t.Helper()
	var id int64
	err := conn.QueryRow(
		`SELECT id FROM splits WHERE txn_id = ? AND account_id = ?`, txnID, accountID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("find split for txn %d account %d: %v", txnID, accountID, err)
	}
	return id
}

func countRows(t *testing.T, conn *sql.DB, table string) int64 {
	t.Helper()
	var n int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}
