package db

// Category is one budget line item. The catalog below is the single source of
// truth: the frontend fetches it rather than hardcoding its own copy, and new
// months are seeded from DefaultCents when there is no prior month to copy.
type Category struct {
	Key          string `json:"key"`
	Label        string `json:"label"`
	Group        string `json:"group"`
	DefaultCents int64  `json:"default_cents"`
}

// Category group keys. The frontend maps these to colors.
const (
	GroupHousing       = "housing"
	GroupTransport     = "transport"
	GroupFood          = "food"
	GroupSubscriptions = "subscriptions"
	GroupSavings       = "savings"
	GroupInvestments   = "investments"
	GroupPersonal      = "personal"
	GroupMisc          = "misc"
)

// Categories is ordered for display. Order here drives order in the UI.
var Categories = []Category{
	{"rent", "Rent", GroupHousing, 112000},
	{"trash", "Trash / Recycling", GroupHousing, 1800},
	{"amenity", "Amenity Fee", GroupHousing, 1500},
	{"parking", "Parking", GroupHousing, 2500},
	{"boiler", "Boiler Management", GroupHousing, 900},
	{"sewer", "Sewer", GroupHousing, 800},
	{"water", "Water", GroupHousing, 600},
	{"gas_utility", "Gas Utility", GroupHousing, 500},
	{"utility_admin", "Utility Billing Admin", GroupHousing, 400},
	{"pest", "Pest Control / Other", GroupHousing, 300},

	{"car_payment", "Car Payment", GroupTransport, 82100},
	{"car_insurance", "Car Insurance", GroupTransport, 20000},
	{"gas", "Gas", GroupTransport, 12000},

	{"groceries", "Groceries", GroupFood, 30000},
	{"restaurants", "Restaurants / Takeout", GroupFood, 15000},

	{"phone", "Phone", GroupSubscriptions, 1700},
	{"streaming", "Streaming", GroupSubscriptions, 3000},
	{"other_subs", "Other Subscriptions", GroupSubscriptions, 2000},

	{"hysa", "HYSA", GroupSavings, 80000},

	{"index_fund", "Index Fund", GroupInvestments, 90000},

	{"clothing", "Clothing", GroupPersonal, 5000},
	{"personal_care", "Personal Care", GroupPersonal, 5000},
	{"entertainment", "Entertainment", GroupPersonal, 10000},

	{"misc", "One-off / Unexpected", GroupMisc, 10000},
}

// ValidCategory reports whether key exists in the catalog.
func ValidCategory(key string) bool {
	for _, c := range Categories {
		if c.Key == key {
			return true
		}
	}
	return false
}

// SavingsCategories are the categories that grow net worth rather than
// consuming it. Used for the savings-rate and "on track" calculations.
var SavingsCategories = []string{"hysa", "index_fund"}

// IsSavings reports whether a category contributes to net worth.
func IsSavings(key string) bool {
	for _, k := range SavingsCategories {
		if k == key {
			return true
		}
	}
	return false
}
