package db

import (
	"bytes"
	"strings"
	"testing"
)

// staged is a terse constructor for building match scenarios.
func staged(id, plaidAccount, date string, cents int64) Staged {
	return Staged{
		PlaidTxnID:     id,
		PlaidAccountID: plaidAccount,
		Date:           date,
		Name:           "txn " + id,
		AmountCents:    cents,
		Status:         StagedNew,
	}
}

// The mapping every transfer test shares: two Plaid accounts on two of ours.
var mapped = map[string]int64{"chase": 1, "hysa": 2, "card": 3}

func TestMatchTransfersPairsTheTwoSidesOfAMove(t *testing.T) {
	rows := []Staged{
		staged("out", "chase", "2026-08-05", -100_000),
		staged("in", "hysa", "2026-08-06", 100_000),
	}

	pairs := MatchTransfers(rows, mapped)

	if pairs["out"] != "in" || pairs["in"] != "out" {
		t.Fatalf("pairs = %v; want out↔in", pairs)
	}
}

func TestMatchTransfersIgnoresUnmappedAccounts(t *testing.T) {
	// An account you haven't mapped isn't yours as far as the ledger knows,
	// so the movement is not an internal transfer.
	rows := []Staged{
		staged("out", "chase", "2026-08-05", -100_000),
		staged("in", "unmapped", "2026-08-05", 100_000),
	}

	if pairs := MatchTransfers(rows, mapped); len(pairs) != 0 {
		t.Errorf("pairs = %v; want none", pairs)
	}
}

func TestMatchTransfersWillNotPairWithinOneAccount(t *testing.T) {
	// Two offsetting amounts on the same account are a refund, not a transfer.
	rows := []Staged{
		staged("charge", "chase", "2026-08-05", -5_000),
		staged("refund", "chase", "2026-08-06", 5_000),
	}

	if pairs := MatchTransfers(rows, mapped); len(pairs) != 0 {
		t.Errorf("pairs = %v; want none", pairs)
	}
}

func TestMatchTransfersRequiresOppositeSigns(t *testing.T) {
	rows := []Staged{
		staged("a", "chase", "2026-08-05", -5_000),
		staged("b", "hysa", "2026-08-05", -5_000),
	}

	if pairs := MatchTransfers(rows, mapped); len(pairs) != 0 {
		t.Errorf("pairs = %v; want none — both sides lost money", pairs)
	}
}

func TestMatchTransfersRespectsTheDateWindow(t *testing.T) {
	within := []Staged{
		staged("out", "chase", "2026-08-01", -100_000),
		staged("in", "hysa", "2026-08-05", 100_000), // 4 days
	}
	if pairs := MatchTransfers(within, mapped); pairs["out"] != "in" {
		t.Error("4 days apart should pair")
	}

	outside := []Staged{
		staged("out", "chase", "2026-08-01", -100_000),
		staged("in", "hysa", "2026-08-06", 100_000), // 5 days
	}
	if pairs := MatchTransfers(outside, mapped); len(pairs) != 0 {
		t.Errorf("5 days apart should not pair, got %v", pairs)
	}
}

func TestMatchTransfersPairsEachRowOnlyOnce(t *testing.T) {
	// Two identical $500 moves out and one in: only one pair is real, and the
	// leftover has to stay unpaired rather than being double-claimed.
	rows := []Staged{
		staged("out1", "chase", "2026-08-05", -50_000),
		staged("out2", "chase", "2026-08-05", -50_000),
		staged("in1", "hysa", "2026-08-05", 50_000),
	}

	pairs := MatchTransfers(rows, mapped)

	if len(pairs) != 2 {
		t.Fatalf("pairs = %v; want exactly one pair (two entries)", pairs)
	}
	if pairs["in1"] == "" {
		t.Error("the single inbound row should be paired")
	}
	// Whichever outbound was claimed, the other must be free.
	claimed := pairs["in1"]
	other := "out1"
	if claimed == "out1" {
		other = "out2"
	}
	if pairs[other] != "" {
		t.Errorf("%s was double-claimed", other)
	}
}

func TestMatchTransfersHandlesACardPayment(t *testing.T) {
	// Paying a credit card: money leaves checking and reduces the debt. Both
	// sides are yours, so this must not read as income plus an expense.
	rows := []Staged{
		staged("pay-out", "chase", "2026-08-20", -25_000),
		staged("pay-in", "card", "2026-08-22", 25_000),
		staged("groceries", "chase", "2026-08-21", -6_000),
	}

	pairs := MatchTransfers(rows, mapped)

	if pairs["pay-out"] != "pay-in" {
		t.Errorf("card payment not matched: %v", pairs)
	}
	if pairs["groceries"] != "" {
		t.Error("real spending must not be matched as a transfer")
	}
}

