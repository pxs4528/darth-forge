package handlers

import (
	"backend/internal/db"
	"backend/internal/logger"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// BudgetHandler serves the double-entry budgeting tool. Every route it exposes
// is wrapped in AdminOnly, so the whole thing is gated on ADMIN_SECRET.
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

func (h *BudgetHandler) ready(w http.ResponseWriter) bool {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable,
			"budget database unavailable — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
		return false
	}
	return true
}

func monthOf(date string) string {
	if len(date) < 7 {
		return ""
	}
	return date[:7]
}

// statusFor distinguishes "you can't do that" from "it isn't there". A locked
// entry exists — refusing it as a 404 would send you looking for the wrong bug.
func statusFor(err error) int {
	if errors.Is(err, db.ErrLocked) {
		return http.StatusConflict
	}
	return http.StatusNotFound
}

// GET /api/admin/budget/meta — account types, budget groups and defaults.
func (h *BudgetHandler) HandleMeta(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"account_types": []string{
			db.TypeAsset, db.TypeLiability, db.TypeIncome, db.TypeExpense, db.TypeEquity,
		},
		"budget_groups": db.BudgetGroups,
		"asset_classes": db.AssetClasses,
		"defaults": map[string]interface{}{
			"goal_cents":   db.DefaultGoalCents,
			"target_month": db.DefaultTargetMonth,
		},
	})
}

// GET /api/admin/budget/month?m=YYYY-MM — the whole month: accounts with
// balances, entries, budgets, goal and derived summary.
func (h *BudgetHandler) HandleMonth(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

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
		h.logger.Error("budget", "failed to load month", map[string]interface{}{
			"month": month, "error": err.Error(),
		})
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// GET  /api/admin/budget/accounts — list
// POST /api/admin/budget/accounts — create
// PUT  /api/admin/budget/accounts — update (id in body)
func (h *BudgetHandler) HandleAccounts(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		accounts, err := db.ListAccounts(h.conn)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"accounts": accounts})

	case http.MethodPost, http.MethodPut:
		var a db.Account
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		a.Name = strings.TrimSpace(a.Name)
		if a.Name == "" {
			writeErr(w, http.StatusBadRequest, "account name is required")
			return
		}
		if len(a.Name) > 60 {
			a.Name = a.Name[:60]
		}
		if !db.ValidAccountType(a.Type) {
			writeErr(w, http.StatusBadRequest,
				"type must be asset, liability, income, expense or equity")
			return
		}

		if r.Method == http.MethodPost {
			created, err := db.CreateAccount(h.conn, a)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, created)
			return
		}

		if a.ID == 0 {
			writeErr(w, http.StatusBadRequest, "id is required")
			return
		}
		if err := db.UpdateAccount(h.conn, a); err != nil {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, a)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// POST   /api/admin/budget/entries      — create
// PUT    /api/admin/budget/entries      — update (id in body)
// DELETE /api/admin/budget/entries?id=N — delete
func (h *BudgetHandler) HandleEntries(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}

	switch r.Method {
	case http.MethodPost, http.MethodPut:
		var e db.Entry
		if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}

		e.Description = strings.TrimSpace(e.Description)
		if e.Description == "" {
			writeErr(w, http.StatusBadRequest, "description is required")
			return
		}
		if len(e.Description) > 200 {
			e.Description = e.Description[:200]
		}
		if _, err := time.Parse("2006-01-02", e.Date); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid date, want YYYY-MM-DD")
			return
		}
		// The date is authoritative: editing a date moves the entry.
		e.Month = monthOf(e.Date)

		if err := db.ValidateSplits(e.Splits); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		for _, s := range e.Splits {
			ok, err := db.AccountExists(h.conn, s.AccountID)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			if !ok {
				writeErr(w, http.StatusBadRequest, "unknown account in split")
				return
			}
		}

		if r.Method == http.MethodPost {
			created, err := db.CreateEntry(h.conn, e)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, created)
			return
		}

		if e.ID == 0 {
			writeErr(w, http.StatusBadRequest, "id is required")
			return
		}
		if err := db.UpdateEntry(h.conn, e); err != nil {
			writeErr(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, e)

	case http.MethodDelete:
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "valid id query param is required")
			return
		}
		if err := db.DeleteEntry(h.conn, id); err != nil {
			writeErr(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})

	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// PUT /api/admin/budget/budgets — set one account's monthly target.
