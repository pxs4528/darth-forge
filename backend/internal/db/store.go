package db

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Seed values for the very first month, before there is any history to copy.
const (
	DefaultIncomeCents       int64 = 575200   // 2 paychecks @ $2,875.92
	DefaultThreePayCents     int64 = 862776   // 3 paychecks @ $2,875.92
	DefaultMatch401kCents    int64 = 24500    // ~$245/mo employer match
	DefaultGoalCents         int64 = 10000000 // $100,000
	DefaultMonthsRemaining   int64 = 36
	DefaultHYSACents         int64 = 2000000
	DefaultBrokerageCents    int64 = 2000000
	DefaultK401VestedCents   int64 = 600000
	DefaultK401UnvestedCents int64 = 400000
)

type Transaction struct {
	ID          int64  `json:"id"`
	Month       string `json:"month"`
	Date        string `json:"date"`
	Description string `json:"description"`
	AmountCents int64  `json:"amount_cents"`
	Category    string `json:"category"`
}

type NetWorth struct {
	Month             string `json:"month"`
	HYSACents         int64  `json:"hysa_cents"`
	BrokerageCents    int64  `json:"brokerage_cents"`
	K401VestedCents   int64  `json:"k401_vested_cents"`
	K401UnvestedCents int64  `json:"k401_unvested_cents"`
	MonthsRemaining   int64  `json:"months_remaining"`
	GoalCents         int64  `json:"goal_cents"`
}

// Total is every bucket including unvested 401k.
func (n NetWorth) Total() int64 {
	return n.HYSACents + n.BrokerageCents + n.K401VestedCents + n.K401UnvestedCents
}

type MonthState struct {
	Month          string           `json:"month"`
	IncomeCents    int64            `json:"income_cents"`
	ThreePaycheck  bool             `json:"three_paycheck"`
	Match401kCents int64            `json:"match_401k_cents"`
	Budgets        map[string]int64 `json:"budgets"`
	Transactions   []Transaction    `json:"transactions"`
	NetWorth       NetWorth         `json:"net_worth"`
}

// HistoryPoint is one month rolled up, for the trend charts.
type HistoryPoint struct {
	Month         string `json:"month"`
	IncomeCents   int64  `json:"income_cents"`
	SpentCents    int64  `json:"spent_cents"`
	SavedCents    int64  `json:"saved_cents"`
	NetWorthCents int64  `json:"net_worth_cents"`
}

// Suggestion is a past description and the category it usually maps to,
// so typing "HEB" can auto-pick Groceries.
type Suggestion struct {
	Description string `json:"description"`
	Category    string `json:"category"`
	Count       int64  `json:"count"`
}

// ── month helpers ────────────────────────────────────────────────────────────

// ValidMonth checks the "YYYY-MM" shape.
func ValidMonth(m string) bool {
	_, err := time.Parse("2006-01", m)
	return err == nil
}

// monthOrdinal converts "YYYY-MM" to an absolute month count, so two months
// can be compared or subtracted without date math.
func monthOrdinal(m string) (int64, error) {
	parts := strings.SplitN(m, "-", 2)
	if len(parts) != 2 {
		return 0, fmt.Errorf("bad month %q", m)
	}
	y, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, err
	}
	mo, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, err
	}
	return y*12 + (mo - 1), nil
}

// ── reads ────────────────────────────────────────────────────────────────────

