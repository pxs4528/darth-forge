package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type blogPublisher interface {
	Publish(context.Context, BlogPost, BlogPost) (BlogPost, error)
	Remove(context.Context, BlogPost) error
}

type githubBlogPublisher struct {
	token, repo, branch, baseURL string
	client                       *http.Client
}

func newGithubBlogPublisher() blogPublisher {
	token := os.Getenv("BLOG_GITHUB_TOKEN")
	repo := os.Getenv("BLOG_GITHUB_REPOSITORY")
	branch := os.Getenv("BLOG_GITHUB_BRANCH")
	if repo == "" {
		repo = "pxs4528/darth-forge"
	}
	if branch == "" {
		branch = "main"
	}
	if token == "" || !regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`).MatchString(repo) {
		return nil
	}
	return &githubBlogPublisher{token: token, repo: repo, branch: branch, baseURL: "https://api.github.com", client: &http.Client{Timeout: 20 * time.Second}}
}

// Stable IDs keep all slug/title changes in the same file's Git history.
func blogFile(id int64) string { return "content/blog/" + strconv.FormatInt(id, 10) + ".md" }

type blogFileMetadata struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	Excerpt     string `json:"excerpt"`
	PublishedAt string `json:"published_at"`
	UpdatedAt   string `json:"updated_at"`
}

func encodeBlogFile(p BlogPost) []byte {
	meta, _ := json.MarshalIndent(blogFileMetadata{p.ID, p.Title, p.Slug, p.Excerpt, p.PublishedAt, p.UpdatedAt}, "", "  ")
	// JSON is valid YAML, allowing quoted strings and emoji without hand escaping.
	return []byte("---\n" + string(meta) + "\n---\n\n" + p.Body)
}

func decodeBlogFile(data []byte) (BlogPost, error) {
	parts := strings.SplitN(strings.TrimPrefix(string(data), "---\n"), "\n---\n\n", 2)
	var meta blogFileMetadata
	if len(parts) != 2 || json.Unmarshal([]byte(parts[0]), &meta) != nil {
		return BlogPost{}, errors.New("invalid blog file")
	}
	if _, err := time.Parse(time.RFC3339Nano, meta.PublishedAt); err != nil {
		return BlogPost{}, errors.New("invalid publication date")
	}
	if _, err := time.Parse(time.RFC3339Nano, meta.UpdatedAt); err != nil {
		return BlogPost{}, errors.New("invalid update date")
	}
	return BlogPost{ID: meta.ID, Title: meta.Title, Slug: meta.Slug, Excerpt: meta.Excerpt, Body: parts[1], Published: true, PublishedAt: meta.PublishedAt, UpdatedAt: meta.UpdatedAt}, nil
}

func sameBlogContent(a, b BlogPost) bool {
	return a.ID == b.ID && a.Title == b.Title && a.Slug == b.Slug && a.Excerpt == b.Excerpt && a.Body == b.Body
}

func (g *githubBlogPublisher) request(ctx context.Context, method, path string, body any, result any) (int, error) {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return 0, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, g.baseURL+"/repos/"+g.repo+path, &buf)
	if err != nil {
		return 0, errors.New("could not prepare GitHub request")
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("Content-Type", "application/json")
	res, err := g.client.Do(req)
	if err != nil {
		return 0, errors.New("GitHub could not be reached; retry publishing")
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return res.StatusCode, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return res.StatusCode, fmt.Errorf("GitHub rejected the change (HTTP %d); check the blog token, repository access, and branch rules", res.StatusCode)
	}
	if result != nil {
		if err := json.NewDecoder(io.LimitReader(res.Body, 2*1024*1024)).Decode(result); err != nil {
			return res.StatusCode, errors.New("invalid GitHub response; retry publishing")
		}
	}
	return res.StatusCode, nil
}

type githubFile struct {
	SHA     string `json:"sha"`
	Content string `json:"content"`
}

func (g *githubBlogPublisher) Publish(ctx context.Context, p, previous BlogPost) (BlogPost, error) {
	path := "/contents/" + blogFile(p.ID)
	var file githubFile
	status, err := g.request(ctx, "GET", path+"?ref="+url.QueryEscape(g.branch), nil, &file)
	if err != nil {
		return p, err
	}
	if status == 200 {
		data, decodeErr := base64.StdEncoding.DecodeString(strings.ReplaceAll(file.Content, "\n", ""))
		existing, parseErr := decodeBlogFile(data)
		// Recover safely if GitHub accepted the previous attempt but the response
		// or database write failed. Repeated Publish also creates no empty commits.
		if decodeErr == nil && parseErr == nil && sameBlogContent(existing, p) && (previous.PublishedAt == "" || existing.PublishedAt == previous.PublishedAt) {
			var commits []struct {
				SHA string `json:"sha"`
			}
			_, err = g.request(ctx, "GET", "/commits?sha="+url.QueryEscape(g.branch)+"&path="+url.QueryEscape(blogFile(p.ID))+"&per_page=1", nil, &commits)
			if err != nil || len(commits) == 0 {
				return p, errors.New("could not verify the existing GitHub commit; retry publishing")
			}
			existing.GithubSHA = file.SHA
			existing.CommitURL = "https://github.com/" + g.repo + "/commit/" + commits[0].SHA
			return existing, nil
		}
		if file.SHA != previous.GithubSHA || previous.GithubSHA == "" {
			return p, errors.New("the blog file changed directly in GitHub; reconcile that change before publishing from the writing desk")
		}
	} else if previous.GithubSHA != "" {
		return p, errors.New("the blog file is missing from GitHub; restore it before publishing")
	}
	verb := "Publish"
	if previous.PublishedAt != "" {
		verb = "Update"
	}
	body := map[string]any{"message": verb + " blog: " + p.Title, "content": base64.StdEncoding.EncodeToString(encodeBlogFile(p)), "branch": g.branch}
	if file.SHA != "" {
		body["sha"] = file.SHA
	}
	var result struct {
		Content githubFile `json:"content"`
		Commit  struct {
			SHA string `json:"sha"`
		} `json:"commit"`
	}
	status, err = g.request(ctx, "PUT", path, body, &result)
	if err != nil {
		return p, err
	}
	if status == 404 || result.Content.SHA == "" || result.Commit.SHA == "" {
		return p, errors.New("GitHub did not confirm the commit; check repository access and retry")
	}
	p.GithubSHA = result.Content.SHA
	p.CommitURL = "https://github.com/" + g.repo + "/commit/" + result.Commit.SHA
	return p, nil
}

func (g *githubBlogPublisher) Remove(ctx context.Context, p BlogPost) error {
	path := "/contents/" + blogFile(p.ID)
	var file githubFile
	status, err := g.request(ctx, "GET", path+"?ref="+url.QueryEscape(g.branch), nil, &file)
	if err != nil {
		return err
	}
	if status == 404 {
		// A private repository can also return 404 when access has been revoked.
		// Verify the branch is still readable before treating a missing file as
		// an already completed removal.
		status, err = g.request(ctx, "GET", "/branches/"+url.PathEscape(g.branch), nil, nil)
		if err != nil {
			return err
		}
		if status != 200 {
			return errors.New("could not verify the GitHub branch; the post has not been removed")
		}
		return nil
	} // Retrying an already committed removal.
	if file.SHA != p.GithubSHA {
		return errors.New("the blog file changed directly in GitHub; reconcile it before removing the post")
	}
	status, err = g.request(ctx, "DELETE", path, map[string]any{"message": "Unpublish blog: " + p.Title, "sha": file.SHA, "branch": g.branch}, nil)
	if err == nil && status != 200 {
		return errors.New("GitHub did not confirm removal; retry")
	}
	return err
}
