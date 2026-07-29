package db

import (
	"database/sql"
	"fmt"
)

// Account types. These drive the sign conventions documented on the schema.
const (
	TypeAsset     = "asset"
	TypeLiability = "liability"
	TypeIncome    = "income"
	TypeExpense   = "expense"
	TypeEquity    = "equity"
)

// ValidAccountType reports whether t is a known account type.
func ValidAccountType(t string) bool {
	switch t {
	case TypeAsset, TypeLiability, TypeIncome, TypeExpense, TypeEquity:
		return true
	}
	return false
}

// Budget groups organise expense accounts for display. Purely cosmetic.
var BudgetGroups = []string{
	"housing", "transport", "food", "subscriptions",
	"savings", "personal", "misc",
}

// Defaults used the first time the database is created.
const (
	DefaultGoalCents   int64 = 10000000 // $100,000
	DefaultTargetMonth       = "2029-07"
	// OpeningBalancesAccount is the equity account every starting balance is
	// booked against, so the very first entry for an account still balances.
	OpeningBalancesAccount = "Opening Balances"
)

type seedAccount struct {
	name        string
	accountType string
	subtype     string
	budgetGroup string
}

// seedCatalog is only applied to a brand-new database. Everything here is
// editable in the UI afterwards — it exists so the tool is usable on day one
// rather than presenting an empty screen.
var seedCatalog = []seedAccount{
	// Where money sits.
	{"Checking", TypeAsset, "checking", ""},
	{"HYSA", TypeAsset, "savings", ""},
	{"Brokerage", TypeAsset, "investment", ""},
	{"401k", TypeAsset, "retirement", ""},

	// What you owe. Charges make these more negative; payments bring them
	// back toward zero.
	{"Discover Credit", TypeLiability, "credit", ""},
	{"Chase Credit", TypeLiability, "credit", ""},

	// Where money comes from.
	{"Paycheck", TypeIncome, "", ""},
	{"401k Match", TypeIncome, "", ""},
	{"Reimbursement", TypeIncome, "", ""},
	{"Other Income", TypeIncome, "", ""},

	// Where money goes.
	{"Rent", TypeExpense, "", "housing"},
	{"Trash / Recycling", TypeExpense, "", "housing"},
	{"Amenity Fee", TypeExpense, "", "housing"},
	{"Parking", TypeExpense, "", "housing"},
	{"Boiler Management", TypeExpense, "", "housing"},
	{"Sewer", TypeExpense, "", "housing"},
	{"Water", TypeExpense, "", "housing"},
	{"Gas Utility", TypeExpense, "", "housing"},
	{"Utility Billing Admin", TypeExpense, "", "housing"},
	{"Pest Control / Other", TypeExpense, "", "housing"},

	{"Car Payment", TypeExpense, "", "transport"},
	{"Car Insurance", TypeExpense, "", "transport"},
	{"Gas", TypeExpense, "", "transport"},

	{"Groceries", TypeExpense, "", "food"},
	{"Restaurants / Takeout", TypeExpense, "", "food"},

	{"Phone", TypeExpense, "", "subscriptions"},
	{"Streaming", TypeExpense, "", "subscriptions"},
	{"Other Subscriptions", TypeExpense, "", "subscriptions"},

	{"Clothing", TypeExpense, "", "personal"},
	{"Personal Care", TypeExpense, "", "personal"},
	{"Entertainment", TypeExpense, "", "personal"},

	{"One-off / Unexpected", TypeExpense, "", "misc"},

	// Balancing account for opening balances.
	{OpeningBalancesAccount, TypeEquity, "", ""},
}

// seedBudgets are the starting monthly targets, by account name. Contributions
// to savings and investments are no longer "expenses" under double-entry —
// they're transfers between your own accounts — so they don't appear here.
var seedBudgets = map[string]int64{
	"Rent":                  112000,
	"Trash / Recycling":     1800,
	"Amenity Fee":           1500,
	"Parking":               2500,
	"Boiler Management":     900,
	"Sewer":                 800,
	"Water":                 600,
	"Gas Utility":           500,
	"Utility Billing Admin": 400,
	"Pest Control / Other":  300,
	"Car Payment":           82100,
	"Car Insurance":         20000,
	"Gas":                   12000,
	"Groceries":             30000,
	"Restaurants / Takeout": 15000,
	"Phone":                 1700,
	"Streaming":             3000,
	"Other Subscriptions":   2000,
	"Clothing":              5000,
	"Personal Care":         5000,
	"Entertainment":         10000,
	"One-off / Unexpected":  10000,
}

// seedAccounts populates a brand-new database. Existing databases are left
// alone entirely — this only runs when the accounts table is empty.
func seedAccounts(conn *sql.DB) error {
	var count int64
	if err := conn.QueryRow(`SELECT COUNT(*) FROM accounts`).Scan(&count); err != nil {
		return fmt.Errorf("count accounts: %w", err)
	}
	if count > 0 {
		return nil
	}

	for i, a := range seedCatalog {
		if _, err := conn.Exec(
			`INSERT INTO accounts (name, type, subtype, budget_group, sort)
			 VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING`,
			a.name, a.accountType, a.subtype, a.budgetGroup, i,
		); err != nil {
			return fmt.Errorf("seed account %s: %w", a.name, err)
		}
	}
	return nil
}

// SeedBudgetsForMonth fills in default targets the first time a month is
// opened and there is no earlier month to copy from.
func SeedBudgetsForMonth(conn *sql.DB, month string) error {
	for name, cents := range seedBudgets {
		if _, err := conn.Exec(
			`INSERT INTO budgets (month, account_id, amount_cents)
			 SELECT ?, id, ? FROM accounts WHERE name = ?
			 ON CONFLICT (month, account_id) DO NOTHING`,
			month, cents, name,
		); err != nil {
			return fmt.Errorf("seed budget %s: %w", name, err)
		}
	}
	return nil
}