func TestMatchTransfersIsDeterministic(t *testing.T) {
	rows := []Staged{
		staged("c", "hysa", "2026-08-05", 10_000),
		staged("a", "chase", "2026-08-05", -10_000),
		staged("b", "chase", "2026-08-05", -10_000),
	}

	first := MatchTransfers(rows, mapped)
	for i := 0; i < 5; i++ {
		again := MatchTransfers(rows, mapped)
		if len(again) != len(first) {
			t.Fatalf("run %d produced %v; want %v", i, again, first)
		}
		for k, v := range first {
			if again[k] != v {
				t.Fatalf("run %d: %s → %s; want %s", i, k, again[k], v)
			}
		}
	}
}

func TestMatchTransfersIgnoresUnparseableDates(t *testing.T) {
	rows := []Staged{
		staged("out", "chase", "not-a-date", -100_000),
		staged("in", "hysa", "2026-08-05", 100_000),
	}

	if pairs := MatchTransfers(rows, mapped); len(pairs) != 0 {
		t.Errorf("pairs = %v; a bad date must not look like a match", pairs)
	}
}

// ── proposals ────────────────────────────────────────────────────────────────

func TestProposeUsesWhatYouDidLastTime(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)
	payroll := account(t, conn, "Test Payroll", TypeIncome)

	entry(t, conn, "2026-08-02", "TRADER JOE'S #412", checking, groceries, 6_000)
	entry(t, conn, "2026-08-01", "ACME PAYROLL", payroll, checking, 300_000)

	rows := []Staged{
		{PlaidTxnID: "s1", Name: "TRADER JOE'S #998", AmountCents: -4_200},
		{PlaidTxnID: "s2", Name: "ACME PAYROLL", AmountCents: 300_000},
		{PlaidTxnID: "s3", Name: "SOMEWHERE NEW", AmountCents: -1_000},
	}

	got, err := ProposeCounterAccounts(conn, rows, map[string]string{})
	if err != nil {
		t.Fatalf("ProposeCounterAccounts: %v", err)
	}

	// Matched on a prefix, because bank descriptions carry trailing noise.
	if got["s1"] != groceries {
		t.Errorf("groceries proposal = %d; want %d", got["s1"], groceries)
	}
	if got["s2"] != payroll {
		t.Errorf("payroll proposal = %d; want %d", got["s2"], payroll)
	}
	// No precedent: propose nothing rather than guessing.
	if _, present := got["s3"]; present {
		t.Errorf("unfamiliar merchant got a proposal (%d); want none", got["s3"])
	}
}

func TestProposeSkipsMatchedTransfers(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	groceries := account(t, conn, "Test Groceries", TypeExpense)
	entry(t, conn, "2026-08-02", "MOVE", checking, groceries, 1_000)

	rows := []Staged{{PlaidTxnID: "s1", Name: "MOVE", AmountCents: -1_000}}
	pairs := map[string]string{"s1": "s2"}

	got, err := ProposeCounterAccounts(conn, rows, pairs)
	if err != nil {
		t.Fatalf("ProposeCounterAccounts: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v; a matched transfer already knows its other side", got)
	}
}

func TestProposeIgnoresAssetAccountsAsCounterparties(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)
	savings := account(t, conn, "Test Savings", TypeAsset)
	entry(t, conn, "2026-08-02", "SWEEP", checking, savings, 1_000)

	// The only precedent for "SWEEP" is asset → asset. Proposing an asset
	// account here would invent a transfer the matcher didn't find.
	rows := []Staged{{PlaidTxnID: "s1", Name: "SWEEP", AmountCents: -1_000}}
	got, err := ProposeCounterAccounts(conn, rows, map[string]string{})
	if err != nil {
		t.Fatalf("ProposeCounterAccounts: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v; want no proposal", got)
	}
}

