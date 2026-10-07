package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type BlogPost struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	Excerpt     string `json:"excerpt"`
	Body        string `json:"body"`
	Published   bool   `json:"published"`
	PublishedAt string `json:"published_at"`
	UpdatedAt   string `json:"updated_at"`
}
type BlogHandler struct {
	conn  *sql.DB
	ready bool
}

func NewBlogHandler(conn *sql.DB) *BlogHandler {
	h := &BlogHandler{conn: conn}
	if conn != nil {
		_, err := conn.Exec(`CREATE TABLE IF NOT EXISTS blog_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`)
		h.ready = err == nil
	}
	return h
}

var blogSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func (h *BlogHandler) Handle(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.ready {
		writeErr(w, 503, "blog storage unavailable")
		return
	}
	if r.Method == http.MethodGet {
		query := `SELECT id,title,slug,excerpt,body,published,published_at,updated_at FROM blog_posts`
		args := []any{}
		if !admin {
			query += ` WHERE published=1`
		}
		if slug := r.URL.Query().Get("slug"); slug != "" {
			if admin {
				query += ` WHERE slug=?`
			} else {
				query += ` AND slug=?`
			}
			args = append(args, slug)
		}
		query += ` ORDER BY published_at DESC, updated_at DESC LIMIT 200`
		rows, err := h.conn.QueryContext(r.Context(), query, args...)
		if err != nil {
			writeErr(w, 500, "could not load posts")
			return
		}
		defer rows.Close()
		posts := []BlogPost{}
		for rows.Next() {
			var p BlogPost
			if err = rows.Scan(&p.ID, &p.Title, &p.Slug, &p.Excerpt, &p.Body, &p.Published, &p.PublishedAt, &p.UpdatedAt); err != nil {
				writeErr(w, 500, "could not read posts")
				return
			}
			posts = append(posts, p)
		}
		if rows.Err() != nil {
			writeErr(w, 500, "could not read posts")
			return
		}
		writeJSON(w, 200, posts)
		return
	}
	if !admin {
		w.Header().Set("Allow", "GET")
		writeErr(w, 405, "method not allowed")
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeErr(w, 405, "method not allowed")
		return
	}
	var p BlogPost
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&p) != nil {
		writeErr(w, 400, "invalid post")
		return
	}
	if r.Method == http.MethodDelete {
		if p.ID <= 0 {
			writeErr(w, 400, "post id required")
			return
		}
		res, err := h.conn.ExecContext(r.Context(), `DELETE FROM blog_posts WHERE id=?`, p.ID)
		if err != nil {
			writeErr(w, 500, "could not delete post")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeErr(w, 404, "post not found")
			return
		}
		writeJSON(w, 200, map[string]bool{"deleted": true})
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	p.Slug = strings.TrimSpace(p.Slug)
	if len(p.Title) == 0 || len(p.Title) > 200 || len(p.Slug) > 100 || !blogSlug.MatchString(p.Slug) || len(p.Excerpt) > 600 || len(p.Body) > 200000 || strings.TrimSpace(p.Body) == "" || p.ID < 0 {
		writeErr(w, 400, "use a title, lowercase hyphenated slug, and post body; excerpt maximum 600 characters")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	// Published timestamps come from the server, never the client.
	if p.ID == 0 {
		publishedAt := ""
		if p.Published {
			publishedAt = now
		}
		res, err := h.conn.ExecContext(r.Context(), `INSERT INTO blog_posts(title,slug,excerpt,body,published,published_at,updated_at) VALUES(?,?,?,?,?,?,?)`, p.Title, p.Slug, p.Excerpt, p.Body, p.Published, publishedAt, now)
		if err != nil {
			writeErr(w, 409, "could not save; slug may already exist")
			return
		}
		p.ID, _ = res.LastInsertId()
	} else {
		res, err := h.conn.ExecContext(r.Context(), `UPDATE blog_posts SET title=?,slug=?,excerpt=?,body=?,published=?,published_at=CASE WHEN ?=1 AND published_at='' THEN ? ELSE published_at END,updated_at=? WHERE id=?`, p.Title, p.Slug, p.Excerpt, p.Body, p.Published, p.Published, now, now, p.ID)
		if err != nil {
			writeErr(w, 409, "could not save; slug may already exist")
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			writeErr(w, 404, "post not found")
			return
		}
	}
	writeJSON(w, 200, map[string]int64{"id": p.ID})
}
func (h *BlogHandler) Public(w http.ResponseWriter, r *http.Request) { h.Handle(w, r, false) }
func (h *BlogHandler) Admin(w http.ResponseWriter, r *http.Request)  { h.Handle(w, r, true) }
