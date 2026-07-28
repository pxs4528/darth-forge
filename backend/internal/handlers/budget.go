package handlers

import (
	"backend/internal/db"
	"backend/internal/logger"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// BudgetHandler serves the personal budgeting tool. Every route it exposes is
// wrapped in AdminOnly, so the whole thing is gated on ADMIN_SECRET.
type BudgetHandler struct {
	logger *logger.Logger
	conn   *sql.DB // nil when Turso is unconfigured; routes then return 503
}

func NewBudgetHandler(log *logger.Logger, conn *sql.DB) *BudgetHandler {
	return &BudgetHandler{logger: log, conn: conn}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ready guards every handler against a missing database connection.
func (h *BudgetHandler) ready(w http.ResponseWriter) bool {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable,
			"budget database unavailable — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
		return false
	}
	return true
}

// monthOf derives "YYYY-MM" from a "YYYY-MM-DD" date.
func monthOf(date string) string {
	if len(date) < 7 {
		return ""
	}
	return date[:7]
}

// GET /api/admin/budget/categories — the category catalog plus seed defaults.
func (h *BudgetHandler) HandleCategories(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"categories": db.Categories,
		"defaults": map[string]int64{
			"income_cents":                db.DefaultIncomeCents,
			"three_paycheck_income_cents": db.DefaultThreePayCents,
			"match_401k_cents":            db.DefaultMatch401kCents,
			"goal_cents":                  db.DefaultGoalCents,
		},
	})
}

// GET /api/admin/budget/month?m=YYYY-MM — full state for one month.
// PUT /api/admin/budget/month — update income / paycheck count / 401k match.
func (h *BudgetHandler) HandleMonth(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		month := r.URL.Query().Get("m")
		if month == "" {
			month = time.Now().Format("2006-01")
		}
		if !db.ValidMonth(month) {
			writeErr(w, http.StatusBadRequest, "invalid month, want YYYY-MM")
			return
		}
		state, err := db.GetMonth(h.conn, month)
		if err != nil {
			h.logger.Error("budget", "failed to load month", map[string]interface{}{"month": month, "error": err.Error()})
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, state)

	case http.MethodPut:
		var body struct {
			Month          string `json:"month"`
			IncomeCents    int64  `json:"income_cents"`
			ThreePaycheck  bool   `json:"three_paycheck"`
			Match401kCents int64  `json:"match_401k_cents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if !db.ValidMonth(body.Month) {
			writeErr(w, http.StatusBadRequest, "invalid month, want YYYY-MM")
			return
		}
		if body.IncomeCents < 0 || body.Match401kCents < 0 {
			writeErr(w, http.StatusBadRequest, "amounts must not be negative")
			return
		}
		if err := db.UpdateMonth(h.conn, body.Month, body.IncomeCents, body.ThreePaycheck, body.Match401kCents); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "saved"})

	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// PUT /api/admin/budget/budgets — upsert this month's category targets.
func (h *BudgetHandler) HandleBudgets(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Month   string           `json:"month"`
		Budgets map[string]int64 `json:"budgets"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if !db.ValidMonth(body.Month) {
		writeErr(w, http.StatusBadRequest, "invalid month, want YYYY-MM")
		return
	}
	for cat, cents := range body.Budgets {
		if !db.ValidCategory(cat) {
			writeErr(w, http.StatusBadRequest, "unknown category: "+cat)
			return
		}
		if cents < 0 {
			writeErr(w, http.StatusBadRequest, "budget for "+cat+" must not be negative")
			return
		}
	}
	if err := db.SetBudgets(h.conn, body.Month, body.Budgets); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "saved"})
}

// PUT /api/admin/budget/networth — upsert the $100k tracker snapshot.
func (h *BudgetHandler) HandleNetWorth(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var nw db.NetWorth
	if err := json.NewDecoder(r.Body).Decode(&nw); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if !db.ValidMonth(nw.Month) {
		writeErr(w, http.StatusBadRequest, "invalid month, want YYYY-MM")
		return
	}
	if nw.MonthsRemaining < 1 {
		nw.MonthsRemaining = 1
	}
	if nw.GoalCents <= 0 {
		nw.GoalCents = db.DefaultGoalCents
	}
	if err := db.SetNetWorth(h.conn, nw); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "saved"})
}

// POST   /api/admin/budget/transactions      — create
// PUT    /api/admin/budget/transactions      — update (id in body)
// DELETE /api/admin/budget/transactions?id=N — delete
func (h *BudgetHandler) HandleTransactions(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}

	switch r.Method {
	case http.MethodPost, http.MethodPut:
		var t db.Transaction
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}

		t.Description = strings.TrimSpace(t.Description)
		if t.Description == "" {
			writeErr(w, http.StatusBadRequest, "description is required")
			return
		}
		if len(t.Description) > 200 {
			t.Description = t.Description[:200]
		}
		if _, err := time.Parse("2006-01-02", t.Date); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid date, want YYYY-MM-DD")
			return
		}
		if !db.ValidCategory(t.Category) {
			writeErr(w, http.StatusBadRequest, "unknown category: "+t.Category)
			return
		}
		if t.AmountCents == 0 {
			writeErr(w, http.StatusBadRequest, "amount must not be zero")
			return
		}
		// The date is authoritative: editing a date moves the transaction.
		t.Month = monthOf(t.Date)

		if r.Method == http.MethodPost {
			created, err := db.CreateTransaction(h.conn, t)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, created)
			return
		}

		if t.ID == 0 {
			writeErr(w, http.StatusBadRequest, "id is required")
			return
		}
		if err := db.UpdateTransaction(h.conn, t); err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, t)

	case http.MethodDelete:
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "valid id query param is required")
			return
		}
		if err := db.DeleteTransaction(h.conn, id); err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})

	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// GET /api/admin/budget/history?limit=24 — monthly rollups for the charts.
func (h *BudgetHandler) HandleHistory(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	limit := 24
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	points, err := db.History(h.conn, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"history": points})
}

// GET /api/admin/budget/suggest?q=heb — past descriptions and their usual category.
func (h *BudgetHandler) HandleSuggest(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	suggestions, err := db.Suggest(h.conn, r.URL.Query().Get("q"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"suggestions": suggestions})
}
