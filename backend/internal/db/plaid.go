package db

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Plaid storage and the logic that turns a one-sided bank feed into
// double-entry proposals.
//
// Nothing here writes to the ledger. Imported rows sit in plaid_staging until
// a human accepts them, because a bank feed only ever tells you one side of a
// transaction: that $52.10 left Chase, never whether it was groceries or a
// transfer to savings. Guessing that silently is how books rot.

// Sync modes for a linked account.
const (
	// SyncTransactions imports a feed to review. For chequing, savings, cards.
	SyncTransactions = "transactions"
	// SyncBalance tracks only the value, booking the change as a single
	// market-movement entry. For investments and retirement, where per-trade
	// imports are noise without lot-level cost-basis tracking.
	SyncBalance = "balance"
	// SyncIgnore leaves an account alone.
	SyncIgnore = "ignore"
)

// Staging row states.
const (
	StagedNew     = "new"
	StagedPosted  = "posted"
	StagedIgnored = "ignored"
)

// Item statuses.
const (
	ItemOK            = "ok"
	ItemLoginRequired = "login_required"
	ItemError         = "error"
)

type PlaidItem struct {
	ItemID          string `json:"item_id"`
	InstitutionID   string `json:"institution_id"`
	InstitutionName string `json:"institution_name"`
	Cursor          string `json:"-"` // internal
	Status          string `json:"status"`
	LastSync        string `json:"last_sync"`
	CreatedAt       string `json:"created_at"`
	// AccessToken is deliberately absent from JSON: it never leaves the server.
	AccessToken string `json:"-"`
}

type PlaidAccount struct {
	PlaidAccountID string `json:"plaid_account_id"`
	ItemID         string `json:"item_id"`
	// AccountID is the ledger account this maps onto; 0 means unmapped.
	AccountID    int64  `json:"account_id"`
	Name         string `json:"name"`
	Mask         string `json:"mask"`
	Type         string `json:"type"`
	Subtype      string `json:"subtype"`
	SyncMode     string `json:"sync_mode"`
	BalanceCents int64  `json:"balance_cents"`
	BalanceAt    string `json:"balance_at"`
}

// Staged is one imported transaction awaiting review.
type Staged struct {
	PlaidTxnID     string `json:"plaid_txn_id"`
	PlaidAccountID string `json:"plaid_account_id"`
	Date           string `json:"date"`
	Name           string `json:"name"`
	Merchant       string `json:"merchant"`
	Category       string `json:"category"`
	// AmountCents already uses our sign convention: negative when money left.
	AmountCents int64  `json:"amount_cents"`
	Pending     bool   `json:"pending"`
	Status      string `json:"status"`
	TxnID       int64  `json:"txn_id"`
	// CounterAccountID is the proposed other leg, 0 when we won't guess.
	CounterAccountID int64 `json:"counter_account_id"`
	// TransferPair is the opposite side of an internal transfer, when matched.
	TransferPair string `json:"transfer_pair"`
}

// ── items ────────────────────────────────────────────────────────────────────

func UpsertPlaidItem(conn *sql.DB, it PlaidItem) error {
	_, err := conn.Exec(`
		INSERT INTO plaid_items (item_id, access_token, institution_id, institution_name, status)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (item_id) DO UPDATE SET
			access_token     = excluded.access_token,
			institution_id   = excluded.institution_id,
			institution_name = excluded.institution_name,
			status           = excluded.status`,
		it.ItemID, it.AccessToken, it.InstitutionID, it.InstitutionName, ItemOK)
	if err != nil {
		return fmt.Errorf("upsert plaid item: %w", err)
	}
	return nil
}

