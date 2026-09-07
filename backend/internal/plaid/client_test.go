package plaid

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// serve stands up a fake Plaid, returning canned JSON per path and recording
// the request bodies so credential injection and cursor handling are visible.
func serve(t *testing.T, routes map[string]string) (*Client, *[]map[string]any) {
	t.Helper()
	var seen []map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		body["_path"] = r.URL.Path
		seen = append(seen, body)

		payload, ok := routes[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error_code":"NOT_FOUND"}`))
			return
		}
		if payload != "" && payload[0] == '!' {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(payload[1:]))
			return
		}
		w.Write([]byte(payload))
	}))
	t.Cleanup(srv.Close)

	return newWithHost(srv.URL), &seen
}

func TestToCentsRoundsRatherThanTruncating(t *testing.T) {
	cases := []struct {
		dollars float64
		want    int64
	}{
		{25.10, 2510}, // 25.10*100 is 2509.999… in float
		{0.07, 7},
		{1234.56, 123456},
		{-42.99, -4299},
		{0, 0},
	}
	for _, c := range cases {
		if got := ToCents(c.dollars); got != c.want {
			t.Errorf("ToCents(%v) = %d; want %d", c.dollars, got, c.want)
		}
	}
}

func TestSyncFlipsPlaidsSignConvention(t *testing.T) {
	// Plaid: positive means money left the account. Ours: negative does.
	client, _ := serve(t, map[string]string{
		"/transactions/sync": `{
			"added": [
				{"transaction_id":"t1","account_id":"a1","date":"2026-08-04",
				 "name":"TRADER JOE'S","merchant_name":"Trader Joe's","amount":20.00,
				 "pending":false,
				 "personal_finance_category":{"primary":"FOOD_AND_DRINK"}},
				{"transaction_id":"t2","account_id":"a1","date":"2026-08-01",
				 "name":"PAYROLL","amount":-2875.92,"pending":false}
			],
			"modified": [], "removed": [],
			"next_cursor": "cursor-2", "has_more": false
		}`,
	})

	res, err := client.Sync(context.Background(), "access-1", "")
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if len(res.Added) != 2 {
		t.Fatalf("added = %d; want 2", len(res.Added))
	}
	// Spending leaves the account, so it must land negative for us.
	if got := res.Added[0].AmountCents; got != -2000 {
		t.Errorf("groceries = %d; want -2000", got)
	}
	// A paycheck arrives, so it must land positive.
	if got := res.Added[1].AmountCents; got != 287592 {
		t.Errorf("paycheck = %d; want 287592", got)
	}
	if res.Added[0].Category != "FOOD_AND_DRINK" {
		t.Errorf("category = %q; want FOOD_AND_DRINK", res.Added[0].Category)
	}
	if res.Cursor != "cursor-2" || res.HasMore {
		t.Errorf("cursor = %q, hasMore = %v; want cursor-2, false", res.Cursor, res.HasMore)
	}
}

func TestSyncOmitsAnEmptyCursorButSendsARealOne(t *testing.T) {
	body := `{"added":[],"modified":[],"removed":[],"next_cursor":"c1","has_more":false}`
	client, seen := serve(t, map[string]string{"/transactions/sync": body})

	if _, err := client.Sync(context.Background(), "access-1", ""); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	// Plaid rejects an explicit null cursor; the first call must omit it.
	if _, present := (*seen)[0]["cursor"]; present {
		t.Error("first sync sent a cursor; want it omitted for a full backfill")
	}

	if _, err := client.Sync(context.Background(), "access-1", "c1"); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if got := (*seen)[1]["cursor"]; got != "c1" {
		t.Errorf("second sync cursor = %v; want c1", got)
	}
}

func TestEveryCallCarriesCredentials(t *testing.T) {
	client, seen := serve(t, map[string]string{
		"/link/token/create": `{"link_token":"link-sandbox-1"}`,
	})

	token, err := client.CreateLinkToken(context.Background(), "user-1", []string{"transactions"})
	if err != nil {
		t.Fatalf("CreateLinkToken: %v", err)
	}
	if token != "link-sandbox-1" {
		t.Errorf("link token = %q", token)
	}

	got := (*seen)[0]
	if got["client_id"] != "test-client" || got["secret"] != "test-secret" {
		t.Errorf("credentials missing from request: %v", got)
	}
}

