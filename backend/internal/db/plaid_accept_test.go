package db

import (
	"database/sql"
	"testing"
)

// Accepting is the only path by which Plaid data reaches the ledger, so these
// cover the ways an import can corrupt books: double-counting transfers,
// posting to the wrong side, and clearing things the bank hasn't settled.

// mustLink wires a Plaid account to a ledger account, ready to stage against.
func mustLink(t *testing.T, conn *sql.DB, plaidID, itemID string, ledgerID int64) {
	t.Helper()
	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: plaidID, ItemID: itemID, Name: plaidID,
		Type: "depository", Subtype: "checking",
	}); err != nil {
		t.Fatalf("UpsertPlaidAccount %s: %v", plaidID, err)
	}
	if err := MapPlaidAccount(conn, plaidID, ledgerID, SyncTransactions); err != nil {
		t.Fatalf("MapPlaidAccount %s: %v", plaidID, err)
	}
}

func mustStage(t *testing.T, conn *sql.DB, rows ...Staged) {
	t.Helper()
	if _, err := StageTransactions(conn, rows); err != nil {
		t.Fatalf("StageTransactions: %v", err)
	}
}

func mustList(t *testing.T, conn *sql.DB) []Staged {
	t.Helper()
	rows, err := ListStaged(conn, StagedNew)
	if err != nil {
		t.Fatalf("ListStaged: %v", err)
	}
	return rows
}

// balanceOf is the account's stored balance, in schema signs.
func balanceOf(t *testing.T, conn *sql.DB, accountID int64) int64 {
	t.Helper()
	var cents sql.NullInt64
	if err := conn.QueryRow(
		`SELECT SUM(amount_cents) FROM splits WHERE account_id = ?`, accountID,
	).Scan(&cents); err != nil {
		t.Fatalf("balance of %d: %v", accountID, err)
	}
	return cents.Int64
}

// equityAccount is the seeded Opening Balances account.
func equityAccount(t *testing.T, conn *sql.DB) int64 {
	t.Helper()
	var id int64
	if err := conn.QueryRow(
		`SELECT id FROM accounts WHERE type = ? LIMIT 1`, TypeEquity).Scan(&id); err != nil {
		t.Fatalf("find equity account: %v", err)
	}
	return id
}

func TestAcceptPostsSpendingToTheRightSides(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	mustLink(t, conn, "chase", "item-1", checking)
	mustStage(t, conn, staged("t1", "chase", "2026-08-04", -5_210))

	entry, err := AcceptStaged(conn, AcceptInput{
		PlaidTxnID: "t1", CounterAccountID: groceries, Description: "Trader Joe's",
	})
	if err != nil {
		t.Fatalf("AcceptStaged: %v", err)
	}

	if got := balanceOf(t, conn, checking); got != -5_210 {
		t.Errorf("checking = %d; want -5210 (money left)", got)
	}
	if got := balanceOf(t, conn, groceries); got != 5_210 {
		t.Errorf("groceries = %d; want 5210 (money spent)", got)
	}
	if entry.Description != "Trader Joe's" {
		t.Errorf("description = %q; want the override", entry.Description)
	}
}

func TestAcceptPostsIncomeTheOtherWayRound(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	payroll := account(t, conn, "Test Payroll", TypeIncome)

	mustLink(t, conn, "chase", "item-1", checking)
	mustStage(t, conn, staged("t1", "chase", "2026-08-01", 287_592))

	if _, err := AcceptStaged(conn, AcceptInput{
		PlaidTxnID: "t1", CounterAccountID: payroll,
	}); err != nil {
		t.Fatalf("AcceptStaged: %v", err)
	}

	if got := balanceOf(t, conn, checking); got != 287_592 {
		t.Errorf("checking = %d; want 287592 (money arrived)", got)
	}
	// Income is stored negative by accounting convention.
	if got := balanceOf(t, conn, payroll); got != -287_592 {
		t.Errorf("payroll = %d; want -287592", got)
	}
}