// GetMonth returns the full state for a month, creating and seeding it on
// first access so the UI never has to special-case an empty month.
func GetMonth(conn *sql.DB, month string) (*MonthState, error) {
	if err := ensureMonth(conn, month); err != nil {
		return nil, err
	}

	state := &MonthState{Month: month, Budgets: map[string]int64{}, Transactions: []Transaction{}}

	var threePaycheck int64
	err := conn.QueryRow(
		`SELECT income_cents, three_paycheck, match_401k_cents FROM months WHERE month = ?`,
		month,
	).Scan(&state.IncomeCents, &threePaycheck, &state.Match401kCents)
	if err != nil {
		return nil, fmt.Errorf("load month: %w", err)
	}
	state.ThreePaycheck = threePaycheck == 1

	budgetRows, err := conn.Query(`SELECT category, amount_cents FROM budgets WHERE month = ?`, month)
	if err != nil {
		return nil, fmt.Errorf("load budgets: %w", err)
	}
	defer budgetRows.Close()
	for budgetRows.Next() {
		var cat string
		var cents int64
		if err := budgetRows.Scan(&cat, &cents); err != nil {
			return nil, err
		}
		state.Budgets[cat] = cents
	}
	if err := budgetRows.Err(); err != nil {
		return nil, err
	}

	txRows, err := conn.Query(
		`SELECT id, month, date, description, amount_cents, category
		 FROM transactions WHERE month = ? ORDER BY date DESC, id DESC`,
		month,
	)
	if err != nil {
		return nil, fmt.Errorf("load transactions: %w", err)
	}
	defer txRows.Close()
	for txRows.Next() {
		var t Transaction
		if err := txRows.Scan(&t.ID, &t.Month, &t.Date, &t.Description, &t.AmountCents, &t.Category); err != nil {
			return nil, err
		}
		state.Transactions = append(state.Transactions, t)
	}
	if err := txRows.Err(); err != nil {
		return nil, err
	}

	nw, err := getNetWorth(conn, month)
	if err != nil {
		return nil, err
	}
	state.NetWorth = nw

	return state, nil
}

func getNetWorth(conn *sql.DB, month string) (NetWorth, error) {
	nw := NetWorth{Month: month}
	err := conn.QueryRow(
		`SELECT hysa_cents, brokerage_cents, k401_vested_cents, k401_unvested_cents,
		        months_remaining, goal_cents
		 FROM net_worth WHERE month = ?`,
		month,
	).Scan(&nw.HYSACents, &nw.BrokerageCents, &nw.K401VestedCents, &nw.K401UnvestedCents,
		&nw.MonthsRemaining, &nw.GoalCents)
	if err != nil {
		return nw, fmt.Errorf("load net worth: %w", err)
	}
	return nw, nil
}

// History rolls up the last `limit` months for the trend charts.
func History(conn *sql.DB, limit int) ([]HistoryPoint, error) {
	if limit <= 0 || limit > 120 {
		limit = 24
	}

	savingsPlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(SavingsCategories)), ",")
	args := make([]interface{}, 0, len(SavingsCategories)+1)
	for _, c := range SavingsCategories {
		args = append(args, c)
	}
	args = append(args, limit)

	// One query: months joined to their transaction rollup and net-worth snapshot.
	query := `
		SELECT m.month,
		       m.income_cents,
		       COALESCE(t.spent, 0),
		       COALESCE(t.saved, 0),
		       COALESCE(n.hysa_cents + n.brokerage_cents + n.k401_vested_cents + n.k401_unvested_cents, 0)
		FROM months m
		LEFT JOIN (
			SELECT month,
			       SUM(amount_cents) AS spent,
			       SUM(CASE WHEN category IN (` + savingsPlaceholders + `) THEN amount_cents ELSE 0 END) AS saved
			FROM transactions GROUP BY month
		) t ON t.month = m.month
		LEFT JOIN net_worth n ON n.month = m.month
		ORDER BY m.month DESC
		LIMIT ?`

	rows, err := conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	defer rows.Close()

	points := []HistoryPoint{}
	for rows.Next() {
		var p HistoryPoint
		if err := rows.Scan(&p.Month, &p.IncomeCents, &p.SpentCents, &p.SavedCents, &p.NetWorthCents); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Chronological order reads better on a chart.
	for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
		points[i], points[j] = points[j], points[i]
	}
	return points, nil
}