func ListPlaidItems(conn *sql.DB) ([]PlaidItem, error) {
	rows, err := conn.Query(
		`SELECT item_id, access_token, institution_id, institution_name, cursor,
		        status, last_sync, created_at
		 FROM plaid_items ORDER BY institution_name, item_id`)
	if err != nil {
		return nil, fmt.Errorf("list plaid items: %w", err)
	}
	defer rows.Close()

	out := []PlaidItem{}
	for rows.Next() {
		var it PlaidItem
		if err := rows.Scan(&it.ItemID, &it.AccessToken, &it.InstitutionID,
			&it.InstitutionName, &it.Cursor, &it.Status, &it.LastSync, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func GetPlaidItem(conn *sql.DB, itemID string) (*PlaidItem, error) {
	var it PlaidItem
	err := conn.QueryRow(
		`SELECT item_id, access_token, institution_id, institution_name, cursor,
		        status, last_sync, created_at
		 FROM plaid_items WHERE item_id = ?`, itemID,
	).Scan(&it.ItemID, &it.AccessToken, &it.InstitutionID, &it.InstitutionName,
		&it.Cursor, &it.Status, &it.LastSync, &it.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("item %s not found", itemID)
	}
	if err != nil {
		return nil, fmt.Errorf("get plaid item: %w", err)
	}
	return &it, nil
}

func SetPlaidCursor(conn *sql.DB, itemID, cursor string) error {
	_, err := conn.Exec(
		`UPDATE plaid_items SET cursor = ?, last_sync = ?, status = ? WHERE item_id = ?`,
		cursor, time.Now().UTC().Format(time.RFC3339), ItemOK, itemID)
	return err
}

func SetPlaidItemStatus(conn *sql.DB, itemID, status string) error {
	_, err := conn.Exec(`UPDATE plaid_items SET status = ? WHERE item_id = ?`, status, itemID)
	return err
}

// DeletePlaidItem unlinks an institution. Staged rows go with it; entries
// already accepted into the books stay, because they're yours now.
func DeletePlaidItem(conn *sql.DB, itemID string) error {
	tx, err := conn.Begin()
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		DELETE FROM plaid_staging WHERE plaid_account_id IN
			(SELECT plaid_account_id FROM plaid_accounts WHERE item_id = ?)
		AND status = ?`, itemID, StagedNew); err != nil {
		return fmt.Errorf("delete staged: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM plaid_accounts WHERE item_id = ?`, itemID); err != nil {
		return fmt.Errorf("delete plaid accounts: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM plaid_items WHERE item_id = ?`, itemID); err != nil {
		return fmt.Errorf("delete plaid item: %w", err)
	}
	return tx.Commit()
}

// ── account mapping ──────────────────────────────────────────────────────────

// UpsertPlaidAccount records an account discovered on an item. An existing
// row's mapping and sync mode are preserved — re-linking must not silently
// undo the mapping you chose.
func UpsertPlaidAccount(conn *sql.DB, a PlaidAccount) error {
	_, err := conn.Exec(`
		INSERT INTO plaid_accounts
			(plaid_account_id, item_id, account_id, name, mask, type, subtype, sync_mode)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (plaid_account_id) DO UPDATE SET
			item_id = excluded.item_id,
			name    = excluded.name,
			mask    = excluded.mask,
			type    = excluded.type,
			subtype = excluded.subtype`,
		a.PlaidAccountID, a.ItemID, a.AccountID, a.Name, a.Mask, a.Type, a.Subtype,
		defaultSyncMode(a.Type, a.Subtype))
	if err != nil {
		return fmt.Errorf("upsert plaid account: %w", err)
	}
	return nil
}

// defaultSyncMode picks a starting mode from Plaid's own classification.
// Investment and retirement accounts default to balance-only: their feeds are
// dividends, reinvestments and internal rebalances that mean nothing without
// cost-basis tracking, and what you actually want is the value.
func defaultSyncMode(accountType, subtype string) string {
	switch strings.ToLower(accountType) {
	case "investment", "brokerage":
		return SyncBalance
	case "depository", "credit":
		return SyncTransactions
	case "loan":
		return SyncBalance
	}
	switch strings.ToLower(subtype) {
	case "401k", "403b", "ira", "roth", "hsa", "brokerage":
		return SyncBalance
	}
	return SyncTransactions
}

func ListPlaidAccounts(conn *sql.DB) ([]PlaidAccount, error) {
	rows, err := conn.Query(
		`SELECT plaid_account_id, item_id, account_id, name, mask, type, subtype,
		        sync_mode, balance_cents, balance_at
		 FROM plaid_accounts ORDER BY item_id, name`)
	if err != nil {
		return nil, fmt.Errorf("list plaid accounts: %w", err)
	}
	defer rows.Close()

	out := []PlaidAccount{}
	for rows.Next() {
		var a PlaidAccount
		if err := rows.Scan(&a.PlaidAccountID, &a.ItemID, &a.AccountID, &a.Name, &a.Mask,
			&a.Type, &a.Subtype, &a.SyncMode, &a.BalanceCents, &a.BalanceAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// MapPlaidAccount points a Plaid account at one of ours and sets how it syncs.
func MapPlaidAccount(conn *sql.DB, plaidAccountID string, accountID int64, syncMode string) error {
	switch syncMode {
	case SyncTransactions, SyncBalance, SyncIgnore:
	default:
		return fmt.Errorf("unknown sync mode %q", syncMode)
	}
	res, err := conn.Exec(
		`UPDATE plaid_accounts SET account_id = ?, sync_mode = ? WHERE plaid_account_id = ?`,
		accountID, syncMode, plaidAccountID)
	if err != nil {
		return fmt.Errorf("map plaid account: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("plaid account %s not found", plaidAccountID)
	}
	return nil
}

func SetPlaidBalance(conn *sql.DB, plaidAccountID string, cents int64, at string) error {
	_, err := conn.Exec(
		`UPDATE plaid_accounts SET balance_cents = ?, balance_at = ? WHERE plaid_account_id = ?`,
		cents, at, plaidAccountID)
	return err
}

// ── staging ──────────────────────────────────────────────────────────────────

// StageTransactions writes imported rows, leaving any already-reviewed row
// alone. Plaid re-sends a transaction when it's modified, and a row you have
// already accepted or dismissed must not silently reappear in the queue.
func StageTransactions(conn *sql.DB, rows []Staged) (int64, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	tx, err := conn.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	var added int64
	for _, s := range rows {
		pending := 0
		if s.Pending {
			pending = 1
		}
		res, err := tx.Exec(`
			INSERT INTO plaid_staging
				(plaid_txn_id, plaid_account_id, date, name, merchant, category,
				 amount_cents, pending, status)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (plaid_txn_id) DO UPDATE SET
				date         = excluded.date,
				name         = excluded.name,
				merchant     = excluded.merchant,
				category     = excluded.category,
				amount_cents = excluded.amount_cents,
				pending      = excluded.pending
			WHERE plaid_staging.status = ?`,
			s.PlaidTxnID, s.PlaidAccountID, s.Date, s.Name, s.Merchant, s.Category,
			s.AmountCents, pending, StagedNew, StagedNew)
		if err != nil {
			return 0, fmt.Errorf("stage %s: %w", s.PlaidTxnID, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added += n
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return added, nil
}

// RemoveStaged drops rows Plaid has retracted, but only if still unreviewed.
func RemoveStaged(conn *sql.DB, plaidTxnIDs []string) error {
	for _, id := range plaidTxnIDs {
		if _, err := conn.Exec(
			`DELETE FROM plaid_staging WHERE plaid_txn_id = ? AND status = ?`,
			id, StagedNew); err != nil {
			return fmt.Errorf("remove staged %s: %w", id, err)
		}
	}
	return nil
}

// ListStaged returns the review queue, newest first.
func ListStaged(conn *sql.DB, status string) ([]Staged, error) {
	if status == "" {
		status = StagedNew
	}
	rows, err := conn.Query(`
		SELECT plaid_txn_id, plaid_account_id, date, name, merchant, category,
		       amount_cents, pending, status, txn_id, counter_account_id, transfer_pair
		FROM plaid_staging WHERE status = ?
		ORDER BY date DESC, plaid_txn_id`, status)
	if err != nil {
		return nil, fmt.Errorf("list staged: %w", err)
	}
	defer rows.Close()

	out := []Staged{}
	for rows.Next() {
		var s Staged
		var pending int64
		if err := rows.Scan(&s.PlaidTxnID, &s.PlaidAccountID, &s.Date, &s.Name, &s.Merchant,
			&s.Category, &s.AmountCents, &pending, &s.Status, &s.TxnID,
			&s.CounterAccountID, &s.TransferPair); err != nil {
			return nil, err
		}
		s.Pending = pending == 1
		out = append(out, s)
	}
	return out, rows.Err()
}

func SetStagedProposal(conn *sql.DB, plaidTxnID string, counterAccountID int64, pair string) error {
	_, err := conn.Exec(
		`UPDATE plaid_staging SET counter_account_id = ?, transfer_pair = ?
		 WHERE plaid_txn_id = ? AND status = ?`,
		counterAccountID, pair, plaidTxnID, StagedNew)
	return err
}

func MarkStaged(conn *sql.DB, plaidTxnIDs []string, status string, txnID int64) error {
	for _, id := range plaidTxnIDs {
		if _, err := conn.Exec(
			`UPDATE plaid_staging SET status = ?, txn_id = ? WHERE plaid_txn_id = ?`,
			status, txnID, id); err != nil {
			return fmt.Errorf("mark staged %s: %w", id, err)
		}
	}
	return nil
}

// ── transfer matching ────────────────────────────────────────────────────────

// TransferWindowDays is how far apart the two sides of an internal transfer
// may post. Card payments and ACH pushes routinely take three days to land on
// the receiving side; much wider and unrelated equal amounts start colliding.
const TransferWindowDays = 4

// MatchTransfers pairs the two sides of a movement between two accounts you
// both own — the single most important thing to get right when importing, and
// the classic way an imported ledger ends up double-counting income.
//
// A pair needs: both accounts mapped, different accounts, opposite signs,
// identical absolute amount, and dates within TransferWindowDays. Each row is
// paired at most once, earliest first so the result is deterministic.
//
// Returns plaid_txn_id → partner plaid_txn_id, both directions.
func MatchTransfers(rows []Staged, ledgerAccount map[string]int64) map[string]string {
	// Deterministic order: by date, then id.
	sorted := make([]Staged, len(rows))
	copy(sorted, rows)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Date != sorted[j].Date {
			return sorted[i].Date < sorted[j].Date
		}
		return sorted[i].PlaidTxnID < sorted[j].PlaidTxnID
	})

	pairs := map[string]string{}
	taken := map[string]bool{}

	for i := range sorted {
		a := sorted[i]
		if taken[a.PlaidTxnID] || a.AmountCents == 0 {
			continue
		}
		accA, okA := ledgerAccount[a.PlaidAccountID]
		if !okA || accA == 0 {
			continue
		}

		for j := i + 1; j < len(sorted); j++ {
			b := sorted[j]
			if taken[b.PlaidTxnID] {
				continue
			}
			// Same account can't transfer to itself.
			accB, okB := ledgerAccount[b.PlaidAccountID]
			if !okB || accB == 0 || accA == accB {
				continue
			}
			// Opposite sides of the same amount.
			if a.AmountCents != -b.AmountCents {
				continue
			}
			if daysApart(a.Date, b.Date) > TransferWindowDays {
				continue
			}

			pairs[a.PlaidTxnID] = b.PlaidTxnID
			pairs[b.PlaidTxnID] = a.PlaidTxnID
			taken[a.PlaidTxnID] = true
			taken[b.PlaidTxnID] = true
			break
		}
	}
	return pairs
}

// daysApart returns the absolute gap in days, or a large number if either
// date is unparseable — an unreadable date must never look like a match.
func daysApart(a, b string) int {
	ta, err1 := time.Parse("2006-01-02", a)
	tb, err2 := time.Parse("2006-01-02", b)
	if err1 != nil || err2 != nil {
		return 1 << 30
	}
	d := int(ta.Sub(tb).Hours() / 24)
	if d < 0 {
		return -d
	}
	return d
}

// ── proposals ────────────────────────────────────────────────────────────────

// ProposeCounterAccounts fills in the other leg for each staged row, using
// what you did last time with the same description. Deliberately conservative:
// where there is no precedent it proposes nothing and leaves you to choose,
// because a wrong account posted silently is worse than an empty box.
//
// Transfers are handled by MatchTransfers and skipped here.
func ProposeCounterAccounts(conn *sql.DB, rows []Staged, pairs map[string]string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, s := range rows {
		if pairs[s.PlaidTxnID] != "" {
			continue // already explained as a transfer
		}
		name := s.Merchant
		if name == "" {
			name = s.Name
		}
		id, err := lastCounterAccount(conn, name, s.AmountCents < 0)
		if err != nil {
			return nil, err
		}
		if id != 0 {
			out[s.PlaidTxnID] = id
		}
	}
	return out, nil
}

// minPrefix is how much of a description has to survive normalisation before
// it's worth matching on. Shorter than this and "SQ" would match every card
// transaction you've ever made.
const minPrefix = 4

// descriptionPrefix reduces a bank description to its stable part, so that
// "TRADER JOE'S #412" and "TRADER JOE'S #998" are recognised as the same
// merchant. The varying part is nearly always a trailing store or terminal
// number, so the text is cut at the first digit and stripped of the
// punctuation that tends to sit in front of it ("SQ *CAFE 12345" → "SQ *CAFE").
//
// Iterates runes rather than bytes: slicing a byte offset could split a
// multi-byte character and produce a prefix that matches nothing.
func descriptionPrefix(description string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(description) {
		if r >= '0' && r <= '9' {
			break
		}
		b.WriteRune(r)
	}
	prefix := strings.TrimRight(b.String(), " \t-#*/.,:;&")

	// A description that starts with a digit ("7-ELEVEN 4021") leaves nothing
	// behind, so fall back to matching the whole thing.
	if len([]rune(prefix)) < minPrefix {
		trimmed := strings.TrimSpace(description)
		if len([]rune(trimmed)) < minPrefix {
			return ""
		}
		return trimmed
	}
	return prefix
}

// lastCounterAccount finds the account this description last posted against.
// spending picks the destination side of the most recent matching entry;
// income picks the source side.
func lastCounterAccount(conn *sql.DB, description string, spending bool) (int64, error) {
	description = strings.TrimSpace(description)
	if description == "" {
		return 0, nil
	}
	prefix := descriptionPrefix(description)
	if prefix == "" {
		return 0, nil
	}
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(prefix)

	// The counter leg is the expense side when spending, the income side when
	// money arrived. Opening balances are never a sensible proposal.
	side := "> 0"
	if !spending {
		side = "< 0"
	}
	var id int64
	err := conn.QueryRow(`
		SELECT s.account_id
		FROM splits s
		JOIN txns t     ON t.id = s.txn_id
		JOIN accounts a ON a.id = s.account_id
		WHERE lower(t.description) LIKE lower(?) ESCAPE '\'
		  AND s.amount_cents `+side+`
		  AND a.type IN ('expense', 'income')
		ORDER BY t.id DESC
		LIMIT 1`, esc+"%").Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("propose counter account: %w", err)
	}
	return id, nil
}

// ── accepting into the books ─────────────────────────────────────────────────

// MarketMovementAccount holds unrealised gains and losses on balance-synced
// accounts. Value changes have to post somewhere for the ledger to balance,
// and they are income in the accounting sense even when nothing was sold.
const MarketMovementAccount = "Market Movement"

// AcceptInput accepts one staged row into the ledger. For a matched transfer,
// either side may be passed: both are posted as the single entry they are.
type AcceptInput struct {
	PlaidTxnID string
	// CounterAccountID is the other leg. Ignored for matched transfers, where
	// both legs are already known.
	CounterAccountID int64
	// Description overrides the bank's text, which is often shouty.
	Description string
}

// AcceptStaged turns an imported row into a real double-entry transaction.
//
// The linked account's split is marked cleared when the transaction has
// actually posted at the bank: it came from the bank's own record, which is
// exactly what clearing asserts. Pending rows stay unreconciled — they can
// still change amount or vanish entirely.
func AcceptStaged(conn *sql.DB, in AcceptInput) (*Entry, error) {
	row, err := getStaged(conn, in.PlaidTxnID)
	if err != nil {
		return nil, err
	}
	if row.Status != StagedNew {
		return nil, fmt.Errorf("%s has already been reviewed", in.PlaidTxnID)
	}

	ourAccount, err := mappedAccount(conn, row.PlaidAccountID)
	if err != nil {
		return nil, err
	}

	description := strings.TrimSpace(in.Description)
	if description == "" {
		description = row.Merchant
	}
	if description == "" {
		description = row.Name
	}

	var (
		splits  []Split
		posted  = []string{row.PlaidTxnID}
		clearOn = []int64{ourAccount}
		date    = row.Date
	)

	if row.TransferPair != "" {
		// Both sides are ours, so this is one movement seen twice. Posting it
		// as two entries would double-count it.
		other, err := getStaged(conn, row.TransferPair)
		if err != nil {
			return nil, fmt.Errorf("transfer partner: %w", err)
		}
		if other.Status != StagedNew {
			return nil, fmt.Errorf("transfer partner %s has already been reviewed", other.PlaidTxnID)
		}
		otherAccount, err := mappedAccount(conn, other.PlaidAccountID)
		if err != nil {
			return nil, err
		}
		if row.AmountCents == 0 || row.AmountCents != -other.AmountCents {
			return nil, fmt.Errorf("transfer sides no longer offset each other")
		}

		splits = []Split{
			{AccountID: ourAccount, AmountCents: row.AmountCents},
			{AccountID: otherAccount, AmountCents: other.AmountCents},
		}
		posted = append(posted, other.PlaidTxnID)
		clearOn = append(clearOn, otherAccount)
		// The earlier date is when the money actually moved.
		if other.Date < date {
			date = other.Date
		}
	} else {
		counter := in.CounterAccountID
		if counter == 0 {
			counter = row.CounterAccountID
		}
		if counter == 0 {
			return nil, fmt.Errorf("pick an account for the other side of %q", description)
		}
		if counter == ourAccount {
			return nil, fmt.Errorf("an entry cannot move money to the same account")
		}
		splits = []Split{
			{AccountID: ourAccount, AmountCents: row.AmountCents},
			{AccountID: counter, AmountCents: -row.AmountCents},
		}
	}

	entry, err := CreateEntry(conn, Entry{
		Date:        date,
		Month:       date[:7],
		Description: description,
		Splits:      splits,
	})
	if err != nil {
		return nil, err
	}

	// Imported and settled means the bank has it, which is what "cleared"
	// asserts — so reconciling becomes checking the total rather than
	// re-ticking every row by hand.
	if !row.Pending {
		if err := clearImportedSplits(conn, entry.ID, clearOn); err != nil {
			return nil, err
		}
	}
	if err := MarkStaged(conn, posted, StagedPosted, entry.ID); err != nil {
		return nil, err
	}
	return entry, nil
}

// clearImportedSplits marks the linked accounts' sides of a new entry cleared.
// Only those sides: the expense leg of a purchase never appears on a statement.
func clearImportedSplits(conn *sql.DB, txnID int64, accountIDs []int64) error {
	for _, id := range accountIDs {
		if _, err := conn.Exec(
			`UPDATE splits SET reconcile_state = ? WHERE txn_id = ? AND account_id = ?`,
			ReconcileCleared, txnID, id); err != nil {
			return fmt.Errorf("clear imported split: %w", err)
		}
	}
	return nil
}

func getStaged(conn *sql.DB, plaidTxnID string) (*Staged, error) {
	var s Staged
	var pending int64
	err := conn.QueryRow(`
		SELECT plaid_txn_id, plaid_account_id, date, name, merchant, category,
		       amount_cents, pending, status, txn_id, counter_account_id, transfer_pair
		FROM plaid_staging WHERE plaid_txn_id = ?`, plaidTxnID,
	).Scan(&s.PlaidTxnID, &s.PlaidAccountID, &s.Date, &s.Name, &s.Merchant, &s.Category,
		&s.AmountCents, &pending, &s.Status, &s.TxnID, &s.CounterAccountID, &s.TransferPair)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("staged transaction %s not found", plaidTxnID)
	}
	if err != nil {
		return nil, fmt.Errorf("get staged: %w", err)
	}
	s.Pending = pending == 1
	return &s, nil
}

// mappedAccount resolves a Plaid account to the ledger account it feeds.
func mappedAccount(conn *sql.DB, plaidAccountID string) (int64, error) {
	var id int64
	err := conn.QueryRow(
		`SELECT account_id FROM plaid_accounts WHERE plaid_account_id = ?`, plaidAccountID,
	).Scan(&id)
	if err == sql.ErrNoRows || id == 0 {
		return 0, fmt.Errorf("plaid account %s is not mapped to one of your accounts", plaidAccountID)
	}
	if err != nil {
		return 0, fmt.Errorf("resolve plaid account: %w", err)
	}
	return id, nil
}

// ── balance-only sync ────────────────────────────────────────────────────────

// ApplyBalance brings a balance-synced account to the value the institution
// reports, booking the difference against Market Movement.
//
// This is how investment and retirement accounts stay accurate without
// importing every dividend and rebalance: what matters is that the 401k is
// worth $X now, not that it bought 0.42 units of a target-date fund.
//
// plaidBalanceCents is Plaid's figure, which is positive for both cash and
// debt; the sign is corrected here from the ledger account's own type.
func ApplyBalance(conn *sql.DB, accountID int64, plaidBalanceCents int64, date string) (*Entry, error) {
	var accountType, name string
	err := conn.QueryRow(`SELECT type, name FROM accounts WHERE id = ?`, accountID).
		Scan(&accountType, &name)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("account %d not found", accountID)
	}
	if err != nil {
		return nil, fmt.Errorf("load account: %w", err)
	}

	// Plaid reports debt as a positive amount owed; our schema stores it
	// negative, so liabilities flip.
	target := plaidBalanceCents
	if accountType == TypeLiability {
		target = -plaidBalanceCents
	}

	var current sql.NullInt64
	if err := conn.QueryRow(
		`SELECT SUM(amount_cents) FROM splits WHERE account_id = ?`, accountID,
	).Scan(&current); err != nil {
		return nil, fmt.Errorf("current balance: %w", err)
	}

	delta := target - current.Int64
	if delta == 0 {
		return nil, nil // already correct; nothing to book
	}

	movement, err := ensureAccount(conn, MarketMovementAccount, TypeIncome)
	if err != nil {
		return nil, err
	}

	return CreateEntry(conn, Entry{
		Date:        date,
		Month:       date[:7],
		Description: name + " value change",
		Splits: []Split{
			{AccountID: accountID, AmountCents: delta},
			{AccountID: movement, AmountCents: -delta},
		},
	})
}

// ensureAccount finds an account by name, creating it if it's missing.
func ensureAccount(conn *sql.DB, name, accountType string) (int64, error) {
	var id int64
	err := conn.QueryRow(`SELECT id FROM accounts WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("find %s: %w", name, err)
	}
	created, err := CreateAccount(conn, Account{
		Name: name, Type: accountType, InGoal: true, Sort: 900,
	})
	if err != nil {
		return 0, err
	}
	return created.ID, nil
}
