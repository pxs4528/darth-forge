package db

import (
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"
)

// Dump writes a portable SQL dump of every user table: DROP + CREATE + one
// INSERT per row. Restoring is:  gunzip -c f.sql.gz | turso db shell <db>
// (or paste into any SQLite shell). Our schema is small enough that a
// hand-rolled dump beats depending on a client-side .dump implementation.
func Dump(conn *sql.DB, w io.Writer) error {
	fmt.Fprintf(w, "-- darth-forge budget dump %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintln(w, "PRAGMA foreign_keys=OFF;")
	fmt.Fprintln(w, "BEGIN TRANSACTION;")

	rows, err := conn.Query(
		`SELECT name, sql FROM sqlite_master
		 WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
		 ORDER BY name`,
	)
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	type table struct{ name, createSQL string }
	tables := []table{}
	for rows.Next() {
		var t table
		if err := rows.Scan(&t.name, &t.createSQL); err != nil {
			rows.Close()
			return err
		}
		tables = append(tables, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, t := range tables {
		fmt.Fprintf(w, "DROP TABLE IF EXISTS %s;\n", quoteIdent(t.name))
		fmt.Fprintf(w, "%s;\n", t.createSQL)
		if err := dumpRows(conn, w, t.name); err != nil {
			return fmt.Errorf("dump %s: %w", t.name, err)
		}
	}

	fmt.Fprintln(w, "COMMIT;")
	return nil
}

func dumpRows(conn *sql.DB, w io.Writer, table string) error {
	rows, err := conn.Query("SELECT * FROM " + quoteIdent(table))
	if err != nil {
		return err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteIdent(c)
	}
	colList := strings.Join(quoted, ", ")

	values := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}

	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		lits := make([]string, len(cols))
		for i, v := range values {
			lits[i] = sqlLiteral(v)
		}
		fmt.Fprintf(w, "INSERT INTO %s (%s) VALUES (%s);\n",
			quoteIdent(table), colList, strings.Join(lits, ", "))
	}
	return rows.Err()
}

// quoteIdent double-quotes an identifier, escaping embedded quotes.
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// sqlLiteral renders a driver value as a SQL literal.
func sqlLiteral(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case int64:
		return fmt.Sprintf("%d", x)
	case float64:
		return fmt.Sprintf("%g", x)
	case bool:
		if x {
			return "1"
		}
		return "0"
	case []byte:
		return quoteString(string(x))
	case string:
		return quoteString(x)
	case time.Time:
		return quoteString(x.UTC().Format("2006-01-02 15:04:05"))
	default:
		return quoteString(fmt.Sprintf("%v", x))
	}
}

func quoteString(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
