package db

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ── types ────────────────────────────────────────────────────────────────────

type Account struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Subtype     string `json:"subtype"`
	BudgetGroup string `json:"budget_group"`
	Sort        int64  `json:"sort"`
	Archived    bool   `json:"archived"`
}

// AccountBalance is an account plus its balance through the viewed month and
// the net change within that month. Signs follow the schema's convention:
// liabilities and income are negative, so the UI negates them for display.
type AccountBalance struct {
	Account
	BalanceCents int64 `json:"balance_cents"`
	ChangeCents  int64 `json:"change_cents"`
}

type Split struct {
	ID          int64 `json:"id"`
	AccountID   int64 `json:"account_id"`
	AmountCents int64 `json:"amount_cents"`
}

// Entry is one transaction: a date, a description, and the splits that move
// the money. Splits always sum to zero.
type Entry struct {
	ID          int64   `json:"id"`
	Date        string  `json:"date"`
	Month       string  `json:"month"`
	Description string  `json:"description"`
	Splits      []Split `json:"splits"`
}

type Goal struct {
	GoalCents   int64  `json:"goal_cents"`
	TargetMonth string `json:"target_month"`
}

// Summary is the month's headline arithmetic, all derived from splits.
type Summary struct {
	IncomeCents     int64 `json:"income_cents"`
	ExpenseCents    int64 `json:"expense_cents"`
	SurplusCents    int64 `json:"surplus_cents"`
	NetWorthCents   int64 `json:"net_worth_cents"`
	NetWorthChange  int64 `json:"net_worth_change_cents"`
	MonthsRemaining int64 `json:"months_remaining"`
	// TargetMonthlyCents is what you must add to net worth each remaining
	// month to land on the goal.
	TargetMonthlyCents int64 `json:"target_monthly_cents"`
}

type MonthState struct {
	Month    string           `json:"month"`
	Accounts []AccountBalance `json:"accounts"`
	Entries  []Entry          `json:"entries"`
	Budgets  map[string]int64 `json:"budgets"` // account id (as string) → target
	Goal     Goal             `json:"goal"`
	Summary  Summary          `json:"summary"`
}

type HistoryPoint struct {
	Month         string `json:"month"`
	IncomeCents   int64  `json:"income_cents"`
	ExpenseCents  int64  `json:"expense_cents"`
	NetWorthCents int64  `json:"net_worth_cents"`
}

// Suggestion is a past description and the accounts it usually posted to, so
// typing "HEB" can prefill Groceries paid from Discover.
type Suggestion struct {
	Description   string `json:"description"`
	FromAccountID int64  `json:"from_account_id"`
	ToAccountID   int64  `json:"to_account_id"`
	AmountCents   int64  `json:"amount_cents"`
	Uses          int64  `json:"uses"`
}

// ── month helpers ────────────────────────────────────────────────────────────

func ValidMonth(m string) bool {
	_, err := time.Parse("2006-01", m)
	return err == nil
}

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

// MonthsBetween counts whole months from `from` to `to`, floored at 0.
func MonthsBetween(from, to string) int64 {
	a, err1 := monthOrdinal(from)
	b, err2 := monthOrdinal(to)
	if err1 != nil || err2 != nil || b < a {
		return 0
	}
	return b - a
}

// ── accounts ─────────────────────────────────────────────────────────────────

func ListAccounts(conn *sql.DB) ([]Account, error) {
	rows, err := conn.Query(
		`SELECT id, name, type, subtype, budget_group, sort, archived
		 FROM accounts ORDER BY archived, sort, id`,
	)
	if err != nil {
		return nil, fmt.Errorf("load accounts: %w", err)
	}
	defer rows.Close()

	out := []Account{}
	for rows.Next() {
		var a Account
		var archived int64
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Subtype, &a.BudgetGroup, &a.Sort, &archived); err != nil {
			return nil, err
		}
		a.Archived = archived == 1
		out = append(out, a)
	}
	return out, rows.Err()
}

