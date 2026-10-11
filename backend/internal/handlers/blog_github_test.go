package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGitHubBlogCommitsAndRecovery(t *testing.T) {
	var content, sha string
	writes, deletes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing authorization")
		}
		if strings.Contains(r.URL.Path, "/branches/") {
			_, _ = w.Write([]byte(`{"name":"main"}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/commits") {
			if r.URL.Query().Get("path") != "content/blog/7.md" {
				t.Error("incorrect commit history path")
			}
			_, _ = w.Write([]byte(`[{"sha":"abc123"}]`))
			return
		}
		if r.URL.Path != "/repos/owner/repo/contents/content/blog/7.md" {
			t.Error("unexpected path", r.URL.Path)
		}
		switch r.Method {
		case "GET":
			if sha == "" {
				w.WriteHeader(404)
				return
			}
			_ = json.NewEncoder(w).Encode(githubFile{SHA: sha, Content: content})
		case "PUT":
			var input map[string]string
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input["sha"] != sha || input["branch"] != "main" {
				t.Error("wrong SHA or branch")
			}
			content, sha = input["content"], "new-blob"
			writes++
			_, _ = w.Write([]byte(`{"content":{"sha":"new-blob"},"commit":{"sha":"abc123"}}`))
		case "DELETE":
			deletes++
			sha = ""
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer server.Close()
	g := &githubBlogPublisher{token: "test-token", repo: "owner/repo", branch: "main", baseURL: server.URL, client: server.Client()}
	p := BlogPost{ID: 7, Title: "Hello 🚀", Slug: "hello", Excerpt: "Intro", Body: "**Markdown**\n\n---\nEnd", Published: true, PublishedAt: "2026-10-10T12:00:00Z", UpdatedAt: "2026-10-10T12:00:00Z"}
	committed, err := g.Publish(context.Background(), p, BlogPost{})
	if err != nil || writes != 1 || committed.CommitURL != "https://github.com/owner/repo/commit/abc123" {
		t.Fatal(committed, err, writes)
	}
	decoded, _ := base64.StdEncoding.DecodeString(content)
	stored, err := decodeBlogFile(decoded)
	if err != nil || !sameBlogContent(stored, p) {
		t.Fatal("Markdown snapshot lost content", err)
	}
	p.UpdatedAt = "2026-10-11T12:00:00Z"
	recovered, err := g.Publish(context.Background(), p, BlogPost{})
	if err != nil || writes != 1 || recovered.UpdatedAt != committed.UpdatedAt {
		t.Fatal("retry created a new revision", err, recovered)
	}
	p.Body = "Updated body"
	committed, err = g.Publish(context.Background(), p, committed)
	if err != nil || writes != 2 || committed.PublishedAt != p.PublishedAt {
		t.Fatal("update failed", err)
	}
	sha = "external-edit"
	p.Body = "Overwrite"
	if _, err := g.Publish(context.Background(), p, committed); err == nil || writes != 2 {
		t.Fatal("overwrote external change")
	}
	sha = committed.GithubSHA
	if err := g.Remove(context.Background(), committed); err != nil {
		t.Fatal(err)
	}
	if err := g.Remove(context.Background(), committed); err != nil || deletes != 1 {
		t.Fatal("removal retry failed", err)
	}
}

func TestBlogPublishingDatesFailuresAndStaleEditors(t *testing.T) {
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	h := NewBlogHandler(conn)
	fake := &testBlogPublisher{}
	h.publisher = fake
	call := func(method string, p BlogPost) *httptest.ResponseRecorder {
		data, _ := json.Marshal(p)
		w := httptest.NewRecorder()
		h.Handle(w, httptest.NewRequest(method, "/api/admin/blog", strings.NewReader(string(data))), true)
		return w
	}
	read := func(id int64) BlogPost {
		var p BlogPost
		if err := scanBlog(conn.QueryRow(`SELECT `+blogColumns+` FROM blog_posts WHERE id=?`, id), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	p := BlogPost{Title: "Story", Slug: "story", Body: "First", Published: true, PublishedAt: "forged", UpdatedAt: "forged", CommitURL: "forged"}
	if w := call("POST", p); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	first := read(1)
	if first.PublishedAt == "forged" || first.PublishedAt == "" || first.CommitURL == "forged" {
		t.Fatal("untrusted metadata stored", first)
	}
	p = first
	p.Body = "Second"
	if w := call("POST", p); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	second := read(1)
	if second.PublishedAt != first.PublishedAt || second.UpdatedAt == first.UpdatedAt {
		t.Fatal("incorrect dates")
	}
	if w := call("POST", p); w.Code != 409 || fake.publishes != 2 {
		t.Fatal("stale editor accepted")
	}
	fake.err = errors.New("GitHub unavailable")
	p = second
	p.Body = "Should not become live"
	if w := call("POST", p); w.Code != 502 {
		t.Fatal(w.Body.String())
	}
	if read(1).Body != "Second" || read(1).UpdatedAt != second.UpdatedAt {
		t.Fatal("failed commit changed live post")
	}
	p = BlogPost{Title: "New", Slug: "new", Body: "Private", Published: true}
	w := call("POST", p)
	var failure struct {
		ID        int64  `json:"id"`
		UpdatedAt string `json:"updated_at"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &failure)
	if w.Code != 502 || failure.ID == 0 || read(failure.ID).Published {
		t.Fatal("failed publish did not reserve private retry draft", w.Body.String())
	}
	fake.err = nil
	p = read(failure.ID)
	p.Published = true
	if w := call("POST", p); w.Code != 200 {
		t.Fatal("retry failed", w.Body.String())
	}
	p = read(1)
	p.Published = false
	if w := call("POST", p); w.Code != 200 || fake.removes != 1 {
		t.Fatal("unpublish failed", w.Body.String())
	}
	p = read(1)
	if p.PublishedAt != first.PublishedAt || p.GithubSHA != "" {
		t.Fatal("unpublish lost original date")
	}
	p.Published = true
	if w := call("POST", p); w.Code != 200 || read(1).PublishedAt != first.PublishedAt {
		t.Fatal("republish changed original date")
	}
	h.publisher = nil
	p = read(1)
	p.Body = "Not configured"
	if w := call("POST", p); w.Code != 503 || read(1).Body != "Second" {
		t.Fatal("publishing without credentials succeeded")
	}
}

func TestBlogCommitMigrationPreservesOldPosts(t *testing.T) {
	conn, _ := sql.Open("sqlite", ":memory:")
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	_, err := conn.Exec(`CREATE TABLE blog_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL, published_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO blog_posts VALUES(1,'Old','old','','Body',1,'2020-01-01T00:00:00Z','2021-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if !NewBlogHandler(conn).ready {
			t.Fatal("migration failed")
		}
	}
	var p BlogPost
	if err := scanBlog(conn.QueryRow(`SELECT `+blogColumns+` FROM blog_posts`), &p); err != nil || p.PublishedAt != "2020-01-01T00:00:00Z" || p.Body != "Body" {
		t.Fatal(p, err)
	}
}