// Suggest returns past descriptions matching q, most-used first, along with
// the category each was most often filed under.
func Suggest(conn *sql.DB, q string) ([]Suggestion, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []Suggestion{}, nil
	}

	// Group by description+category, take the most frequent pairing per
	// description. Escape LIKE wildcards so a literal % doesn't match everything.
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)

	rows, err := conn.Query(`
		SELECT description, category, uses FROM (
			SELECT description,
			       category,
			       COUNT(*) AS uses,
			       ROW_NUMBER() OVER (
			           PARTITION BY lower(description) ORDER BY COUNT(*) DESC
			       ) AS rnk
			FROM transactions
			WHERE lower(description) LIKE lower(?) ESCAPE '\'
			GROUP BY lower(description), category
		)
		WHERE rnk = 1
		ORDER BY uses DESC
		LIMIT 6`, esc+"%")
	if err != nil {
		return nil, fmt.Errorf("suggest: %w", err)
	}
	defer rows.Close()

	out := []Suggestion{}
	for rows.Next() {
		var s Suggestion
		if err := rows.Scan(&s.Description, &s.Category, &s.Count); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── writes ───────────────────────────────────────────────────────────────────

// UpdateMonth sets income and the 401k match figure for a month.
func UpdateMonth(conn *sql.DB, month string, incomeCents int64, threePaycheck bool, match401kCents int64) error {
	if err := ensureMonth(conn, month); err != nil {
		return err
	}
	three := 0
	if threePaycheck {
		three = 1
	}
	_, err := conn.Exec(
		`UPDATE months SET income_cents = ?, three_paycheck = ?, match_401k_cents = ? WHERE month = ?`,
		incomeCents, three, match401kCents, month,
	)
	return err
}

// SetBudgets upserts category targets for a month.
func SetBudgets(conn *sql.DB, month string, budgets map[string]int64) error {
	if err := ensureMonth(conn, month); err != nil {
		return err
	}
	for cat, cents := range budgets {
		if !ValidCategory(cat) {
			return fmt.Errorf("unknown category %q", cat)
		}
		if _, err := conn.Exec(`
			INSERT INTO budgets (month, category, amount_cents) VALUES (?, ?, ?)
			ON CONFLICT (month, category) DO UPDATE SET amount_cents = excluded.amount_cents`,
			month, cat, cents,
		); err != nil {
			return err
		}
	}
	return nil
}

// SetNetWorth upserts the net-worth snapshot for a month.
func SetNetWorth(conn *sql.DB, nw NetWorth) error {
	if err := ensureMonth(conn, nw.Month); err != nil {
		return err
	}
	_, err := conn.Exec(`
		INSERT INTO net_worth (month, hysa_cents, brokerage_cents, k401_vested_cents,
		                       k401_unvested_cents, months_remaining, goal_cents, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT (month) DO UPDATE SET
			hysa_cents          = excluded.hysa_cents,
			brokerage_cents     = excluded.brokerage_cents,
			k401_vested_cents   = excluded.k401_vested_cents,
			k401_unvested_cents = excluded.k401_unvested_cents,
			months_remaining    = excluded.months_remaining,
			goal_cents          = excluded.goal_cents,
			updated_at          = datetime('now')`,
		nw.Month, nw.HYSACents, nw.BrokerageCents, nw.K401VestedCents,
		nw.K401UnvestedCents, nw.MonthsRemaining, nw.GoalCents,
	)
	return err
}

// CreateTransaction inserts a transaction and returns it with its new id.
func CreateTransaction(conn *sql.DB, t Transaction) (*Transaction, error) {
	if err := ensureMonth(conn, t.Month); err != nil {
		return nil, err
	}
	res, err := conn.Exec(
		`INSERT INTO transactions (month, date, description, amount_cents, category)
		 VALUES (?, ?, ?, ?, ?)`,
		t.Month, t.Date, t.Description, t.AmountCents, t.Category,
	)
	if err != nil {
		return nil, fmt.Errorf("insert transaction: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	t.ID = id
	return &t, nil
}

// UpdateTransaction rewrites a transaction in place. Changing the date can move
// it to a different month, so month is recomputed from the date by the caller.
func UpdateTransaction(conn *sql.DB, t Transaction) error {
	if err := ensureMonth(conn, t.Month); err != nil {
		return err
	}
	res, err := conn.Exec(
		`UPDATE transactions SET month = ?, date = ?, description = ?, amount_cents = ?, category = ?
		 WHERE id = ?`,
		t.Month, t.Date, t.Description, t.AmountCents, t.Category, t.ID,
	)
	if err != nil {
		return fmt.Errorf("update transaction: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("transaction %d not found", t.ID)
	}
	return nil
}

func DeleteTransaction(conn *sql.DB, id int64) error {
	res, err := conn.Exec(`DELETE FROM transactions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("transaction %d not found", id)
	}
	return nil
}

// ── seeding ──────────────────────────────────────────────────────────────────

// ensureMonth makes a month usable: it creates the months row, seeds budgets
// (copied from the most recent earlier month, else from the catalog defaults),
// and seeds a net-worth snapshot (carried forward, with months_remaining
// counted down by however many months have elapsed).
func ensureMonth(conn *sql.DB, month string) error {
	if !ValidMonth(month) {
		return fmt.Errorf("invalid month %q, want YYYY-MM", month)
	}

	if _, err := conn.Exec(
		`INSERT INTO months (month, income_cents, three_paycheck, match_401k_cents)
		 VALUES (?, ?, 0, ?) ON CONFLICT (month) DO NOTHING`,
		month, DefaultIncomeCents, DefaultMatch401kCents,
	); err != nil {
		return fmt.Errorf("ensure months row: %w", err)
	}

	if err := seedBudgets(conn, month); err != nil {
		return err
	}
	return seedNetWorth(conn, month)
}

func seedBudgets(conn *sql.DB, month string) error {
	var count int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM budgets WHERE month = ?`, month).Scan(&count); err != nil {
		return fmt.Errorf("count budgets: %w", err)
	}
	if count > 0 {
		return nil
	}

	// Copy the most recent earlier month's targets if there is one.
	var prev sql.NullString
	if err := conn.QueryRow(
		`SELECT month FROM budgets WHERE month < ? ORDER BY month DESC LIMIT 1`, month,
	).Scan(&prev); err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("find previous budgets: %w", err)
	}

	if prev.Valid && prev.String != "" {
		_, err := conn.Exec(
			`INSERT INTO budgets (month, category, amount_cents)
			 SELECT ?, category, amount_cents FROM budgets WHERE month = ?`,
			month, prev.String,
		)
		if err != nil {
			return fmt.Errorf("copy budgets: %w", err)
		}
		return nil
	}

	for _, c := range Categories {
		if _, err := conn.Exec(
			`INSERT INTO budgets (month, category, amount_cents) VALUES (?, ?, ?)
			 ON CONFLICT (month, category) DO NOTHING`,
			month, c.Key, c.DefaultCents,
		); err != nil {
			return fmt.Errorf("seed budget %s: %w", c.Key, err)
		}
	}
	return nil
}

func seedNetWorth(conn *sql.DB, month string) error {
	var count int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM net_worth WHERE month = ?`, month).Scan(&count); err != nil {
		return fmt.Errorf("count net worth: %w", err)
	}
	if count > 0 {
		return nil
	}

	var prevMonth sql.NullString
	prev := NetWorth{}
	err := conn.QueryRow(`
		SELECT month, hysa_cents, brokerage_cents, k401_vested_cents,
		       k401_unvested_cents, months_remaining, goal_cents
		FROM net_worth WHERE month < ? ORDER BY month DESC LIMIT 1`, month,
	).Scan(&prevMonth, &prev.HYSACents, &prev.BrokerageCents, &prev.K401VestedCents,
		&prev.K401UnvestedCents, &prev.MonthsRemaining, &prev.GoalCents)

	if err == sql.ErrNoRows {
		_, err := conn.Exec(`
			INSERT INTO net_worth (month, hysa_cents, brokerage_cents, k401_vested_cents,
			                       k401_unvested_cents, months_remaining, goal_cents)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			month, DefaultHYSACents, DefaultBrokerageCents, DefaultK401VestedCents,
			DefaultK401UnvestedCents, DefaultMonthsRemaining, DefaultGoalCents,
		)
		return err
	}
	if err != nil {
		return fmt.Errorf("find previous net worth: %w", err)
	}

	// Carry balances forward and count the deadline down by elapsed months.
	remaining := prev.MonthsRemaining
	if prevMonth.Valid {
		from, err1 := monthOrdinal(prevMonth.String)
		to, err2 := monthOrdinal(month)
		if err1 == nil && err2 == nil {
			remaining = prev.MonthsRemaining - (to - from)
		}
	}
	if remaining < 1 {
		remaining = 1
	}

	_, err = conn.Exec(`
		INSERT INTO net_worth (month, hysa_cents, brokerage_cents, k401_vested_cents,
		                       k401_unvested_cents, months_remaining, goal_cents)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		month, prev.HYSACents, prev.BrokerageCents, prev.K401VestedCents,
		prev.K401UnvestedCents, remaining, prev.GoalCents,
	)
	return err
}