func AccountExists(conn *sql.DB, id int64) (bool, error) {
	var n int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM accounts WHERE id = ?`, id).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

func CreateAccount(conn *sql.DB, a Account) (*Account, error) {
	res, err := conn.Exec(
		`INSERT INTO accounts (name, type, subtype, budget_group, sort)
		 VALUES (?, ?, ?, ?, ?)`,
		a.Name, a.Type, a.Subtype, a.BudgetGroup, a.Sort,
	)
	if err != nil {
		return nil, fmt.Errorf("insert account: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	a.ID = id
	return &a, nil
}

// UpdateAccount renames/reclassifies/archives. Accounts are never deleted so
// historical splits keep their references.
func UpdateAccount(conn *sql.DB, a Account) error {
	archived := 0
	if a.Archived {
		archived = 1
	}
	res, err := conn.Exec(
		`UPDATE accounts SET name = ?, type = ?, subtype = ?, budget_group = ?, sort = ?, archived = ?
		 WHERE id = ?`,
		a.Name, a.Type, a.Subtype, a.BudgetGroup, a.Sort, archived, a.ID,
	)
	if err != nil {
		return fmt.Errorf("update account: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("account %d not found", a.ID)
	}
	return nil
}

// AccountBalances returns every account with its cumulative balance through
// the end of uptoMonth, plus the net change during that month alone.
func AccountBalances(conn *sql.DB, uptoMonth string) ([]AccountBalance, error) {
	accounts, err := ListAccounts(conn)
	if err != nil {
		return nil, err
	}

	cumulative, err := sumSplitsByAccount(conn,
		`SELECT s.account_id, SUM(s.amount_cents)
		 FROM splits s JOIN txns t ON t.id = s.txn_id
		 WHERE t.month <= ? GROUP BY s.account_id`, uptoMonth)
	if err != nil {
		return nil, err
	}
	inMonth, err := sumSplitsByAccount(conn,
		`SELECT s.account_id, SUM(s.amount_cents)
		 FROM splits s JOIN txns t ON t.id = s.txn_id
		 WHERE t.month = ? GROUP BY s.account_id`, uptoMonth)
	if err != nil {
		return nil, err
	}

	out := make([]AccountBalance, len(accounts))
	for i, a := range accounts {
		out[i] = AccountBalance{
			Account:      a,
			BalanceCents: cumulative[a.ID],
			ChangeCents:  inMonth[a.ID],
		}
	}
	return out, nil
}

func sumSplitsByAccount(conn *sql.DB, query, month string) (map[int64]int64, error) {
	rows, err := conn.Query(query, month)
	if err != nil {
		return nil, fmt.Errorf("sum splits: %w", err)
	}
	defer rows.Close()

	sums := map[int64]int64{}
	for rows.Next() {
		var id, sum int64
		if err := rows.Scan(&id, &sum); err != nil {
			return nil, err
		}
		sums[id] = sum
	}
	return sums, rows.Err()
}

// ── month state ──────────────────────────────────────────────────────────────

func GetMonth(conn *sql.DB, month string) (*MonthState, error) {
	if !ValidMonth(month) {
		return nil, fmt.Errorf("invalid month %q, want YYYY-MM", month)
	}
	if err := ensureBudgets(conn, month); err != nil {
		return nil, err
	}

	state := &MonthState{Month: month, Budgets: map[string]int64{}, Entries: []Entry{}}

	accounts, err := AccountBalances(conn, month)
	if err != nil {
		return nil, err
	}
	state.Accounts = accounts

	entries, err := listEntries(conn, month)
	if err != nil {
		return nil, err
	}
	state.Entries = entries

	budgetRows, err := conn.Query(
		`SELECT account_id, amount_cents FROM budgets WHERE month = ?`, month)
	if err != nil {
		return nil, fmt.Errorf("load budgets: %w", err)
	}
	defer budgetRows.Close()
	for budgetRows.Next() {
		var id, cents int64
		if err := budgetRows.Scan(&id, &cents); err != nil {
			return nil, err
		}
		state.Budgets[strconv.FormatInt(id, 10)] = cents
	}
	if err := budgetRows.Err(); err != nil {
		return nil, err
	}

	goal, err := GetGoal(conn)
	if err != nil {
		return nil, err
	}
	state.Goal = goal

	earned, err := netWorthEarned(conn, month)
	if err != nil {
		return nil, err
	}
	state.Summary = summarize(accounts, goal, month, earned)

	return state, nil
}

// netWorthEarned is how much net worth actually grew through earning and
// spending in a month, ignoring entries that merely establish the books.
//
// Recording an opening balance moves value from an equity account into an
// asset, which raises net worth — correctly, since the money is real — but it
// isn't money you *added* that month, it's the starting position. Counting it
// would make the first month of any account look like a windfall and wreck
// the pace calculation. So entries touching equity are excluded here (they
// still count toward the net worth total, just not the change).
func netWorthEarned(conn *sql.DB, month string) (int64, error) {
	var earned int64
	err := conn.QueryRow(`
		SELECT COALESCE(SUM(s.amount_cents), 0)
		FROM splits s
		JOIN txns t     ON t.id = s.txn_id
		JOIN accounts a ON a.id = s.account_id
		WHERE t.month = ?
		  AND a.type IN ('asset','liability')
		  AND t.id NOT IN (
		      SELECT s2.txn_id FROM splits s2
		      JOIN accounts a2 ON a2.id = s2.account_id
		      WHERE a2.type = 'equity'
		  )`, month).Scan(&earned)
	if err != nil {
		return 0, fmt.Errorf("net worth earned: %w", err)
	}
	return earned, nil
}

// summarize derives the month's headline numbers purely from account balances,
// which is the whole point of double-entry: nothing here is entered by hand.
// earnedCents comes from netWorthEarned — the change with equity entries
// (opening balances) filtered out.
func summarize(accounts []AccountBalance, goal Goal, month string, earnedCents int64) Summary {
	var s Summary
	for _, a := range accounts {
		switch a.Type {
		case TypeIncome:
			s.IncomeCents += -a.ChangeCents // income accounts carry credits
		case TypeExpense:
			s.ExpenseCents += a.ChangeCents
		case TypeAsset, TypeLiability:
			// The total includes everything — an opening balance is real money.
			s.NetWorthCents += a.BalanceCents
		}
	}
	s.NetWorthChange = earnedCents
	s.SurplusCents = s.IncomeCents - s.ExpenseCents

	s.MonthsRemaining = MonthsBetween(month, goal.TargetMonth)
	if remaining := goal.GoalCents - s.NetWorthCents; remaining > 0 && s.MonthsRemaining > 0 {
		s.TargetMonthlyCents = remaining / s.MonthsRemaining
	}
	return s
}

func listEntries(conn *sql.DB, month string) ([]Entry, error) {
	rows, err := conn.Query(
		`SELECT id, date, month, description FROM txns
		 WHERE month = ? ORDER BY date DESC, id DESC`, month)
	if err != nil {
		return nil, fmt.Errorf("load entries: %w", err)
	}
	defer rows.Close()

	entries := []Entry{}
	byID := map[int64]int{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Date, &e.Month, &e.Description); err != nil {
			return nil, err
		}
		e.Splits = []Split{}
		byID[e.ID] = len(entries)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return entries, nil
	}

	splitRows, err := conn.Query(
		`SELECT s.id, s.txn_id, s.account_id, s.amount_cents
		 FROM splits s JOIN txns t ON t.id = s.txn_id
		 WHERE t.month = ? ORDER BY s.id`, month)
	if err != nil {
		return nil, fmt.Errorf("load splits: %w", err)
	}
	defer splitRows.Close()
	for splitRows.Next() {
		var txnID int64
		var sp Split
		if err := splitRows.Scan(&sp.ID, &txnID, &sp.AccountID, &sp.AmountCents); err != nil {
			return nil, err
		}
		if idx, ok := byID[txnID]; ok {
			entries[idx].Splits = append(entries[idx].Splits, sp)
		}
	}
	return entries, splitRows.Err()
}

// ensureBudgets seeds a month's targets, copying the most recent earlier month
// so edits carry forward, falling back to the built-in defaults.
func ensureBudgets(conn *sql.DB, month string) error {
	var count int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM budgets WHERE month = ?`, month).Scan(&count); err != nil {
		return fmt.Errorf("count budgets: %w", err)
	}
	if count > 0 {
		return nil
	}

	var prev sql.NullString
	err := conn.QueryRow(
		`SELECT month FROM budgets WHERE month < ? ORDER BY month DESC LIMIT 1`, month,
	).Scan(&prev)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("find previous budgets: %w", err)
	}

	if prev.Valid && prev.String != "" {
		_, err := conn.Exec(
			`INSERT INTO budgets (month, account_id, amount_cents)
			 SELECT ?, account_id, amount_cents FROM budgets WHERE month = ?`,
			month, prev.String)
		if err != nil {
			return fmt.Errorf("copy budgets: %w", err)
		}
		return nil
	}
	return SeedBudgetsForMonth(conn, month)
}

