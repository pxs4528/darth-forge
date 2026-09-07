package db

import "testing"

// Reconciling proves your books against a bank statement for one account.
// These tests pin the two behaviours that make it trustworthy: the cleared
// balance only counts what you ticked, and a locked statement refuses edits.

func TestClearedBalanceCountsOnlyTickedSplits(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	paycheck := account(t, conn, "Test Paycheck", TypeIncome)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	pay := entry(t, conn, "2026-08-01", "Paycheck", paycheck, checking, 300_000)
	shop := entry(t, conn, "2026-08-03", "Groceries", checking, groceries, 20_000)
	entry(t, conn, "2026-08-29", "Not on the statement yet", checking, groceries, 5_000)

	if got, err := ClearedBalance(conn, checking); err != nil || got != 0 {
		t.Fatalf("ClearedBalance before ticking = %d, %v; want 0", got, err)
	}

	// Tick the two that appear on the statement.
	ids := []int64{
		splitIDFor(t, conn, pay.ID, checking),
		splitIDFor(t, conn, shop.ID, checking),
	}
	if n, err := SetReconcileState(conn, ids, ReconcileCleared); err != nil || n != 2 {
		t.Fatalf("SetReconcileState = %d, %v; want 2", n, err)
	}

	// 3000.00 in, 200.00 out — the pending 50.00 must not count.
	if got, err := ClearedBalance(conn, checking); err != nil || got != 280_000 {
		t.Fatalf("ClearedBalance = %d, %v; want 280000", got, err)
	}
}

func TestClearedBalanceIsPerAccount(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	savings := account(t, conn, "Test Savings", TypeAsset)

	move := entry(t, conn, "2026-08-05", "To savings", checking, savings, 100_000)

	// Tick only the checking side, as you would against a checking statement.
	if _, err := SetReconcileState(conn,
		[]int64{splitIDFor(t, conn, move.ID, checking)}, ReconcileCleared); err != nil {
		t.Fatalf("SetReconcileState: %v", err)
	}

	if got, _ := ClearedBalance(conn, checking); got != -100_000 {
		t.Errorf("checking cleared = %d; want -100000", got)
	}
	// The savings side is untouched — it reconciles against its own statement.
	if got, _ := ClearedBalance(conn, savings); got != 0 {
		t.Errorf("savings cleared = %d; want 0", got)
	}
}

func TestLockAndUnlockMoveOnlyClearedSplits(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	a := entry(t, conn, "2026-08-02", "Cleared", checking, groceries, 1_000)
	entry(t, conn, "2026-08-04", "Left alone", checking, groceries, 2_000)

	if _, err := SetReconcileState(conn,
		[]int64{splitIDFor(t, conn, a.ID, checking)}, ReconcileCleared); err != nil {
		t.Fatalf("clear: %v", err)
	}

	n, err := LockCleared(conn, checking)
	if err != nil || n != 1 {
		t.Fatalf("LockCleared = %d, %v; want 1", n, err)
	}
	// Locking again is a no-op: nothing is left in the cleared state.
	if n, _ := LockCleared(conn, checking); n != 0 {
		t.Errorf("second LockCleared = %d; want 0", n)
	}
	// Locked splits still count toward the cleared balance.
	if got, _ := ClearedBalance(conn, checking); got != -1_000 {
		t.Errorf("cleared balance after lock = %d; want -1000", got)
	}

	if n, err := UnlockAccount(conn, checking); err != nil || n != 1 {
		t.Fatalf("UnlockAccount = %d, %v; want 1", n, err)
	}
}

func TestLockedEntriesRefuseEditAndDelete(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	e := entry(t, conn, "2026-08-02", "Proved", checking, groceries, 1_000)
	if _, err := SetReconcileState(conn,
		[]int64{splitIDFor(t, conn, e.ID, checking)}, ReconcileLocked); err != nil {
		t.Fatalf("lock: %v", err)
	}

	e.Description = "Changed my mind"
	if err := UpdateEntry(conn, *e); err != ErrLocked {
		t.Errorf("UpdateEntry on locked entry = %v; want ErrLocked", err)
	}
	if err := DeleteEntry(conn, e.ID); err != ErrLocked {
		t.Errorf("DeleteEntry on locked entry = %v; want ErrLocked", err)
	}

	// And the entry really is still there, unchanged.
	var desc string
	if err := conn.QueryRow(`SELECT description FROM txns WHERE id = ?`, e.ID).Scan(&desc); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if desc != "Proved" {
		t.Errorf("description = %q; want %q", desc, "Proved")
	}
}