func TestAcceptingATransferPostsOneEntryNotTwo(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	savings := account(t, conn, "Test Savings", TypeAsset)

	mustLink(t, conn, "chase", "item-1", checking)
	mustLink(t, conn, "hysa", "item-2", savings)
	mustStage(t, conn,
		staged("out", "chase", "2026-08-05", -100_000),
		staged("in", "hysa", "2026-08-07", 100_000),
	)

	// Pair them the way a sync would.
	pairs := MatchTransfers(mustList(t, conn), map[string]int64{"chase": checking, "hysa": savings})
	if pairs["out"] != "in" {
		t.Fatalf("setup: transfer not matched, got %v", pairs)
	}
	for id, partner := range pairs {
		if err := SetStagedProposal(conn, id, 0, partner); err != nil {
			t.Fatalf("SetStagedProposal: %v", err)
		}
	}

	entry, err := AcceptStaged(conn, AcceptInput{PlaidTxnID: "out"})
	if err != nil {
		t.Fatalf("AcceptStaged: %v", err)
	}

	// One entry, both sides, and net worth unchanged.
	if n := countRows(t, conn, "txns"); n != 1 {
		t.Errorf("entries = %d; want 1 — a transfer seen twice is still one movement", n)
	}
	if got := balanceOf(t, conn, checking); got != -100_000 {
		t.Errorf("checking = %d; want -100000", got)
	}
	if got := balanceOf(t, conn, savings); got != 100_000 {
		t.Errorf("savings = %d; want 100000", got)
	}
	// The earlier date is when the money actually left.
	if entry.Date != "2026-08-05" {
		t.Errorf("date = %q; want the earlier side, 2026-08-05", entry.Date)
	}

	// Both staged rows are consumed, so the queue is empty and the partner
	// can't be posted a second time.
	queue, _ := ListStaged(conn, StagedNew)
	if len(queue) != 0 {
		t.Errorf("queue = %v; want empty", queue)
	}
	if _, err := AcceptStaged(conn, AcceptInput{PlaidTxnID: "in"}); err == nil {
		t.Error("accepting the other side again should fail")
	}
}

func TestAcceptMarksSettledImportsCleared(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	mustLink(t, conn, "chase", "item-1", checking)
	mustStage(t, conn, staged("t1", "chase", "2026-08-04", -5_000))

	if _, err := AcceptStaged(conn, AcceptInput{
		PlaidTxnID: "t1", CounterAccountID: groceries,
	}); err != nil {
		t.Fatalf("AcceptStaged: %v", err)
	}

	// It came from the bank's own record, which is what clearing asserts.
	if got, _ := ClearedBalance(conn, checking); got != -5_000 {
		t.Errorf("checking cleared = %d; want -5000", got)
	}
	// But only the bank's side: the expense leg never appears on a statement.
	if got, _ := ClearedBalance(conn, groceries); got != 0 {
		t.Errorf("groceries cleared = %d; want 0", got)
	}
}

func TestAcceptLeavesPendingTransactionsUncleared(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	mustLink(t, conn, "chase", "item-1", checking)
	row := staged("t1", "chase", "2026-08-04", -5_000)
	row.Pending = true
	mustStage(t, conn, row)

	if _, err := AcceptStaged(conn, AcceptInput{
		PlaidTxnID: "t1", CounterAccountID: groceries,
	}); err != nil {
		t.Fatalf("AcceptStaged: %v", err)
	}

	// A pending charge can still change amount or vanish, so it isn't proof.
	if got, _ := ClearedBalance(conn, checking); got != 0 {
		t.Errorf("cleared = %d; want 0 for a pending transaction", got)
	}
}

func TestAcceptRefusesWithoutACounterAccount(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)

	mustLink(t, conn, "chase", "item-1", checking)
	mustStage(t, conn, staged("t1", "chase", "2026-08-04", -5_000))

	if _, err := AcceptStaged(conn, AcceptInput{PlaidTxnID: "t1"}); err == nil {
		t.Error("expected an error rather than a guess at the other side")
	}
	if n := countRows(t, conn, "txns"); n != 0 {
		t.Errorf("entries = %d; a refused accept must not write", n)
	}
}

func TestAcceptRefusesAnUnmappedAccount(t *testing.T) {
	conn := newTestDB(t)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: "chase", ItemID: "item-1", Type: "depository", Subtype: "checking",
	}); err != nil {
		t.Fatalf("UpsertPlaidAccount: %v", err)
	}
	mustStage(t, conn, staged("t1", "chase", "2026-08-04", -5_000))

	if _, err := AcceptStaged(conn, AcceptInput{
		PlaidTxnID: "t1", CounterAccountID: groceries,
	}); err == nil {
		t.Error("expected an error for an unmapped Plaid account")
	}
}

func TestAcceptIsNotRepeatable(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	mustLink(t, conn, "chase", "item-1", checking)
	mustStage(t, conn, staged("t1", "chase", "2026-08-04", -5_000))

	in := AcceptInput{PlaidTxnID: "t1", CounterAccountID: groceries}
	if _, err := AcceptStaged(conn, in); err != nil {
		t.Fatalf("first accept: %v", err)
	}
	if _, err := AcceptStaged(conn, in); err == nil {
		t.Error("accepting twice should fail — that's how you get duplicates")
	}
	if n := countRows(t, conn, "txns"); n != 1 {
		t.Errorf("entries = %d; want 1", n)
	}
}

// ── balance-only sync ────────────────────────────────────────────────────────

