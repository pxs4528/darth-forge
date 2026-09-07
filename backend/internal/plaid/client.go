// Package plaid is a hand-rolled client for the handful of Plaid endpoints the
// budget tool needs: linking an institution, pulling transactions, and reading
// balances.
//
// The official SDK is a large generated OpenAPI client; we call five endpoints
// and this backend runs on a Raspberry Pi, so a couple of hundred lines of
// net/http beats the dependency — the same reasoning as the hand-rolled SQL
// dump and SVG charts elsewhere in this codebase.
package plaid

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

// Hosts per Plaid environment. The Development environment was retired in
// 2024; real data now comes from Production, which the free Trial plan grants.
var hosts = map[string]string{
	"sandbox":    "https://sandbox.plaid.com",
	"production": "https://production.plaid.com",
}

type Client struct {
	clientID string
	secret   string
	env      string
	host     string
	http     *http.Client
}

// New reads PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV. Returns an error
// rather than panicking so the server boots without Plaid configured and the
// routes simply report themselves unavailable.
func New() (*Client, error) {
	clientID := strings.TrimSpace(os.Getenv("PLAID_CLIENT_ID"))
	secret := strings.TrimSpace(os.Getenv("PLAID_SECRET"))
	if clientID == "" || secret == "" {
		return nil, fmt.Errorf("PLAID_CLIENT_ID and PLAID_SECRET are not set")
	}

	env := strings.TrimSpace(os.Getenv("PLAID_ENV"))
	if env == "" {
		env = "sandbox"
	}
	host, ok := hosts[env]
	if !ok {
		return nil, fmt.Errorf("PLAID_ENV must be sandbox or production, got %q", env)
	}

	return &Client{
		clientID: clientID,
		secret:   secret,
		env:      env,
		host:     host,
		http:     &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// newWithHost is used by tests to point at an httptest server.
func newWithHost(host string) *Client {
	return &Client{
		clientID: "test-client",
		secret:   "test-secret",
		env:      "sandbox",
		host:     host,
		http:     &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) Env() string { return c.env }

// Error is a Plaid API error. ErrorCode is the stable machine-readable one;
// DisplayMessage is safe to show a user, when Plaid provides it.
type Error struct {
	StatusCode     int    `json:"-"`
	ErrorType      string `json:"error_type"`
	ErrorCode      string `json:"error_code"`
	ErrorMessage   string `json:"error_message"`
	DisplayMessage string `json:"display_message"`
	RequestID      string `json:"request_id"`
}

func (e *Error) Error() string {
	if e.DisplayMessage != "" {
		return e.DisplayMessage
	}
	if e.ErrorMessage != "" {
		return fmt.Sprintf("plaid: %s (%s)", e.ErrorMessage, e.ErrorCode)
	}
	return fmt.Sprintf("plaid: HTTP %d", e.StatusCode)
}

// NeedsRelink reports whether the item's credentials have gone stale and the
// user has to walk back through Link. Worth distinguishing: it's the one
// failure a person has to fix by hand rather than a retry.
func (e *Error) NeedsRelink() bool {
	switch e.ErrorCode {
	case "ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "ITEM_LOCKED":
		return true
	}
	return false
}

// call posts a JSON body to a Plaid endpoint, injecting credentials.
func (c *Client) call(ctx context.Context, path string, body map[string]any, out any) error {
	body["client_id"] = c.clientID
	body["secret"] = c.secret

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}

	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.host+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build %s: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call %s: %w", path, err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}

	if res.StatusCode != http.StatusOK {
		apiErr := &Error{StatusCode: res.StatusCode}
		// A non-JSON body (a proxy error page, say) still has to surface as
		// something actionable rather than a JSON parse failure.
		_ = json.Unmarshal(raw, apiErr)
		return apiErr
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

// ── link ─────────────────────────────────────────────────────────────────────

// CreateLinkToken mints the short-lived token that opens Plaid Link in the
// browser. products is e.g. ["transactions"]; investment-only items can be
// linked with ["investments"] and read via Balances.
func (c *Client) CreateLinkToken(ctx context.Context, userID string, products []string) (string, error) {
	var out struct {
		LinkToken string `json:"link_token"`
	}
	err := c.call(ctx, "/link/token/create", map[string]any{
		"user":          map[string]any{"client_user_id": userID},
		"client_name":   "darth-forge budget",
		"products":      products,
		"country_codes": []string{"US"},
		"language":      "en",
	}, &out)
	return out.LinkToken, err
}

// CreateUpdateLinkToken opens Link in update mode, to repair an item whose
// login has expired without creating a second item for the same institution.
func (c *Client) CreateUpdateLinkToken(ctx context.Context, userID, accessToken string) (string, error) {
	var out struct {
		LinkToken string `json:"link_token"`
	}
	err := c.call(ctx, "/link/token/create", map[string]any{
		"user":          map[string]any{"client_user_id": userID},
		"client_name":   "darth-forge budget",
		"country_codes": []string{"US"},
		"language":      "en",
		"access_token":  accessToken,
	}, &out)
	return out.LinkToken, err
}

// ExchangePublicToken turns the one-time token Link hands back into the
// long-lived access token. That token is a live credential for the account —
// it is never sent to the browser and never included in a database dump.
func (c *Client) ExchangePublicToken(ctx context.Context, publicToken string) (accessToken, itemID string, err error) {
	var out struct {
		AccessToken string `json:"access_token"`
		ItemID      string `json:"item_id"`
	}
	err = c.call(ctx, "/item/public_token/exchange", map[string]any{
		"public_token": publicToken,
	}, &out)
	return out.AccessToken, out.ItemID, err
}

// ── accounts ─────────────────────────────────────────────────────────────────

// Account is one account inside an item, with its balance in cents.
type Account struct {
	AccountID    string `json:"account_id"`
	Name         string `json:"name"`
	OfficialName string `json:"official_name"`
	Mask         string `json:"mask"`
	Type         string `json:"type"`    // depository | credit | investment | loan
	Subtype      string `json:"subtype"` // checking | savings | credit card | 401k | hsa …
	// BalanceCents is the current balance. Plaid reports credit balances as a
	// positive amount owed, which is the opposite of our schema's sign for
	// liabilities — callers convert.
	BalanceCents int64
}

type rawAccount struct {
	AccountID    string `json:"account_id"`
	Name         string `json:"name"`
	OfficialName string `json:"official_name"`
	Mask         string `json:"mask"`
	Type         string `json:"type"`
	Subtype      string `json:"subtype"`
	Balances     struct {
		Current   *float64 `json:"current"`
		Available *float64 `json:"available"`
	} `json:"balances"`
}

func (r rawAccount) toAccount() Account {
	a := Account{
		AccountID:    r.AccountID,
		Name:         r.Name,
		OfficialName: r.OfficialName,
		Mask:         r.Mask,
		Type:         r.Type,
		Subtype:      r.Subtype,
	}
	// `current` is authoritative; `available` excludes holds and would drift
	// from a statement. Only fall back when current is genuinely absent.
	if r.Balances.Current != nil {
		a.BalanceCents = ToCents(*r.Balances.Current)
	} else if r.Balances.Available != nil {
		a.BalanceCents = ToCents(*r.Balances.Available)
	}
	return a
}

// Balances reads current balances for every account on an item. This is the
// whole sync for investment and retirement accounts, where a transaction feed
// would be noise without lot-level tracking.
func (c *Client) Balances(ctx context.Context, accessToken string) ([]Account, error) {
	var out struct {
		Accounts []rawAccount `json:"accounts"`
	}
	if err := c.call(ctx, "/accounts/balance/get", map[string]any{
		"access_token": accessToken,
	}, &out); err != nil {
		return nil, err
	}
	accounts := make([]Account, 0, len(out.Accounts))
	for _, r := range out.Accounts {
		accounts = append(accounts, r.toAccount())
	}
	return accounts, nil
}

// ── transactions ─────────────────────────────────────────────────────────────

// Transaction is one posted or pending transaction, already converted to our
// sign convention: negative when money leaves the account.
type Transaction struct {
	TransactionID string
	AccountID     string
	Date          string // YYYY-MM-DD, the posted date where available
	Name          string
	Merchant      string
	Category      string
	AmountCents   int64
	Pending       bool
}

type rawTransaction struct {
	TransactionID           string  `json:"transaction_id"`
	AccountID               string  `json:"account_id"`
	Date                    string  `json:"date"`
	AuthorizedDate          string  `json:"authorized_date"`
	Name                    string  `json:"name"`
	MerchantName            string  `json:"merchant_name"`
	Amount                  float64 `json:"amount"`
	Pending                 bool    `json:"pending"`
	PersonalFinanceCategory struct {
		Primary  string `json:"primary"`
		Detailed string `json:"detailed"`
	} `json:"personal_finance_category"`
	Category []string `json:"category"`
}

func (r rawTransaction) toTransaction() Transaction {
	category := r.PersonalFinanceCategory.Primary
	if category == "" && len(r.Category) > 0 {
		category = r.Category[0]
	}
	return Transaction{
		TransactionID: r.TransactionID,
		AccountID:     r.AccountID,
		Date:          r.Date,
		Name:          r.Name,
		Merchant:      r.MerchantName,
		Category:      category,
		// Plaid is positive when money leaves the account; our splits are
		// negative. Flipping here means nothing downstream has to remember.
		AmountCents: -ToCents(r.Amount),
		Pending:     r.Pending,
	}
}

// SyncResult is one page of /transactions/sync.
type SyncResult struct {
	Added    []Transaction
	Modified []Transaction
	Removed  []string // transaction ids Plaid has retracted
	Cursor   string
	HasMore  bool
}

// Sync pulls incremental changes since cursor. An empty cursor asks for the
// full available history, which is how a newly linked item backfills.
func (c *Client) Sync(ctx context.Context, accessToken, cursor string) (*SyncResult, error) {
	body := map[string]any{"access_token": accessToken, "count": 500}
	// Plaid rejects an explicit null cursor, so it's omitted on first call.
	if cursor != "" {
		body["cursor"] = cursor
	}

	var out struct {
		Added    []rawTransaction `json:"added"`
		Modified []rawTransaction `json:"modified"`
		Removed  []struct {
			TransactionID string `json:"transaction_id"`
		} `json:"removed"`
		NextCursor string `json:"next_cursor"`
		HasMore    bool   `json:"has_more"`
	}
	if err := c.call(ctx, "/transactions/sync", body, &out); err != nil {
		return nil, err
	}

	res := &SyncResult{Cursor: out.NextCursor, HasMore: out.HasMore}
	for _, r := range out.Added {
		res.Added = append(res.Added, r.toTransaction())
	}
	for _, r := range out.Modified {
		res.Modified = append(res.Modified, r.toTransaction())
	}
	for _, r := range out.Removed {
		res.Removed = append(res.Removed, r.TransactionID)
	}
	return res, nil
}

// ── item metadata ────────────────────────────────────────────────────────────

// InstitutionName resolves an item's institution to something human-readable,
// so the UI can say "Chase" rather than an opaque id. Best-effort: a failure
// here should never block a link.
func (c *Client) InstitutionName(ctx context.Context, accessToken string) (id, name string) {
	var item struct {
		Item struct {
			InstitutionID string `json:"institution_id"`
		} `json:"item"`
	}
	if err := c.call(ctx, "/item/get",
		map[string]any{"access_token": accessToken}, &item); err != nil {
		return "", ""
	}
	id = item.Item.InstitutionID
	if id == "" {
		return "", ""
	}

	var inst struct {
		Institution struct {
			Name string `json:"name"`
		} `json:"institution"`
	}
	if err := c.call(ctx, "/institutions/get_by_id", map[string]any{
		"institution_id": id,
		"country_codes":  []string{"US"},
	}, &inst); err != nil {
		return id, ""
	}
	return id, inst.Institution.Name
}

// ToCents converts Plaid's float dollars to integer cents. Rounding matters:
// 25.10 is not exactly representable, so a truncation would lose a cent on a
// meaningful share of transactions.
func ToCents(dollars float64) int64 {
	return int64(math.Round(dollars * 100))
}