func TestBalancesPrefersCurrentOverAvailable(t *testing.T) {
	client, _ := serve(t, map[string]string{
		"/accounts/balance/get": `{"accounts":[
			{"account_id":"a1","name":"Chase Checking","mask":"1234",
			 "type":"depository","subtype":"checking",
			 "balances":{"current":1200.00,"available":1150.00}},
			{"account_id":"a2","name":"Fidelity","type":"investment","subtype":"brokerage",
			 "balances":{"current":null,"available":35983.28}}
		]}`,
	})

	accounts, err := client.Balances(context.Background(), "access-1")
	if err != nil {
		t.Fatalf("Balances: %v", err)
	}
	if len(accounts) != 2 {
		t.Fatalf("accounts = %d; want 2", len(accounts))
	}
	// `available` excludes holds and would drift from the statement.
	if accounts[0].BalanceCents != 120000 {
		t.Errorf("checking = %d; want 120000", accounts[0].BalanceCents)
	}
	// Only fall back when current is genuinely absent.
	if accounts[1].BalanceCents != 3598328 {
		t.Errorf("brokerage = %d; want 3598328", accounts[1].BalanceCents)
	}
}

func TestAPIErrorsSurfaceTheirCode(t *testing.T) {
	client, _ := serve(t, map[string]string{
		"/transactions/sync": `!{"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED",
			"error_message":"the login details have changed",
			"display_message":"Please sign in to your bank again."}`,
	})

	_, err := client.Sync(context.Background(), "access-1", "")
	if err == nil {
		t.Fatal("expected an error")
	}
	apiErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T; want *plaid.Error", err)
	}
	if !apiErr.NeedsRelink() {
		t.Error("ITEM_LOGIN_REQUIRED should report NeedsRelink")
	}
	// The user-facing string should be the one Plaid wrote for humans.
	if apiErr.Error() != "Please sign in to your bank again." {
		t.Errorf("Error() = %q", apiErr.Error())
	}
}

func TestNonJSONErrorBodyStillReportsSomething(t *testing.T) {
	// A proxy or gateway can return HTML; that must not become a parse error.
	client, _ := serve(t, map[string]string{
		"/transactions/sync": `!<html>502 Bad Gateway</html>`,
	})

	_, err := client.Sync(context.Background(), "access-1", "")
	apiErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T; want *plaid.Error", err)
	}
	if apiErr.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d; want 400", apiErr.StatusCode)
	}
	if apiErr.Error() == "" {
		t.Error("expected a non-empty message")
	}
}

func TestRemovedTransactionsComeBackAsIDs(t *testing.T) {
	client, _ := serve(t, map[string]string{
		"/transactions/sync": `{"added":[],"modified":[],
			"removed":[{"transaction_id":"gone-1"},{"transaction_id":"gone-2"}],
			"next_cursor":"c9","has_more":false}`,
	})

	res, err := client.Sync(context.Background(), "access-1", "c8")
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(res.Removed) != 2 || res.Removed[0] != "gone-1" {
		t.Errorf("removed = %v; want [gone-1 gone-2]", res.Removed)
	}
}

func TestNewRejectsAnUnknownEnvironment(t *testing.T) {
	t.Setenv("PLAID_CLIENT_ID", "id")
	t.Setenv("PLAID_SECRET", "secret")
	t.Setenv("PLAID_ENV", "development") // retired by Plaid in 2024
	if _, err := New(); err == nil {
		t.Error("expected an error for a retired environment")
	}
}

func TestNewRequiresCredentials(t *testing.T) {
	t.Setenv("PLAID_CLIENT_ID", "")
	t.Setenv("PLAID_SECRET", "")
	if _, err := New(); err == nil {
		t.Error("expected an error when credentials are unset")
	}
}
