package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
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
	CommitURL   string `json:"commit_url"`
	GithubSHA   string `json:"github_sha"`
}
type BlogHandler struct {
	conn      *sql.DB
	ready     bool
	publisher blogPublisher
	mu        sync.Mutex
}

func NewBlogHandler(conn *sql.DB) *BlogHandler {
	h := &BlogHandler{conn: conn, publisher: newGithubBlogPublisher()}
	if conn != nil {
		_, err := conn.Exec(`CREATE TABLE IF NOT EXISTS blog_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, published_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`)
		if err == nil {
			err = migrateBlogCommits(conn)
		}
		h.ready = err == nil
	}
	return h
}

func migrateBlogCommits(conn *sql.DB) error {
	rows, err := conn.Query(`PRAGMA table_info(blog_posts)`)
	if err != nil {
		return err
	}
	columns := map[string]bool{}
	for rows.Next() {
		var cid, notNull, pk int
		var name, kind string
		var value any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &value, &pk); err != nil {
			rows.Close()
			return err
		}
		columns[name] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, name := range []string{"commit_url", "github_sha"} {
		if !columns[name] {
			if _, err := conn.Exec(`ALTER TABLE blog_posts ADD COLUMN ` + name + ` TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
	}
	return nil
}

const blogColumns = `id,title,slug,excerpt,body,published,published_at,updated_at,commit_url,github_sha`

func scanBlog(row interface{ Scan(...any) error }, p *BlogPost) error {
	return row.Scan(&p.ID, &p.Title, &p.Slug, &p.Excerpt, &p.Body, &p.Published, &p.PublishedAt, &p.UpdatedAt, &p.CommitURL, &p.GithubSHA)
}

var blogSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func (h *BlogHandler) Handle(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.ready {
		writeErr(w, 503, "blog storage unavailable")
		return
	}
	if r.Method == http.MethodGet {
		query := `SELECT ` + blogColumns + ` FROM blog_posts`
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
			if err = scanBlog(rows, &p); err != nil {
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
	// Serialize GitHub mutations and reject stale editors before contacting GitHub.
	h.mu.Lock()
	defer h.mu.Unlock()
	var previous BlogPost
	if p.ID != 0 {
		if err := scanBlog(h.conn.QueryRowContext(r.Context(), `SELECT `+blogColumns+` FROM blog_posts WHERE id=?`, p.ID), &previous); err != nil {
			if err == sql.ErrNoRows {
				writeErr(w, 404, "post not found")
			} else {
				writeErr(w, 500, "could not read post")
			}
			return
		}
		if p.UpdatedAt != previous.UpdatedAt {
			writeErr(w, 409, "this post changed since you opened it; reload before saving")
			return
		}
	}
	if r.Method == http.MethodDelete {
		if p.ID <= 0 {
			writeErr(w, 400, "post id required")
			return
		}
		if previous.GithubSHA != "" {
			if h.publisher == nil {
				writeErr(w, 503, "configure BLOG_GITHUB_TOKEN before removing a committed story")
				return
			}
			if err := h.publisher.Remove(r.Context(), previous); err != nil {
				writeErr(w, 502, err.Error())
				return
			}
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
	// Check slug collisions before creating any external commit.
	var duplicate int
	if err := h.conn.QueryRowContext(r.Context(), `SELECT count(*) FROM blog_posts WHERE slug=? AND id<>?`, p.Slug, p.ID).Scan(&duplicate); err != nil {
		writeErr(w, 500, "could not check slug")
		return
	}
	if duplicate > 0 {
		writeErr(w, 409, "a story already uses this slug")
		return
	}
	if (p.Published || previous.GithubSHA != "") && h.publisher == nil {
		writeErr(w, 503, "GitHub publishing is not configured; add BLOG_GITHUB_TOKEN on the server. Your live post has not changed.")
		return
	}
	updated := time.Now().UTC()
	// Some hosts have coarse wall clocks. Keep the optimistic edit version
	// strictly increasing even when two saves land in the same clock tick.
	if prior, err := time.Parse(time.RFC3339Nano, previous.UpdatedAt); err == nil && !updated.After(prior) {
		updated = prior.Add(time.Nanosecond)
	}
	now := updated.Format(time.RFC3339Nano)
	// Never trust client-supplied dates or GitHub references.
	p.PublishedAt, p.CommitURL, p.GithubSHA = previous.PublishedAt, previous.CommitURL, previous.GithubSHA
	p.UpdatedAt = now
	// Reserve a durable ID as a private draft before an external write. A failed
	// publish returns that ID so retrying cannot create a second GitHub file.
	if p.ID == 0 {
		res, err := h.conn.ExecContext(r.Context(), `INSERT INTO blog_posts(title,slug,excerpt,body,published,published_at,updated_at) VALUES(?,?,?,?,0,'',?)`, p.Title, p.Slug, p.Excerpt, p.Body, now)
		if err != nil {
			writeErr(w, 409, "could not save; slug may already exist")
			return
		}
		p.ID, _ = res.LastInsertId()
		previous = p
		previous.Published = false
	}
	publishError := func(err error) {
		writeJSON(w, 502, map[string]any{"error": err.Error(), "id": p.ID, "updated_at": previous.UpdatedAt})
	}
	if p.Published {
		if p.PublishedAt == "" {
			p.PublishedAt = now
		}
		committed, err := h.publisher.Publish(r.Context(), p, previous)
		if err != nil {
			publishError(err)
			return
		}
		p = committed
	} else if previous.GithubSHA != "" {
		if err := h.publisher.Remove(r.Context(), previous); err != nil {
			publishError(err)
			return
		}
		p.GithubSHA = ""
	}
	_, err := h.conn.ExecContext(r.Context(), `UPDATE blog_posts SET title=?,slug=?,excerpt=?,body=?,published=?,published_at=?,updated_at=?,commit_url=?,github_sha=? WHERE id=?`, p.Title, p.Slug, p.Excerpt, p.Body, p.Published, p.PublishedAt, p.UpdatedAt, p.CommitURL, p.GithubSHA, p.ID)
	if err != nil {
		publishError(errors.New("the database could not save the result; retry to reconcile the GitHub commit"))
		return
	}
	writeJSON(w, 200, map[string]int64{"id": p.ID})
}
func (h *BlogHandler) Public(w http.ResponseWriter, r *http.Request) { h.Handle(w, r, false) }
func (h *BlogHandler) Admin(w http.ResponseWriter, r *http.Request)  { h.Handle(w, r, true) }