func TestDescriptionPrefixStripsTheVaryingPart(t *testing.T) {
	cases := []struct{ in, want string }{
		// The store number is the part that changes between visits.
		{"TRADER JOE'S #412", "TRADER JOE'S"},
		{"SQ *CAFE 12345", "SQ *CAFE"},
		// Trailing punctuation goes too, so the order id can't anchor the match.
		{"AMZN Mktp US*2H4TZ", "AMZN Mktp US"},
		{"ACME PAYROLL", "ACME PAYROLL"},
		{"  SHELL OIL  ", "SHELL OIL"},
		// Leading digits leave nothing to trim, so match the whole string.
		{"7-ELEVEN 4021", "7-ELEVEN 4021"},
		// Multi-byte text must not be sliced apart.
		{"CAFÉ RENARD 88", "CAFÉ RENARD"},
		{"ab", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := descriptionPrefix(c.in); got != c.want {
			t.Errorf("descriptionPrefix(%q) = %q; want %q", c.in, got, c.want)
		}
	}
}

// ── sync modes ───────────────────────────────────────────────────────────────

func TestInvestmentAccountsDefaultToBalanceOnly(t *testing.T) {
	cases := []struct {
		accountType, subtype, want string
	}{
		{"depository", "checking", SyncTransactions},
		{"depository", "savings", SyncTransactions},
		{"credit", "credit card", SyncTransactions},
		{"investment", "brokerage", SyncBalance},
		{"investment", "401k", SyncBalance},
		{"investment", "hsa", SyncBalance},
		{"loan", "student", SyncBalance},
		{"", "401k", SyncBalance},
	}
	for _, c := range cases {
		if got := defaultSyncMode(c.accountType, c.subtype); got != c.want {
			t.Errorf("defaultSyncMode(%q, %q) = %q; want %q",
				c.accountType, c.subtype, got, c.want)
		}
	}
}

// ── staging ──────────────────────────────────────────────────────────────────

func TestStagingDoesNotResurrectReviewedRows(t *testing.T) {
	conn := newTestDB(t)

	rows := []Staged{staged("t1", "chase", "2026-08-05", -5_000)}
	if _, err := StageTransactions(conn, rows); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if err := MarkStaged(conn, []string{"t1"}, StagedIgnored, 0); err != nil {
		t.Fatalf("mark: %v", err)
	}

	// Plaid re-sends modified transactions. A row you already dismissed must
	// stay dismissed rather than reappearing in the queue.
	rows[0].AmountCents = -5_500
	if _, err := StageTransactions(conn, rows); err != nil {
		t.Fatalf("re-stage: %v", err)
	}

	queue, err := ListStaged(conn, StagedNew)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(queue) != 0 {
		t.Errorf("queue = %v; want empty", queue)
	}
}

func TestStagingUpdatesRowsStillAwaitingReview(t *testing.T) {
	conn := newTestDB(t)

	rows := []Staged{staged("t1", "chase", "2026-08-05", -5_000)}
	if _, err := StageTransactions(conn, rows); err != nil {
		t.Fatalf("stage: %v", err)
	}

	// A pending charge settling at a different amount should update in place.
	rows[0].AmountCents = -5_250
	if _, err := StageTransactions(conn, rows); err != nil {
		t.Fatalf("re-stage: %v", err)
	}

	queue, _ := ListStaged(conn, StagedNew)
	if len(queue) != 1 {
		t.Fatalf("queue = %d rows; want 1", len(queue))
	}
	if queue[0].AmountCents != -5_250 {
		t.Errorf("amount = %d; want -5250", queue[0].AmountCents)
	}
}

func TestRemoveStagedLeavesAcceptedRowsAlone(t *testing.T) {
	conn := newTestDB(t)

	if _, err := StageTransactions(conn, []Staged{
		staged("kept", "chase", "2026-08-05", -5_000),
		staged("dropped", "chase", "2026-08-06", -2_000),
	}); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if err := MarkStaged(conn, []string{"kept"}, StagedPosted, 42); err != nil {
		t.Fatalf("mark: %v", err)
	}

	if err := RemoveStaged(conn, []string{"kept", "dropped"}); err != nil {
		t.Fatalf("remove: %v", err)
	}

	posted, _ := ListStaged(conn, StagedPosted)
	if len(posted) != 1 || posted[0].TxnID != 42 {
		t.Errorf("posted = %v; an accepted row must survive a Plaid retraction", posted)
	}
	queue, _ := ListStaged(conn, StagedNew)
	if len(queue) != 0 {
		t.Errorf("queue = %v; want empty", queue)
	}
}

// ── credentials never leave the server ───────────────────────────────────────

func TestDumpOmitsAccessTokens(t *testing.T) {
	conn := newTestDB(t)

	if err := UpsertPlaidItem(conn, PlaidItem{
		ItemID:          "item-1",
		AccessToken:     "access-sandbox-SUPER-SECRET",
		InstitutionName: "Chase",
	}); err != nil {
		t.Fatalf("UpsertPlaidItem: %v", err)
	}

	var buf bytes.Buffer
	if err := Dump(conn, &buf); err != nil {
		t.Fatalf("Dump: %v", err)
	}
	out := buf.String()

	// This dump is pulled to a laptop nightly over HTTP and kept for 60 days.
	if strings.Contains(out, "access-sandbox-SUPER-SECRET") {
		t.Error("dump leaked a Plaid access token")
	}
	if strings.Contains(out, "INSERT INTO plaid_items") {
		t.Error("dump contained plaid_items rows")
	}
	if !strings.Contains(out, "plaid_items omitted") {
		t.Error("dump should say why plaid_items is missing")
	}
	// And it must still be a working dump of everything else.
	if !strings.Contains(out, `INSERT INTO "accounts"`) {
		t.Error("dump lost the accounts table")
	}
}

func TestDeletingAnItemKeepsEntriesYouAlreadyAccepted(t *testing.T) {
	conn := newTestDB(t)

	if err := UpsertPlaidItem(conn, PlaidItem{ItemID: "item-1", AccessToken: "tok"}); err != nil {
		t.Fatalf("UpsertPlaidItem: %v", err)
	}
	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: "chase", ItemID: "item-1", Type: "depository", Subtype: "checking",
	}); err != nil {
		t.Fatalf("UpsertPlaidAccount: %v", err)
	}
	if _, err := StageTransactions(conn, []Staged{
		staged("accepted", "chase", "2026-08-01", -1_000),
		staged("pending-review", "chase", "2026-08-02", -2_000),
	}); err != nil {
		t.Fatalf("stage: %v", err)
	}
	if err := MarkStaged(conn, []string{"accepted"}, StagedPosted, 7); err != nil {
		t.Fatalf("mark: %v", err)
	}

	if err := DeletePlaidItem(conn, "item-1"); err != nil {
		t.Fatalf("DeletePlaidItem: %v", err)
	}

	// Unlinking a bank must not retract bookkeeping you already accepted.
	posted, _ := ListStaged(conn, StagedPosted)
	if len(posted) != 1 {
		t.Errorf("posted rows = %d; want 1 kept after unlink", len(posted))
	}
	if n := countRows(t, conn, "plaid_items"); n != 0 {
		t.Errorf("plaid_items = %d; want 0", n)
	}
}

