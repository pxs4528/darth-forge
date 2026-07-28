package db

import "testing"

func TestSQLLiteral(t *testing.T) {
	cases := []struct {
		in   interface{}
		want string
	}{
		{nil, "NULL"},
		{int64(42), "42"},
		{int64(-7), "-7"},
		{float64(3.5), "3.5"},
		{true, "1"},
		{false, "0"},
		{"plain", "'plain'"},
		{"it's", "'it''s'"},
		{"two''quotes", "'two''''quotes'"},
		{[]byte("bytes"), "'bytes'"},
		{"", "''"},
	}
	for _, c := range cases {
		if got := sqlLiteral(c.in); got != c.want {
			t.Errorf("sqlLiteral(%#v) = %s, want %s", c.in, got, c.want)
		}
	}
}

func TestQuoteIdent(t *testing.T) {
	if got := quoteIdent("transactions"); got != `"transactions"` {
		t.Errorf("got %s", got)
	}
	if got := quoteIdent(`we"ird`); got != `"we""ird"` {
		t.Errorf("got %s", got)
	}
}