func SetBudget(conn *sql.DB, month string, accountID, cents int64) error {
	_, err := conn.Exec(`
		INSERT INTO budgets (month, account_id, amount_cents) VALUES (?, ?, ?)
		ON CONFLICT (month, account_id) DO UPDATE SET amount_cents = excluded.amount_cents`,
		month, accountID, cents)
	return err
}

// ── goal ─────────────────────────────────────────────────────────────────────

func GetGoal(conn *sql.DB) (Goal, error) {
	var g Goal
	err := conn.QueryRow(`SELECT goal_cents, target_month FROM goal WHERE id = 1`).
		Scan(&g.GoalCents, &g.TargetMonth)
	if err == sql.ErrNoRows {
		return Goal{GoalCents: DefaultGoalCents, TargetMonth: DefaultTargetMonth}, nil
	}
	if err != nil {
		return g, fmt.Errorf("load goal: %w", err)
	}
	return g, nil
}

func SetGoal(conn *sql.DB, g Goal) error {
	_, err := conn.Exec(`
		INSERT INTO goal (id, goal_cents, target_month) VALUES (1, ?, ?)
		ON CONFLICT (id) DO UPDATE SET goal_cents = excluded.goal_cents,
		                               target_month = excluded.target_month`,
		g.GoalCents, g.TargetMonth)
	return err
}

