package services

import (
	"backend/internal/logger"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type USCISStatus struct {
	Raw       map[string]interface{} `json:"raw"`
	CheckedAt time.Time              `json:"checked_at"`
	Error     string                 `json:"error,omitempty"`
	Changed   bool                   `json:"changed"`
}

type USCISPoller struct {
	logger     *logger.Logger
	mu         sync.RWMutex
	last       *USCISStatus
	prevJSON   string
	caseURL    string
	// in-memory credential overrides (updated via admin API without restart)
	credMu  sync.RWMutex
	cookie  string
	bearer  string
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
		// Initial check on startup
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
	defer p.credMu.Unlock()
	p.cookie = cookie
	p.bearer = bearer
	p.logger.Info("uscis", "Credentials updated in-memory", nil)
}

func (p *USCISPoller) getCreds() (cookie, bearer string) {
	p.credMu.RLock()
	defer p.credMu.RUnlock()
	// In-memory overrides take precedence over env vars
	if p.cookie != "" || p.bearer != "" {
		return p.cookie, p.bearer
	}
	return os.Getenv("USCIS_COOKIE"), os.Getenv("USCIS_BEARER")
}

func (p *USCISPoller) Check() {
	cookie, bearer := p.getCreds()
	if cookie == "" && bearer == "" {
		p.logger.Warn("uscis", "No USCIS credentials configured — skipping poll", nil)
		p.setResult(nil, "no credentials configured")
		return
	}

	req, err := http.NewRequest("GET", p.caseURL, nil)
	if err != nil {
		p.setResult(nil, "failed to create request: "+err.Error())
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", "https://my.uscis.gov/")
	req.Header.Set("Origin", "https://my.uscis.gov")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		p.setResult(nil, "request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		p.setResult(nil, "failed to read response: "+err.Error())
		return
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		p.setResult(nil, fmt.Sprintf("auth failed (HTTP %d) — update credentials via admin panel", resp.StatusCode))
		return
	}
	if resp.StatusCode != http.StatusOK {
		p.setResult(nil, fmt.Sprintf("unexpected HTTP %d: %s", resp.StatusCode, truncate(string(body), 200)))
		return
	}

	var status map[string]interface{}
	if err := json.Unmarshal(body, &status); err != nil {
		p.setResult(nil, "failed to parse JSON: "+err.Error())
		return
	}

	newJSON := string(body)
	p.mu.Lock()
	changed := p.prevJSON != "" && p.prevJSON != newJSON
	p.prevJSON = newJSON
	p.mu.Unlock()

	p.setResult(status, "")
	p.logger.Info("uscis", "USCIS case status polled", map[string]interface{}{
		"changed": changed,
	})

	if changed {
		p.sendNtfyNotification(status)
	}
}

func (p *USCISPoller) setResult(raw map[string]interface{}, errMsg string) {
	s := &USCISStatus{
		Raw:       raw,
		CheckedAt: time.Now(),
		Error:     errMsg,
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

func (p *USCISPoller) sendNtfyNotification(status map[string]interface{}) {
	topic := os.Getenv("NTFY_TOPIC")
	if topic == "" {
		p.logger.Warn("uscis", "NTFY_TOPIC not set — skipping notification", nil)
		return
	}

	msg := extractStatusMessage(status)
	ntfyURL := "https://ntfy.sh/" + topic

	req, err := http.NewRequest("POST", ntfyURL, strings.NewReader(msg))
	if err != nil {
		p.logger.Error("uscis", "Failed to build ntfy request", map[string]interface{}{"error": err.Error()})
		return
	}
	req.Header.Set("Title", "USCIS STEM OPT Update")
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
	})
}

func extractStatusMessage(status map[string]interface{}) string {
	// Try common USCIS API field names
	for _, key := range []string{"caseStatus", "status", "description", "caseStatusText", "formStatus"} {
		if v, ok := status[key].(string); ok && v != "" {
			return v
		}
	}
	b, _ := json.Marshal(status)
	return truncate(string(b), 300)
}

// sendTestNotification is used by the admin trigger-test endpoint
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
