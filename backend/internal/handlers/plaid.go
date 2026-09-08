package handlers

import (
	"backend/internal/db"
	"backend/internal/logger"
	"backend/internal/plaid"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

// Plaid routes: linking institutions, syncing, and the review queue.
//
// Nothing here writes to the ledger on its own. A sync pulls the bank's view
// into a staging table and proposes how each row should post; a human accepts
// it. That boundary is the point — a bank feed only ever tells you one side of
// a transaction, and letting it guess the other silently is how imported books
// go wrong.

type PlaidHandler struct {
	logger *logger.Logger
	conn   *sql.DB
	client *plaid.Client
	// importStart is a YYYY-MM-DD floor on imported transactions, or "" for no
	// floor. Plaid's first sync backfills up to 24 months, which for a book
	// opened part-way through the year is hundreds of rows that are already
	// inside the opening balances — importing them would double-count and bury
	// the rows actually worth reviewing.
	importStart string
}

func NewPlaidHandler(log *logger.Logger, conn *sql.DB, client *plaid.Client) *PlaidHandler {
	h := &PlaidHandler{logger: log, conn: conn, client: client}

	if v := strings.TrimSpace(os.Getenv("PLAID_IMPORT_START")); v != "" {
		// Fail open on a malformed date: importing too much is a nuisance,
		// importing nothing looks like a broken sync and would be chased for
		// hours before anyone suspected a typo in an env var.
		if _, err := time.Parse("2006-01-02", v); err != nil {
			log.Error("plaid", "PLAID_IMPORT_START is not a YYYY-MM-DD date, ignoring", map[string]interface{}{
				"value": v, "error": err.Error(),
			})
		} else {
			h.importStart = v
			log.Info("plaid", "skipping imported transactions before start date", map[string]interface{}{
				"import_start": v,
			})
		}
	}

	return h
}

// ready reports 503 rather than 500 when Plaid or Turso is unconfigured, so a
// site running without either still boots and says why.
func (h *PlaidHandler) ready(w http.ResponseWriter) bool {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable,
			"budget database unavailable — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
		return false
	}
	if h.client == nil {
		writeErr(w, http.StatusServiceUnavailable,
			"Plaid is not configured — set PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV")
		return false
	}
	return true
}

// plaidStatus reports an API failure with the right HTTP code: a stale login
// is the user's to fix, not a server fault.
func plaidStatus(err error) int {
	var apiErr *plaid.Error
	if errors.As(err, &apiErr) {
		if apiErr.NeedsRelink() {
			return http.StatusConflict
		}
		return http.StatusBadGateway
	}
	return http.StatusInternalServerError
}

// GET /api/admin/budget/plaid/status — what's linked and how it maps.
func (h *PlaidHandler) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "budget database unavailable")
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Reported rather than 503'd: the UI needs to explain the setup step.
	if h.client == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"configured": false,
			"items":      []db.PlaidItem{},
			"accounts":   []db.PlaidAccount{},
		})
		return
	}

	items, err := db.ListPlaidItems(h.conn)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	accounts, err := db.ListPlaidAccounts(h.conn)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"configured":   true,
		"env":          h.client.Env(),
		"import_start": h.importStart,
		"items":        items,
		"accounts":     accounts,
	})
}

