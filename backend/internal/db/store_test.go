package db

import "testing"

func TestComputeBalance(t *testing.T) {
	cases := []struct {
		name                                                  string
		kind                                                  string
		starting, charged, transfersIn, transfersOut, wantBal int64
	}{
		{
			name: "checking: a plain expense reduces cash",
			kind: "checking", starting: 10000, charged: 3000,
			wantBal: 7000, // $100 -> $70 after a $30 charge
		},
		{
			name: "checking: paying down a card is money leaving checking",
			kind: "checking", starting: 10000, transfersOut: 4000,
			wantBal: 6000,
		},
		{
			name: "savings: a transfer in is a deposit",
			kind: "savings", starting: 5000, transfersIn: 2000,
			wantBal: 7000,
		},
		{
			name: "checking: charge plus deposit plus withdrawal all combine",
			kind: "checking", starting: 10000, charged: 3000, transfersIn: 500, transfersOut: 200,
			wantBal: 7300, // 10000 - 3000 + 500 - 200
		},
		{
			name: "credit: a charge increases what's owed",
			kind: "credit", starting: 0, charged: 5000,
			wantBal: 5000, // now owe $50
		},
		{
			name: "credit: a payment (transfer in) reduces what's owed",
			kind: "credit", starting: 5000, transfersIn: 2000,
			wantBal: 3000, // paid down $20 of a $50 balance
		},
		{
			name: "credit: a transfer out (e.g. cash advance) increases debt",
			kind: "credit", starting: 5000, transfersOut: 1000,
			wantBal: 6000,
		},
		{
			name: "credit: charges and a payment combine",
			kind: "credit", starting: 0, charged: 12000, transfersIn: 5000,
			wantBal: 7000, // charged $120, paid $50, owe $70
		},
		{
			name: "investment: unrecognized-as-credit kinds behave like cash",
			kind: "investment", starting: 100000, transfersIn: 90000,
			wantBal: 190000,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := computeBalance(c.kind, c.starting, c.charged, c.transfersIn, c.transfersOut)
			if got != c.wantBal {
				t.Errorf("computeBalance(%q, %d, %d, %d, %d) = %d, want %d",
					c.kind, c.starting, c.charged, c.transfersIn, c.transfersOut, got, c.wantBal)
			}
		})
	}
}