func TestEditingAnUnlockedEntryDropsItsClearedMarks(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	e := entry(t, conn, "2026-08-02", "Typo", checking, groceries, 1_000)
	if _, err := SetReconcileState(conn,
		[]int64{splitIDFor(t, conn, e.ID, checking)}, ReconcileCleared); err != nil {
		t.Fatalf("clear: %v", err)
	}

	// Correcting the amount invalidates the earlier tick-off: what you matched
	// against the statement is no longer what the entry says.
	e.Splits = []Split{
		{AccountID: checking, AmountCents: -1_500},
		{AccountID: groceries, AmountCents: 1_500},
	}
	if err := UpdateEntry(conn, *e); err != nil {
		t.Fatalf("UpdateEntry: %v", err)
	}
	if got, _ := ClearedBalance(conn, checking); got != 0 {
		t.Errorf("cleared balance after edit = %d; want 0 (marks dropped)", got)
	}
}

func TestSetReconcileStateRejectsUnknownState(t *testing.T) {
	conn := newTestDB(t)
	if _, err := SetReconcileState(conn, []int64{1}, "maybe"); err == nil {
		t.Error("expected an error for an unknown reconcile state")
	}
}

func TestRegisterReportsSplitIDAndState(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	e := entry(t, conn, "2026-08-02", "Coffee", checking, groceries, 500)
	want := splitIDFor(t, conn, e.ID, checking)
	if _, err := SetReconcileState(conn, []int64{want}, ReconcileCleared); err != nil {
		t.Fatalf("clear: %v", err)
	}

	rows, err := Register(conn, checking, 0)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("Register returned %d rows; want 1", len(rows))
	}
	if rows[0].SplitID != want {
		t.Errorf("SplitID = %d; want %d", rows[0].SplitID, want)
	}
	if rows[0].ReconcileState != ReconcileCleared {
		t.Errorf("ReconcileState = %q; want %q", rows[0].ReconcileState, ReconcileCleared)
	}
}

// ── opening a fresh book ─────────────────────────────────────────────────────

func TestResetLedgerClearsEntriesButKeepsTheChartOfAccounts(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	entry(t, conn, "2026-07-02", "Old and wrong", checking, groceries, 1_000)
	entry(t, conn, "2026-07-09", "Also wrong", checking, groceries, 2_000)

	accountsBefore := countRows(t, conn, "accounts")
	if err := SetGoal(conn, Goal{GoalCents: 12_345_600, TargetMonth: "2029-01", EmergencyMonths: 4}); err != nil {
		t.Fatalf("SetGoal: %v", err)
	}

	deleted, err := ResetLedger(conn)
	if err != nil {
		t.Fatalf("ResetLedger: %v", err)
	}
	if deleted != 2 {
		t.Errorf("deleted = %d; want 2", deleted)
	}

	if n := countRows(t, conn, "txns"); n != 0 {
		t.Errorf("txns remaining = %d; want 0", n)
	}
	if n := countRows(t, conn, "splits"); n != 0 {
		t.Errorf("splits remaining = %d; want 0", n)
	}
	// The catalog, asset classes and goal are what you keep across a reset.
	if n := countRows(t, conn, "accounts"); n != accountsBefore {
		t.Errorf("accounts = %d; want %d — a reset must not touch the catalog", n, accountsBefore)
	}
	goal, err := GetGoal(conn)
	if err != nil || goal.GoalCents != 12_345_600 || goal.EmergencyMonths != 4 {
		t.Errorf("goal after reset = %+v, %v; want it preserved", goal, err)
	}
}

func TestResetLedgerOnEmptyBooksIsHarmless(t *testing.T) {
	conn := newTestDB(t)
	deleted, err := ResetLedger(conn)
	if err != nil {
		t.Fatalf("ResetLedger: %v", err)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d; want 0", deleted)
	}
}

// After a reset you open the book by recording opening balances on your start
// date. This is the whole "start fresh at 1 August" flow in one test.
func TestOpeningTheBookAfterAReset(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	card := account(t, conn, "Test Card", TypeLiability)
	groceries := account(t, conn, "Test Groceries", TypeExpense)

	entry(t, conn, "2026-07-15", "Junk from the old books", checking, groceries, 9_999)
	if _, err := ResetLedger(conn); err != nil {
		t.Fatalf("ResetLedger: %v", err)
	}

	// Opening balances are booked against equity so the ledger still balances.
	var equity int64
	if err := conn.QueryRow(
		`SELECT id FROM accounts WHERE type = ? LIMIT 1`, TypeEquity).Scan(&equity); err != nil {
		t.Fatalf("find equity account: %v", err)
	}
	entry(t, conn, "2026-08-01", "Opening balance", equity, checking, 1_200_000)
	entry(t, conn, "2026-08-01", "Opening balance", card, equity, 50_000)
	entry(t, conn, "2026-08-04", "Groceries", checking, groceries, 20_000)

	state, err := GetMonth(conn, "2026-08")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	// 12000.00 cash less 500.00 owed less 200.00 spent.
	if got := state.Summary.NetWorthCents; got != 1_130_000 {
		t.Errorf("net worth = %d; want 1130000", got)
	}
	// Opening balances establish the books rather than being growth, so only
	// the 200.00 of real spending moves the month's change.
	if got := state.Summary.NetWorthChange; got != -20_000 {
		t.Errorf("net worth change = %d; want -20000", got)
	}
}