func (h *BudgetHandler) HandleBudgets(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Month       string `json:"month"`
		AccountID   int64  `json:"account_id"`
		AmountCents int64  `json:"amount_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if !db.ValidMonth(body.Month) {
		writeErr(w, http.StatusBadRequest, "invalid month, want YYYY-MM")
		return
	}
	if body.AmountCents < 0 {
		writeErr(w, http.StatusBadRequest, "budget must not be negative")
		return
	}
	if err := db.SetBudget(h.conn, body.Month, body.AccountID, body.AmountCents); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "saved"})
}

// PUT /api/admin/budget/goal — target amount and date.
func (h *BudgetHandler) HandleGoal(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var g db.Goal
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if g.GoalCents <= 0 {
		writeErr(w, http.StatusBadRequest, "goal must be positive")
		return
	}
	if !db.ValidMonth(g.TargetMonth) {
		writeErr(w, http.StatusBadRequest, "target_month must be YYYY-MM")
		return
	}
	if g.EmergencyMonths < 0 || g.EmergencyMonths > 60 {
		writeErr(w, http.StatusBadRequest, "emergency_months must be between 0 and 60")
		return
	}
	if err := db.SetGoal(h.conn, g); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

// GET /api/admin/budget/history?limit=24
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

// GET /api/admin/budget/register?account=N — one account's ledger.
func (h *BudgetHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, err := strconv.ParseInt(r.URL.Query().Get("account"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "valid account query param is required")
		return
	}
	rows, err := db.Register(h.conn, id, 200)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The row list is capped, so the cleared total has to come from the
	// database — summing the returned rows would quietly under-count an
	// account with a long history, which is the one number you can't get wrong.
	cleared, err := db.ClearedBalance(h.conn, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"rows":          rows,
		"cleared_cents": cleared,
	})
}

// GET /api/admin/budget/suggest?q=heb
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

// GET /api/admin/budget/dump — full SQL dump (session or backup token).
func (h *BudgetHandler) HandleDump(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	filename := "budget-" + time.Now().UTC().Format("2006-01-02") + ".sql"
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	if err := db.Dump(h.conn, w); err != nil {
		h.logger.Error("budget", "dump failed", map[string]interface{}{"error": err.Error()})
	}
}

// PUT /api/admin/budget/reconcile — move splits between reconcile states.
//
// Bodies:
//
//	{"split_ids": [1,2], "state": "c"}    tick / untick
//	{"account_id": 3, "action": "lock"}   end a statement you proved to zero
//	{"account_id": 3, "action": "unlock"} reopen one
func (h *BudgetHandler) HandleReconcile(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		SplitIDs  []int64 `json:"split_ids"`
		State     string  `json:"state"`
		AccountID int64   `json:"account_id"`
		Action    string  `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	switch body.Action {
	case "lock", "unlock":
		if body.AccountID <= 0 {
			writeErr(w, http.StatusBadRequest, "account_id is required to lock or unlock")
			return
		}
		var (
			n   int64
			err error
		)
		if body.Action == "lock" {
			n, err = db.LockCleared(h.conn, body.AccountID)
		} else {
			n, err = db.UnlockAccount(h.conn, body.AccountID)
		}
		if err != nil {
			h.logger.Error("budget", "reconcile "+body.Action+" failed",
				map[string]interface{}{"error": err.Error()})
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"changed": n})

	case "":
		if len(body.SplitIDs) == 0 {
			writeErr(w, http.StatusBadRequest, "split_ids is required")
			return
		}
		if !db.ValidReconcileState(body.State) {
			writeErr(w, http.StatusBadRequest, "state must be one of n, c, y")
			return
		}
		n, err := db.SetReconcileState(h.conn, body.SplitIDs, body.State)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"changed": n})

	default:
		writeErr(w, http.StatusBadRequest, "action must be lock, unlock, or omitted")
	}
}

// POST /api/admin/budget/reset — delete every entry, keeping the account
// catalog, budgets and goal. This is how you open a fresh book at a chosen
// date: wipe the entries, then record opening balances on your start date.
//
// Guarded by an exact confirmation phrase, because the only undo is the SQL
// dump you were told to take first.
func (h *BudgetHandler) HandleReset(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Confirm string `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if body.Confirm != ResetConfirmPhrase {
		writeErr(w, http.StatusBadRequest, "confirm must be exactly "+ResetConfirmPhrase)
		return
	}

	deleted, err := db.ResetLedger(h.conn)
	if err != nil {
		h.logger.Error("budget", "ledger reset failed",
			map[string]interface{}{"error": err.Error()})
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logger.Info("budget", "ledger reset", map[string]interface{}{"entries_deleted": deleted})
	writeJSON(w, http.StatusOK, map[string]interface{}{"entries_deleted": deleted})
}

// ResetConfirmPhrase must be typed exactly to wipe the ledger.
const ResetConfirmPhrase = "DELETE ALL ENTRIES"