func TestApplyBalanceBooksTheDifferenceAsMarketMovement(t *testing.T) {
	conn := newTestDB(t)
	brokerage := account(t, conn, "Test Brokerage", TypeAsset)
	equity := equityAccount(t, conn)

	// Opening position of 30,000.00.
	entry(t, conn, "2026-08-01", "Opening balance", equity, brokerage, 3_000_000)

	// Plaid now reports 35,983.28.
	got, err := ApplyBalance(conn, brokerage, 3_598_328, "2026-08-30")
	if err != nil {
		t.Fatalf("ApplyBalance: %v", err)
	}
	if got == nil {
		t.Fatal("expected an entry for the value change")
	}

	if bal := balanceOf(t, conn, brokerage); bal != 3_598_328 {
		t.Errorf("brokerage = %d; want 3598328", bal)
	}
	movement, err := ensureAccount(conn, MarketMovementAccount, TypeIncome)
	if err != nil {
		t.Fatalf("ensureAccount: %v", err)
	}
	// A gain is income, stored negative by convention.
	if bal := balanceOf(t, conn, movement); bal != -598_328 {
		t.Errorf("market movement = %d; want -598328", bal)
	}
}

func TestApplyBalanceIsIdempotent(t *testing.T) {
	conn := newTestDB(t)
	brokerage := account(t, conn, "Test Brokerage", TypeAsset)
	equity := equityAccount(t, conn)
	entry(t, conn, "2026-08-01", "Opening balance", equity, brokerage, 3_000_000)

	if _, err := ApplyBalance(conn, brokerage, 3_100_000, "2026-08-30"); err != nil {
		t.Fatalf("first: %v", err)
	}
	before := countRows(t, conn, "txns")

	// Syncing again with an unchanged balance must not book a zero entry
	// every night — the register would fill with noise.
	second, err := ApplyBalance(conn, brokerage, 3_100_000, "2026-08-31")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second != nil {
		t.Error("expected no entry when the balance is already correct")
	}
	if after := countRows(t, conn, "txns"); after != before {
		t.Errorf("entries went %d → %d; want unchanged", before, after)
	}
}

func TestApplyBalanceHandlesADropInValue(t *testing.T) {
	conn := newTestDB(t)
	brokerage := account(t, conn, "Test Brokerage", TypeAsset)
	equity := equityAccount(t, conn)
	entry(t, conn, "2026-08-01", "Opening balance", equity, brokerage, 3_000_000)

	if _, err := ApplyBalance(conn, brokerage, 2_750_000, "2026-08-30"); err != nil {
		t.Fatalf("ApplyBalance: %v", err)
	}
	if bal := balanceOf(t, conn, brokerage); bal != 2_750_000 {
		t.Errorf("brokerage = %d; want 2750000", bal)
	}
	movement, _ := ensureAccount(conn, MarketMovementAccount, TypeIncome)
	// A loss is negative income, so it stores positive.
	if bal := balanceOf(t, conn, movement); bal != 250_000 {
		t.Errorf("market movement = %d; want 250000", bal)
	}
}

func TestApplyBalanceFlipsSignForLiabilities(t *testing.T) {
	conn := newTestDB(t)
	card := account(t, conn, "Test Card", TypeLiability)

	// Plaid reports debt as a positive amount owed; we store it negative.
	if _, err := ApplyBalance(conn, card, 50_000, "2026-08-30"); err != nil {
		t.Fatalf("ApplyBalance: %v", err)
	}
	if bal := balanceOf(t, conn, card); bal != -50_000 {
		t.Errorf("card = %d; want -50000 (owed)", bal)
	}

	// And it has to subtract from net worth rather than adding to it, which
	// is the whole reason the sign flip exists.
	accounts, err := AccountBalances(conn, "2026-08")
	if err != nil {
		t.Fatalf("AccountBalances: %v", err)
	}
	for _, a := range accounts {
		if a.ID == card && a.BalanceCents != -50_000 {
			t.Errorf("card balance = %d; want -50000", a.BalanceCents)
		}
	}
}

func TestApplyBalanceCreatesMarketMovementOnce(t *testing.T) {
	conn := newTestDB(t)
	a := account(t, conn, "Test Brokerage A", TypeAsset)
	b := account(t, conn, "Test Brokerage B", TypeAsset)

	if _, err := ApplyBalance(conn, a, 100_000, "2026-08-30"); err != nil {
		t.Fatalf("a: %v", err)
	}
	if _, err := ApplyBalance(conn, b, 200_000, "2026-08-30"); err != nil {
		t.Fatalf("b: %v", err)
	}

	var n int64
	if err := conn.QueryRow(
		`SELECT COUNT(*) FROM accounts WHERE name = ?`, MarketMovementAccount).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Errorf("Market Movement accounts = %d; want 1", n)
	}
}
