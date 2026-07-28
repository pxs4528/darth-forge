package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetSessions() {
	sessions = &sessionStore{sessions: map[string]time.Time{}}
}

func postAuth(t *testing.T, password string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/auth",
		strings.NewReader(`{"password":"`+password+`"}`))
	rec := httptest.NewRecorder()
	HandleAdminAuth(rec, req)
	return rec
}

func TestAdminAuthMintsSessionToken(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "correct-horse")

	rec := postAuth(t, "correct-horse")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	token := body["token"]
	if token == "" {
		t.Fatal("no token returned")
	}
	if token == "correct-horse" {
		t.Fatal("token must not be the admin secret itself")
	}
	if len(token) != 64 {
		t.Fatalf("want 64-char hex token, got %d chars", len(token))
	}
}

func TestAdminAuthRejectsWrongPassword(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "correct-horse")

	if rec := postAuth(t, "wrong"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAdminAuthRejectsWhenSecretUnset(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "")

	// Even an empty-vs-empty match must not authenticate.
	req := httptest.NewRequest(http.MethodPost, "/api/admin/auth", strings.NewReader(`{"password":"x"}`))
	rec := httptest.NewRecorder()
	HandleAdminAuth(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAdminOnlyAcceptsOnlyLiveTokens(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "correct-horse")

	rec := postAuth(t, "correct-horse")
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	token := body["token"]

	protected := AdminOnly(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	check := func(header string, want int) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/protected", nil)
		if header != "" {
			req.Header.Set("X-Admin-Token", header)
		}
		rec := httptest.NewRecorder()
		protected(rec, req)
		if rec.Code != want {
			t.Fatalf("token %q: want %d, got %d", header, want, rec.Code)
		}
	}

	check(token, http.StatusOK)
	check("", http.StatusUnauthorized)
	check("deadbeef", http.StatusUnauthorized)
	// The raw secret is no longer a valid credential for API calls.
	check("correct-horse", http.StatusUnauthorized)
}

func TestSessionExpiry(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "correct-horse")

	rec := postAuth(t, "correct-horse")
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	token := body["token"]

	// Force the session into the past.
	sessions.mu.Lock()
	sessions.sessions[token] = time.Now().Add(-time.Minute)
	sessions.mu.Unlock()

	if sessions.valid(token) {
		t.Fatal("expired token still valid")
	}
}

func TestAuthRateLimit(t *testing.T) {
	resetSessions()
	t.Setenv("ADMIN_SECRET", "correct-horse")

	for i := 0; i < maxAuthFailures; i++ {
		if rec := postAuth(t, "wrong"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: want 401, got %d", i, rec.Code)
		}
	}
	// Next attempt — even with the right password — is throttled.
	if rec := postAuth(t, "correct-horse"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 after %d failures, got %d", maxAuthFailures, rec.Code)
	}
}
