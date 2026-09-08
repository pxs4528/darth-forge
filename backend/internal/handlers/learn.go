package handlers

import (
	_ "embed"
	"net/http"
)

// The dashboard is embedded in the binary rather than shipped in the static
// bundle. Anything under frontend/public/ is Vite's public directory: it lands
// in the document root both hostnames serve, so the file would have been
// readable at https://<site>/learn.html with no admin gate at all. The gate on
// this route only means something while the file exists nowhere else.
//
//go:embed learn.html
var learnHTML []byte

// GET /api/admin/learn — the learning dashboard. Registered behind AdminOnly.
func HandleLearn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
	w.Write(learnHTML)
}