func TestRelinkingPreservesYourAccountMapping(t *testing.T) {
	conn := newTestDB(t)
	checking := account(t, conn, "Test Checking", TypeAsset)

	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: "chase", ItemID: "item-1", Name: "Chase Checking",
		Type: "depository", Subtype: "checking",
	}); err != nil {
		t.Fatalf("UpsertPlaidAccount: %v", err)
	}
	if err := MapPlaidAccount(conn, "chase", checking, SyncTransactions); err != nil {
		t.Fatalf("MapPlaidAccount: %v", err)
	}

	// Re-linking (say, after a login expiry) re-discovers the same account.
	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: "chase", ItemID: "item-1", Name: "Chase Checking ...1234",
		Type: "depository", Subtype: "checking",
	}); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}

	accounts, err := ListPlaidAccounts(conn)
	if err != nil {
		t.Fatalf("ListPlaidAccounts: %v", err)
	}
	if len(accounts) != 1 {
		t.Fatalf("accounts = %d; want 1", len(accounts))
	}
	if accounts[0].AccountID != checking {
		t.Errorf("mapping lost on re-link: account_id = %d; want %d",
			accounts[0].AccountID, checking)
	}
	if accounts[0].Name != "Chase Checking ...1234" {
		t.Errorf("name not refreshed: %q", accounts[0].Name)
	}
}

func TestMapPlaidAccountRejectsAnUnknownSyncMode(t *testing.T) {
	conn := newTestDB(t)
	if err := UpsertPlaidAccount(conn, PlaidAccount{
		PlaidAccountID: "chase", ItemID: "item-1",
	}); err != nil {
		t.Fatalf("UpsertPlaidAccount: %v", err)
	}
	if err := MapPlaidAccount(conn, "chase", 1, "whatever"); err == nil {
		t.Error("expected an error for an unknown sync mode")
	}
}
