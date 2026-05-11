package services

import (
	"backend/internal/logger"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

type FieldDiff struct {
	Field string      `json:"field"`
	Old   interface{} `json:"old"`
	New   interface{} `json:"new"`
}

type USCISStatus struct {
	Raw         map[string]interface{} `json:"raw"`
	CheckedAt   time.Time              `json:"checked_at"`
	Error       string                 `json:"error,omitempty"`
	Changed     bool                   `json:"changed"`
	Diff        []FieldDiff            `json:"diff,omitempty"`
	AuthExpired bool                   `json:"auth_expired,omitempty"`
}

type USCISPoller struct {
	logger     *logger.Logger
	mu         sync.RWMutex
	last       *USCISStatus
	prevStatus map[string]interface{}
	caseURL    string

	credMu sync.RWMutex
	cookie string
	bearer string

	expiryMu             sync.Mutex
	authExpiredAlertedAt time.Time
}

func NewUSCISPoller(log *logger.Logger) *USCISPoller {
	caseURL := os.Getenv("USCIS_CASE_URL")
	if caseURL == "" {
		caseURL = "https://my.uscis.gov/account/case-service/api/cases/IOE9856492653"
	}
	return &USCISPoller{
		logger:  log,
		caseURL: caseURL,
	}
}

func (p *USCISPoller) Start(interval time.Duration) {
	go func() {
		p.Check()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			p.Check()
		}
	}()
}

func (p *USCISPoller) UpdateCredentials(cookie, bearer string) {
	p.credMu.Lock()
	p.cookie = cookie
	p.bearer = bearer
	p.credMu.Unlock()

	p.expiryMu.Lock()
	p.authExpiredAlertedAt = time.Time{}
	p.expiryMu.Unlock()

	p.logger.Info("uscis", "Credentials updated in-memory", nil)
}

func (p *USCISPoller) getCreds() (cookie, bearer string) {
	p.credMu.RLock()
	defer p.credMu.RUnlock()
	if p.cookie != "" || p.bearer != "" {
		return p.cookie, p.bearer
	}
	return os.Getenv("USCIS_COOKIE"), os.Getenv("USCIS_BEARER")
}

