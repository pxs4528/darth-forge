package db

import "testing"

func TestValidateSplits(t *testing.T) {
	cases := []struct {
		name    string
		splits  []Split
		wantErr bool
	}{
		{
			name:   "a balanced two-sided entry is valid",
			splits: []Split{{AccountID: 1, AmountCents: -5000}, {AccountID: 2, AmountCents: 5000}},
		},
		{
			name: "a balanced three-way split is valid",
			splits: []Split{
				{AccountID: 1, AmountCents: -10000},
				{AccountID: 2, AmountCents: 6000},
				{AccountID: 3, AmountCents: 4000},
			},
		},
		{
			name:    "one-sided entries are rejected",
			splits:  []Split{{AccountID: 1, AmountCents: 5000}},
			wantErr: true,
		},
		{
			name:    "unbalanced entries are rejected",
			splits:  []Split{{AccountID: 1, AmountCents: -5000}, {AccountID: 2, AmountCents: 4900}},
			wantErr: true,
		},
		{
			name:    "a split without an account is rejected",
			splits:  []Split{{AccountID: 0, AmountCents: -5000}, {AccountID: 2, AmountCents: 5000}},
			wantErr: true,
		},
		{
			name:    "no splits at all is rejected",
			splits:  []Split{},
			wantErr: true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateSplits(c.splits)
			if c.wantErr && err == nil {
				t.Fatal("want error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("want no error, got %v", err)
			}
		})
	}
}

// acct is a terse constructor for summarize's input.
func acct(kind string, balance, change int64) AccountBalance {
	return AccountBalance{
		Account:      Account{Type: kind},
		BalanceCents: balance,
		ChangeCents:  change,
	}
}

func TestSummarize(t *testing.T) {
	goal := Goal{GoalCents: 10000000, TargetMonth: "2026-09"}

	// A month where $5,751.84 came in, $1,570 went out, and the difference
	// is sitting across checking and savings. Liabilities carry credits.
	accounts := []AccountBalance{
		acct(TypeIncome, -575184, -575184),
		acct(TypeExpense, 157000, 157000),
		acct(TypeAsset, 500000, 418184),
		acct(TypeLiability, -20000, -20000),
	}

	// earned excludes opening-balance entries; here everything was earned.
	s := summarize(accounts, goal, "2026-07", 418184-20000)

	if s.IncomeCents != 575184 {
		t.Errorf("income = %d, want 575184 (income credits flipped for display)", s.IncomeCents)
	}
	if s.ExpenseCents != 157000 {
		t.Errorf("expense = %d, want 157000", s.ExpenseCents)
	}
	if s.SurplusCents != 575184-157000 {
		t.Errorf("surplus = %d, want %d", s.SurplusCents, 575184-157000)
	}
	// Net worth subtracts debt without any special-casing: the liability
	// balance is already negative.
	if s.NetWorthCents != 500000-20000 {
		t.Errorf("net worth = %d, want %d", s.NetWorthCents, 500000-20000)
	}
	if s.NetWorthChange != 418184-20000 {
		t.Errorf("net worth change = %d, want %d", s.NetWorthChange, 418184-20000)
	}
	if s.MonthsRemaining != 2 {
		t.Errorf("months remaining = %d, want 2 (2026-07 → 2026-09)", s.MonthsRemaining)
	}
	wantTarget := (goal.GoalCents - s.NetWorthCents) / 2
	if s.TargetMonthlyCents != wantTarget {
		t.Errorf("target = %d, want %d", s.TargetMonthlyCents, wantTarget)
	}
}

func TestSummarizeAtOrPastTarget(t *testing.T) {
	// Past the target date: no negative or divide-by-zero target.
	s := summarize([]AccountBalance{acct(TypeAsset, 100, 0)},
		Goal{GoalCents: 10000000, TargetMonth: "2026-01"}, "2026-07", 0)
	if s.MonthsRemaining != 0 {
		t.Errorf("months remaining = %d, want 0 when the target month has passed", s.MonthsRemaining)
	}
	if s.TargetMonthlyCents != 0 {
		t.Errorf("target = %d, want 0 when no months remain", s.TargetMonthlyCents)
	}

	// Goal already met: nothing more needed per month.
	s = summarize([]AccountBalance{acct(TypeAsset, 20000000, 0)},
		Goal{GoalCents: 10000000, TargetMonth: "2029-07"}, "2026-07", 0)
	if s.TargetMonthlyCents != 0 {
		t.Errorf("target = %d, want 0 once the goal is exceeded", s.TargetMonthlyCents)
	}
}

// An opening balance must land in the net worth TOTAL but not in the monthly
// change — otherwise the first month of any account reads as a huge windfall
// and the pace calculation is nonsense. This mirrors the real July data:
// $50,361.05 of opening balances against a $2,377.77 operating shortfall.
func TestSummarizeExcludesOpeningBalancesFromChange(t *testing.T) {
	accounts := []AccountBalance{
		acct(TypeIncome, -695184, -695184),
		acct(TypeExpense, 932961, 932961),
		// Assets hold the opening balances plus the month's activity.
		acct(TypeAsset, 5036105-237777, 5036105-237777),
	}
	earned := int64(-237777) // income 695184 - expense 932961

	s := summarize(accounts, Goal{GoalCents: 10000000, TargetMonth: "2028-10"}, "2026-07", earned)

	if s.NetWorthCents != 5036105-237777 {
		t.Errorf("net worth total = %d, want %d — opening balances ARE real money",
			s.NetWorthCents, 5036105-237777)
	}
	if s.NetWorthChange != -237777 {
		t.Errorf("net worth change = %d, want -237777 — opening balances are not earnings",
			s.NetWorthChange)
	}
	// With equity excluded the change equals the surplus, since the only other
	// things moving net worth are income and expenses.
	if s.NetWorthChange != s.SurplusCents {
		t.Errorf("change %d should equal surplus %d once equity is excluded",
			s.NetWorthChange, s.SurplusCents)
	}
}

func TestMonthsBetween(t *testing.T) {
	cases := []struct {
		from, to string
		want     int64
	}{
		{"2026-07", "2029-07", 36},
		{"2026-07", "2026-08", 1},
		{"2026-07", "2026-07", 0},
		{"2026-12", "2027-01", 1},
		{"2026-07", "2026-01", 0}, // past dates floor at zero
		{"garbage", "2026-07", 0},
	}
	for _, c := range cases {
		if got := MonthsBetween(c.from, c.to); got != c.want {
			t.Errorf("MonthsBetween(%q, %q) = %d, want %d", c.from, c.to, got, c.want)
		}
	}
}
