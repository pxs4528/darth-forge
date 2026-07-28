package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"
)

// Admin auth. POST /api/admin/auth exchanges the ADMIN_SECRET password for a
// random session token; AdminOnly validates that token. The browser only ever
// stores the token, never the secret itself. Sessions live in memory, so a
// backend restart (every deploy) signs everyone out — acceptable for one user.

const (
	sessionTTL      = 30 * 24 * time.Hour
	maxAuthFailures = 5 // per rolling minute
)

type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]time.Time // token → expiry
	failures []time.Time          // recent failed login attempts
}

var sessions = &sessionStore{sessions: map[string]time.Time{}}

// mint creates and stores a fresh random token, pruning expired ones.
func (s *sessionStore) mint() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for t, exp := range s.sessions {
		if now.After(exp) {
			delete(s.sessions, t)
		}
	}
	s.sessions[token] = now.Add(sessionTTL)
	return token, nil
}

// valid reports whether the token is a live session, sliding its expiry.
func (s *sessionStore) valid(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.sessions[token]
	if !ok {
		return false
	}
	now := time.Now()
	if now.After(exp) {
		delete(s.sessions, token)
		return false
	}
	s.sessions[token] = now.Add(sessionTTL)
	return true
}

// allowAttempt gates login attempts to maxAuthFailures failures per minute.
func (s *sessionStore) allowAttempt() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-time.Minute)
	kept := s.failures[:0]
	for _, f := range s.failures {
		if f.After(cutoff) {
			kept = append(kept, f)
		}
	}
	s.failures = kept
	return len(s.failures) < maxAuthFailures
}

func (s *sessionStore) recordFailure() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures = append(s.failures, time.Now())
}

// AdminOnly middleware — requires a live session token in X-Admin-Token.
func AdminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.valid(r.Header.Get("X-Admin-Token")) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// HandleAdminAuth — POST /api/admin/auth: password in, session token out.
func HandleAdminAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if !sessions.allowAttempt() {
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]string{"error": "too many attempts — wait a minute"})
		return
	}

	secret := os.Getenv("ADMIN_SECRET")
	if secret == "" ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(body.Password)) != 1 {
		sessions.recordFailure()
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid password"})
		return
	}

	token, err := sessions.mint()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to create session"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}