func (p *USCISPoller) fetchCase(cookie, bearer string, withBearer bool) (*http.Response, []byte, error) {
	req, err := http.NewRequest("GET", p.caseURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", "https://my.uscis.gov/")
	req.Header.Set("Origin", "https://my.uscis.gov")
	if withBearer && bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	body, readErr := io.ReadAll(resp.Body)
	resp.Body.Close()
	if readErr != nil {
		return resp, nil, readErr
	}
	return resp, body, nil
}

// refreshBearerFromCookie tries to mint a fresh bearer using the stored cookie.
// USCIS doesn't publish this endpoint; set USCIS_BEARER_REFRESH_URL to a JSON
// endpoint that returns {"access_token": "..."} (or "token"/"bearer"/"id_token")
// once you identify the my.uscis.gov SPA's refresh call via DevTools.
func (p *USCISPoller) refreshBearerFromCookie(cookie string) string {
	refreshURL := os.Getenv("USCIS_BEARER_REFRESH_URL")
	if refreshURL == "" || cookie == "" {
		return ""
	}
	req, err := http.NewRequest("GET", refreshURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://my.uscis.gov/")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return ""
	}
	for _, key := range []string{"access_token", "accessToken", "token", "bearer", "id_token"} {
		if v, ok := data[key].(string); ok && v != "" {
			p.credMu.Lock()
			p.bearer = v
			p.credMu.Unlock()
			p.logger.Info("uscis", "Refreshed bearer token from cookie", nil)
			return v
		}
	}
	return ""
}

func (p *USCISPoller) Check() {
	cookie, bearer := p.getCreds()
	if cookie == "" && bearer == "" {
		p.logger.Warn("uscis", "No USCIS credentials configured — skipping poll", nil)
		p.setResult(nil, "no credentials configured", false, nil)
		return
	}

	resp, body, err := p.fetchCase(cookie, bearer, true)
	if err != nil {
		p.setResult(nil, "request failed: "+err.Error(), false, nil)
		return
	}

	if isAuthFailure(resp.StatusCode) && bearer != "" && cookie != "" {
		p.logger.Warn("uscis", "Bearer rejected, retrying cookie-only", map[string]interface{}{"status": resp.StatusCode})
		resp, body, err = p.fetchCase(cookie, "", false)
		if err != nil {
			p.setResult(nil, "cookie-only retry failed: "+err.Error(), false, nil)
			return
		}
	}

	if isAuthFailure(resp.StatusCode) && cookie != "" {
		if newBearer := p.refreshBearerFromCookie(cookie); newBearer != "" {
			resp, body, err = p.fetchCase(cookie, newBearer, true)
			if err != nil {
				p.setResult(nil, "post-refresh request failed: "+err.Error(), false, nil)
				return
			}
		}
	}

	if isAuthFailure(resp.StatusCode) {
		msg := fmt.Sprintf("auth failed (HTTP %d) — update credentials via admin panel", resp.StatusCode)
		p.setResult(nil, msg, true, nil)
		p.alertAuthExpired(resp.StatusCode)
		return
	}

	if resp.StatusCode != http.StatusOK {
		p.setResult(nil, fmt.Sprintf("unexpected HTTP %d: %s", resp.StatusCode, truncate(string(body), 200)), false, nil)
		return
	}

	var status map[string]interface{}
	if err := json.Unmarshal(body, &status); err != nil {
		p.setResult(nil, "failed to parse JSON: "+err.Error(), false, nil)
		return
	}

	p.mu.Lock()
	prev := p.prevStatus
	var diff []FieldDiff
	if prev != nil {
		diff = computeDiff(prev, status)
	}
	p.prevStatus = status
	p.mu.Unlock()

	p.setResult(status, "", false, diff)
	p.logger.Info("uscis", "USCIS case status polled", map[string]interface{}{
		"changed":     len(diff) > 0,
		"diff_fields": len(diff),
	})

	if len(diff) > 0 {
		p.sendNtfyNotification(status, diff)
	}
}

func isAuthFailure(code int) bool {
	return code == http.StatusUnauthorized || code == http.StatusForbidden
}

func computeDiff(prev, curr map[string]interface{}) []FieldDiff {
	keys := map[string]struct{}{}
	for k := range prev {
		keys[k] = struct{}{}
	}
	for k := range curr {
		keys[k] = struct{}{}
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)

	var diffs []FieldDiff
	for _, k := range sorted {
		oldVal, oldOK := prev[k]
		newVal, newOK := curr[k]
		switch {
		case !oldOK:
			diffs = append(diffs, FieldDiff{Field: k, Old: nil, New: newVal})
		case !newOK:
			diffs = append(diffs, FieldDiff{Field: k, Old: oldVal, New: nil})
		case !equalJSON(oldVal, newVal):
			diffs = append(diffs, FieldDiff{Field: k, Old: oldVal, New: newVal})
		}
	}
	return diffs
}

func equalJSON(a, b interface{}) bool {
	if reflect.DeepEqual(a, b) {
		return true
	}
	ab, err := json.Marshal(a)
	if err != nil {
		return false
	}
	bb, err := json.Marshal(b)
	if err != nil {
		return false
	}
	return string(ab) == string(bb)
}

func (p *USCISPoller) setResult(raw map[string]interface{}, errMsg string, authExpired bool, diff []FieldDiff) {
	s := &USCISStatus{
		Raw:         raw,
		CheckedAt:   time.Now(),
		Error:       errMsg,
		Changed:     len(diff) > 0,
		Diff:        diff,
		AuthExpired: authExpired,
	}
	p.mu.Lock()
	p.last = s
	p.mu.Unlock()

	if errMsg != "" {
		p.logger.Error("uscis", "USCIS poll error", map[string]interface{}{"error": errMsg})
	}
}

func (p *USCISPoller) GetStatus() *USCISStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.last
}