// ── entries ──────────────────────────────────────────────────────────────────

// ValidateSplits enforces the one invariant that makes the books trustworthy:
// every entry must balance to zero across at least two accounts.
func ValidateSplits(splits []Split) error {
	if len(splits) < 2 {
		return fmt.Errorf("an entry needs at least two splits")
	}
	var sum int64
	for _, s := range splits {
		if s.AccountID <= 0 {
			return fmt.Errorf("each split needs an account")
		}
		sum += s.AmountCents
	}
	if sum != 0 {
		return fmt.Errorf("splits must balance to zero (off by %d cents)", sum)
	}
	return nil
}

func CreateEntry(conn *sql.DB, e Entry) (*Entry, error) {
	if err := ValidateSplits(e.Splits); err != nil {
		return nil, err
	}

	tx, err := conn.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO txns (date, month, description) VALUES (?, ?, ?)`,
		e.Date, e.Month, e.Description)
	if err != nil {
		return nil, fmt.Errorf("insert txn: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	for i := range e.Splits {
		if _, err := tx.Exec(
			`INSERT INTO splits (txn_id, account_id, amount_cents) VALUES (?, ?, ?)`,
			id, e.Splits[i].AccountID, e.Splits[i].AmountCents,
		); err != nil {
			return nil, fmt.Errorf("insert split: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	e.ID = id
	return &e, nil
}

// UpdateEntry replaces an entry and all of its splits.
func UpdateEntry(conn *sql.DB, e Entry) error {
	if err := ValidateSplits(e.Splits); err != nil {
		return err
	}

	tx, err := conn.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`UPDATE txns SET date = ?, month = ?, description = ? WHERE id = ?`,
		e.Date, e.Month, e.Description, e.ID)
	if err != nil {
		return fmt.Errorf("update txn: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("entry %d not found", e.ID)
	}

	if _, err := tx.Exec(`DELETE FROM splits WHERE txn_id = ?`, e.ID); err != nil {
		return fmt.Errorf("clear splits: %w", err)
	}
	for i := range e.Splits {
		if _, err := tx.Exec(
			`INSERT INTO splits (txn_id, account_id, amount_cents) VALUES (?, ?, ?)`,
			e.ID, e.Splits[i].AccountID, e.Splits[i].AmountCents,
		); err != nil {
			return fmt.Errorf("insert split: %w", err)
		}
	}
	return tx.Commit()
}

func DeleteEntry(conn *sql.DB, id int64) error {
	tx, err := conn.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM splits WHERE txn_id = ?`, id); err != nil {
		return fmt.Errorf("delete splits: %w", err)
	}
	res, err := tx.Exec(`DELETE FROM txns WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete txn: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("entry %d not found", id)
	}
	return tx.Commit()
}

// ── history & suggestions ────────────────────────────────────────────────────

// History rolls up income, expense and a running net worth per month.
func History(conn *sql.DB, limit int) ([]HistoryPoint, error) {
	if limit <= 0 || limit > 120 {
		limit = 24
	}

	rows, err := conn.Query(`
		SELECT t.month,
		       SUM(CASE WHEN a.type = 'income'  THEN -s.amount_cents ELSE 0 END),
		       SUM(CASE WHEN a.type = 'expense' THEN  s.amount_cents ELSE 0 END),
		       SUM(CASE WHEN a.type IN ('asset','liability') THEN s.amount_cents ELSE 0 END)
		FROM txns t
		JOIN splits s ON s.txn_id = t.id
		JOIN accounts a ON a.id = s.account_id
		GROUP BY t.month
		ORDER BY t.month`)
	if err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	defer rows.Close()

	points := []HistoryPoint{}
	var running int64
	for rows.Next() {
		var p HistoryPoint
		var netChange int64
		if err := rows.Scan(&p.Month, &p.IncomeCents, &p.ExpenseCents, &netChange); err != nil {
			return nil, err
		}
		running += netChange // net worth is cumulative across all prior months
		p.NetWorthCents = running
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(points) > limit {
		points = points[len(points)-limit:]
	}
	return points, nil
}

// Suggest returns past descriptions matching q along with the accounts and
// amount most recently used for them, so repeat entries are one keystroke.
func Suggest(conn *sql.DB, q string) ([]Suggestion, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []Suggestion{}, nil
	}
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)

	// Latest txn per description, then its two primary splits: the credited
	// (negative) side is "from", the debited (positive) side is "to".
	rows, err := conn.Query(`
		SELECT t.description,
		       COALESCE((SELECT s.account_id FROM splits s
		                 WHERE s.txn_id = t.id AND s.amount_cents < 0
		                 ORDER BY s.amount_cents LIMIT 1), 0),
		       COALESCE((SELECT s.account_id FROM splits s
		                 WHERE s.txn_id = t.id AND s.amount_cents > 0
		                 ORDER BY s.amount_cents DESC LIMIT 1), 0),
		       COALESCE((SELECT MAX(s.amount_cents) FROM splits s WHERE s.txn_id = t.id), 0),
		       (SELECT COUNT(*) FROM txns t2 WHERE lower(t2.description) = lower(t.description))
		FROM txns t
		WHERE t.id IN (
			SELECT MAX(id) FROM txns
			WHERE lower(description) LIKE lower(?) ESCAPE '\'
			GROUP BY lower(description)
		)
		ORDER BY 5 DESC, t.id DESC
		LIMIT 6`, esc+"%")
	if err != nil {
		return nil, fmt.Errorf("suggest: %w", err)
	}
	defer rows.Close()

	out := []Suggestion{}
	for rows.Next() {
		var s Suggestion
		if err := rows.Scan(&s.Description, &s.FromAccountID, &s.ToAccountID, &s.AmountCents, &s.Uses); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Register returns an account's entries in date order with a running balance,
// the classic ledger view.
type RegisterRow struct {
	Entry
	AmountCents  int64 `json:"amount_cents"`  // this account's share
	BalanceCents int64 `json:"balance_cents"` // running balance after this entry
}

func Register(conn *sql.DB, accountID int64, limit int) ([]RegisterRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := conn.Query(`
		SELECT t.id, t.date, t.month, t.description, s.amount_cents
		FROM splits s JOIN txns t ON t.id = s.txn_id
		WHERE s.account_id = ?
		ORDER BY t.date, t.id`, accountID)
	if err != nil {
		return nil, fmt.Errorf("register: %w", err)
	}
	defer rows.Close()

	out := []RegisterRow{}
	var running int64
	for rows.Next() {
		var r RegisterRow
		if err := rows.Scan(&r.ID, &r.Date, &r.Month, &r.Description, &r.AmountCents); err != nil {
			return nil, err
		}
		running += r.AmountCents
		r.BalanceCents = running
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Newest first for display, after the running balance is computed oldest-first.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