// POST /api/admin/budget/plaid/link-token — mint a token to open Plaid Link.
// With item_id, opens in update mode to repair an expired login rather than
// creating a second item for the same bank.
func (h *PlaidHandler) HandleLinkToken(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		ItemID string `json:"item_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()
	var (
		token string
		err   error
	)
	if body.ItemID != "" {
		item, getErr := db.GetPlaidItem(h.conn, body.ItemID)
		if getErr != nil {
			writeErr(w, http.StatusNotFound, getErr.Error())
			return
		}
		token, err = h.client.CreateUpdateLinkToken(ctx, plaidUserID, item.AccessToken)
	} else {
		token, err = h.client.CreateLinkToken(ctx, plaidUserID, []string{"transactions"})
	}
	if err != nil {
		h.logger.Error("plaid", "link token failed", map[string]interface{}{"error": err.Error()})
		writeErr(w, plaidStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"link_token": token})
}

// plaidUserID identifies the end user to Plaid. This is a single-user tool, so
// it's a constant rather than anything derived from personal data.
const plaidUserID = "darth-forge-admin"

// POST /api/admin/budget/plaid/exchange — turn Link's public token into a
// stored item, then discover its accounts.
func (h *PlaidHandler) HandleExchange(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		PublicToken string `json:"public_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(body.PublicToken) == "" {
		writeErr(w, http.StatusBadRequest, "public_token is required")
		return
	}

	ctx := r.Context()
	accessToken, itemID, err := h.client.ExchangePublicToken(ctx, body.PublicToken)
	if err != nil {
		h.logger.Error("plaid", "token exchange failed", map[string]interface{}{"error": err.Error()})
		writeErr(w, plaidStatus(err), err.Error())
		return
	}

	institutionID, institutionName := h.client.InstitutionName(ctx, accessToken)
	if err := db.UpsertPlaidItem(h.conn, db.PlaidItem{
		ItemID:          itemID,
		AccessToken:     accessToken,
		InstitutionID:   institutionID,
		InstitutionName: institutionName,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Discover the accounts so they can be mapped straight away.
	accounts, err := h.client.Balances(ctx, accessToken)
	if err != nil {
		// The item is saved; account discovery can be retried by syncing.
		h.logger.Error("plaid", "account discovery failed", map[string]interface{}{
			"item_id": itemID, "error": err.Error(),
		})
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"item_id": itemID, "institution": institutionName, "accounts": 0,
		})
		return
	}
	for _, a := range accounts {
		if err := db.UpsertPlaidAccount(h.conn, db.PlaidAccount{
			PlaidAccountID: a.AccountID,
			ItemID:         itemID,
			Name:           accountLabel(a),
			Mask:           a.Mask,
			Type:           a.Type,
			Subtype:        a.Subtype,
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	h.logger.Info("plaid", "linked institution", map[string]interface{}{
		"item_id": itemID, "institution": institutionName, "accounts": len(accounts),
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"item_id": itemID, "institution": institutionName, "accounts": len(accounts),
	})
}

// accountLabel prefers the official name, falling back to the short one, and
// appends the mask so two "Savings" accounts are tellable apart.
func accountLabel(a plaid.Account) string {
	name := a.OfficialName
	if name == "" {
		name = a.Name
	}
	if a.Mask != "" {
		name += " ••" + a.Mask
	}
	return name
}

// PUT /api/admin/budget/plaid/accounts — map a Plaid account onto one of ours.
func (h *PlaidHandler) HandleMapAccount(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		PlaidAccountID string `json:"plaid_account_id"`
		AccountID      int64  `json:"account_id"`
		SyncMode       string `json:"sync_mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if body.PlaidAccountID == "" {
		writeErr(w, http.StatusBadRequest, "plaid_account_id is required")
		return
	}
	if body.AccountID != 0 {
		ok, err := db.AccountExists(h.conn, body.AccountID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeErr(w, http.StatusBadRequest, "unknown account")
			return
		}
	}
	if err := db.MapPlaidAccount(h.conn, body.PlaidAccountID, body.AccountID, body.SyncMode); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "mapped"})
}

// DELETE /api/admin/budget/plaid/items?item_id=… — unlink an institution.
func (h *PlaidHandler) HandleDeleteItem(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodDelete {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	itemID := r.URL.Query().Get("item_id")
	if itemID == "" {
		writeErr(w, http.StatusBadRequest, "item_id is required")
		return
	}
	if err := db.DeletePlaidItem(h.conn, itemID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "unlinked"})
}

// ── sync ─────────────────────────────────────────────────────────────────────

// maxSyncPages caps a single sync. /transactions/sync pages 500 at a time, so
// this is 50k transactions — far past a real backfill, and a guard against an
// unmoving cursor spinning forever.
const maxSyncPages = 100

// POST /api/admin/budget/plaid/sync — pull every linked institution.
func (h *PlaidHandler) HandleSync(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	items, err := db.ListPlaidItems(h.conn)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	accounts, err := db.ListPlaidAccounts(h.conn)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Plaid account → how it syncs and what it maps onto.
	mode := map[string]string{}
	ledger := map[string]int64{}
	for _, a := range accounts {
		mode[a.PlaidAccountID] = a.SyncMode
		if a.AccountID != 0 {
			ledger[a.PlaidAccountID] = a.AccountID
		}
	}

	ctx := r.Context()
	result := syncReport{Problems: []string{}}

	for _, item := range items {
		h.syncItem(ctx, item, mode, ledger, &result)
	}

	// Proposals run across everything staged, not just this pull: a transfer's
	// two sides can arrive on different days.
	staged, err := db.ListStaged(h.conn, db.StagedNew)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	pairs := db.MatchTransfers(staged, ledger)
	proposals, err := db.ProposeCounterAccounts(h.conn, staged, pairs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, s := range staged {
		if err := db.SetStagedProposal(
			h.conn, s.PlaidTxnID, proposals[s.PlaidTxnID], pairs[s.PlaidTxnID]); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	result.Queued = len(staged)
	result.Transfers = len(pairs) / 2
	h.logger.Info("plaid", "sync complete", map[string]interface{}{
		"imported": result.Imported, "queued": result.Queued,
		"transfers": result.Transfers, "skipped": result.Skipped,
		"problems": len(result.Problems),
	})
	writeJSON(w, http.StatusOK, result)
}

type syncReport struct {
	Imported  int      `json:"imported"`  // new rows added to the queue
	Queued    int      `json:"queued"`    // total awaiting review
	Transfers int      `json:"transfers"` // matched internal transfers
	Balances  int      `json:"balances"`  // balance-synced accounts updated
	Skipped   int      `json:"skipped"`   // dropped as older than PLAID_IMPORT_START
	Problems  []string `json:"problems"`
}

// syncItem pulls one institution. Failures are collected rather than fatal:
// one bank needing a re-login shouldn't stop the other six from syncing.
func (h *PlaidHandler) syncItem(
	ctx context.Context,
	item db.PlaidItem,
	mode map[string]string,
	ledger map[string]int64,
	out *syncReport,
) {
	label := item.InstitutionName
	if label == "" {
		label = item.ItemID
	}

	// Transactions, page by page.
	cursor := item.Cursor
	for page := 0; page < maxSyncPages; page++ {
		res, err := h.client.Sync(ctx, item.AccessToken, cursor)
		if err != nil {
			h.noteProblem(item, label, err, out)
			return
		}

		staged := make([]db.Staged, 0, len(res.Added)+len(res.Modified))
		for _, t := range append(res.Added, res.Modified...) {
			// Only accounts you've mapped and set to import transactions.
			if mode[t.AccountID] != db.SyncTransactions || ledger[t.AccountID] == 0 {
				continue
			}
			// Dates are YYYY-MM-DD, so lexical order is chronological order.
			// The cursor still advances past these, so they're skipped once
			// rather than re-offered on every sync.
			if h.importStart != "" && t.Date < h.importStart {
				out.Skipped++
				continue
			}
			staged = append(staged, db.Staged{
				PlaidTxnID:     t.TransactionID,
				PlaidAccountID: t.AccountID,
				Date:           t.Date,
				Name:           t.Name,
				Merchant:       t.Merchant,
				Category:       t.Category,
				AmountCents:    t.AmountCents,
				Pending:        t.Pending,
			})
		}
		added, err := db.StageTransactions(h.conn, staged)
		if err != nil {
			out.Problems = append(out.Problems, label+": "+err.Error())
			return
		}
		out.Imported += int(added)

		if err := db.RemoveStaged(h.conn, res.Removed); err != nil {
			out.Problems = append(out.Problems, label+": "+err.Error())
			return
		}

		cursor = res.Cursor
		if err := db.SetPlaidCursor(h.conn, item.ItemID, cursor); err != nil {
			out.Problems = append(out.Problems, label+": "+err.Error())
			return
		}
		if !res.HasMore {
			break
		}
	}

	// Balances: the whole sync for investment and retirement accounts.
	balances, err := h.client.Balances(ctx, item.AccessToken)
	if err != nil {
		h.noteProblem(item, label, err, out)
		return
	}
	today := time.Now().Format("2006-01-02")
	for _, a := range balances {
		if err := db.SetPlaidBalance(h.conn, a.AccountID, a.BalanceCents, today); err != nil {
			out.Problems = append(out.Problems, label+": "+err.Error())
			continue
		}
		if mode[a.AccountID] != db.SyncBalance || ledger[a.AccountID] == 0 {
			continue
		}
		if _, err := db.ApplyBalance(h.conn, ledger[a.AccountID], a.BalanceCents, today); err != nil {
			out.Problems = append(out.Problems, label+": "+err.Error())
			continue
		}
		out.Balances++
	}
}

// noteProblem records a failure and flags an item whose login has expired, so
// the UI can offer to repair it rather than just showing an error.
func (h *PlaidHandler) noteProblem(item db.PlaidItem, label string, err error, out *syncReport) {
	status := db.ItemError
	var apiErr *plaid.Error
	if errors.As(err, &apiErr) && apiErr.NeedsRelink() {
		status = db.ItemLoginRequired
	}
	if setErr := db.SetPlaidItemStatus(h.conn, item.ItemID, status); setErr != nil {
		h.logger.Error("plaid", "could not flag item", map[string]interface{}{
			"item_id": item.ItemID, "error": setErr.Error(),
		})
	}
	out.Problems = append(out.Problems, label+": "+err.Error())
}

// ── review queue ─────────────────────────────────────────────────────────────

// GET /api/admin/budget/plaid/staged — what's waiting to be reviewed.
func (h *PlaidHandler) HandleStaged(w http.ResponseWriter, r *http.Request) {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "budget database unavailable")
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	status := r.URL.Query().Get("status")
	rows, err := db.ListStaged(h.conn, status)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"staged": rows})
}

// POST /api/admin/budget/plaid/accept — post a reviewed row into the ledger.
func (h *PlaidHandler) HandleAccept(w http.ResponseWriter, r *http.Request) {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "budget database unavailable")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		PlaidTxnID       string `json:"plaid_txn_id"`
		CounterAccountID int64  `json:"counter_account_id"`
		Description      string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if body.PlaidTxnID == "" {
		writeErr(w, http.StatusBadRequest, "plaid_txn_id is required")
		return
	}

	entry, err := db.AcceptStaged(h.conn, db.AcceptInput{
		PlaidTxnID:       body.PlaidTxnID,
		CounterAccountID: body.CounterAccountID,
		Description:      body.Description,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

// POST /api/admin/budget/plaid/ignore — dismiss rows without booking them.
func (h *PlaidHandler) HandleIgnore(w http.ResponseWriter, r *http.Request) {
	if h.conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "budget database unavailable")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		PlaidTxnIDs []string `json:"plaid_txn_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if len(body.PlaidTxnIDs) == 0 {
		writeErr(w, http.StatusBadRequest, "plaid_txn_ids is required")
		return
	}
	if err := db.MarkStaged(h.conn, body.PlaidTxnIDs, db.StagedIgnored, 0); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"ignored": len(body.PlaidTxnIDs)})
}