func (p *USCISPoller) alertAuthExpired(httpStatus int) {
	p.expiryMu.Lock()
	defer p.expiryMu.Unlock()
	if !p.authExpiredAlertedAt.IsZero() && time.Since(p.authExpiredAlertedAt) < 24*time.Hour {
		return
	}
	p.authExpiredAlertedAt = time.Now()

	topic := os.Getenv("NTFY_TOPIC")
	if topic == "" {
		return
	}
	body := fmt.Sprintf("USCIS credentials expired (HTTP %d). Open the admin panel and re-paste your Cookie.", httpStatus)
	req, err := http.NewRequest("POST", "https://ntfy.sh/"+topic, strings.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Title", "USCIS credentials need refresh")
	req.Header.Set("Priority", "high")
	req.Header.Set("Tags", "warning,key")
	if token := os.Getenv("NTFY_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
	}
}

func (p *USCISPoller) sendNtfyNotification(status map[string]interface{}, diff []FieldDiff) {
	topic := os.Getenv("NTFY_TOPIC")
	if topic == "" {
		p.logger.Warn("uscis", "NTFY_TOPIC not set — skipping notification", nil)
		return
	}

	title := extractStatusMessage(status)
	msg := formatDiff(diff)
	if msg == "" {
		msg = title
	}

	req, err := http.NewRequest("POST", "https://ntfy.sh/"+topic, strings.NewReader(msg))
	if err != nil {
		p.logger.Error("uscis", "Failed to build ntfy request", map[string]interface{}{"error": err.Error()})
		return
	}
	req.Header.Set("Title", "USCIS update: "+title)
	req.Header.Set("Priority", "high")
	req.Header.Set("Tags", "passport_control,us")
	if token := os.Getenv("NTFY_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		p.logger.Error("uscis", "ntfy notification failed", map[string]interface{}{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	p.logger.Info("uscis", "ntfy notification sent", map[string]interface{}{
		"topic":       topic,
		"http_status": resp.StatusCode,
		"diff_fields": len(diff),
	})
}

func formatDiff(diff []FieldDiff) string {
	if len(diff) == 0 {
		return ""
	}
	var b strings.Builder
	for _, d := range diff {
		b.WriteString(d.Field)
		b.WriteString(": ")
		b.WriteString(formatVal(d.Old))
		b.WriteString(" → ")
		b.WriteString(formatVal(d.New))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func formatVal(v interface{}) string {
	if v == nil {
		return "∅"
	}
	if s, ok := v.(string); ok {
		return truncate(s, 80)
	}
	b, _ := json.Marshal(v)
	return truncate(string(b), 80)
}

func extractStatusMessage(status map[string]interface{}) string {
	for _, key := range []string{"caseStatus", "status", "description", "caseStatusText", "formStatus"} {
		if v, ok := status[key].(string); ok && v != "" {
			return v
		}
	}
	b, _ := json.Marshal(status)
	return truncate(string(b), 300)
}

func (p *USCISPoller) SendTestNotification() error {
	topic := os.Getenv("NTFY_TOPIC")
	if topic == "" {
		return fmt.Errorf("NTFY_TOPIC env var not set")
	}

	req, err := http.NewRequest("POST", "https://ntfy.sh/"+topic,
		bytes.NewReader([]byte("Test notification from darth-forge USCIS poller")))
	if err != nil {
		return err
	}
	req.Header.Set("Title", "USCIS Poller — Test")
	req.Header.Set("Priority", "default")
	req.Header.Set("Tags", "white_check_mark")
	if token := os.Getenv("NTFY_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ntfy returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
