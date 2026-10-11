import { loadToken, saveToken, clearToken } from "../budget/api";
import BlogProse from "./BlogProse";
import BlogMetadata from "./BlogMetadata";
import { createSignal, For, onMount, Show } from "solid-js";
import "./blog.css";

type Post = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  published: boolean;
  published_at: string;
  updated_at: string;
  commit_url?: string;
  github_sha?: string;
};
const empty = (): Post => ({
  id: 0,
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  published: false,
  published_at: "",
  updated_at: "",
});
// Public articles and preview use the same sanitized Markdown renderer.
const Article = (props: { post: Post }) => (
  <article class="blog-article">
    <span class="blog-eyebrow">FIELD NOTES / PARTH SHARMA</span>
    <h1>{props.post.title || "Untitled story"}</h1>
    <BlogMetadata post={props.post} />
    <p class="blog-deck">{props.post.excerpt}</p>
    <BlogProse body={props.post.body} />
  </article>
);

export default function Blog(props: { editor?: boolean }) {
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [post, setPost] = createSignal<Post>(empty());
  const [token, setToken] = createSignal(props.editor ? loadToken() : "");
  const [password, setPassword] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [preview, setPreview] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  let bodyInput: HTMLTextAreaElement | undefined;
  function format(before: string, after = "", placeholder = "text") {
    if (!bodyInput) return;
    const start = bodyInput.selectionStart,
      end = bodyInput.selectionEnd;
    const selected = post().body.slice(start, end) || placeholder;
    update(
      "body",
      post().body.slice(0, start) + before + selected + after + post().body.slice(end)
    );
    queueMicrotask(() => {
      bodyInput?.focus();
      bodyInput?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }
  function link(image = false) {
    const url = prompt(
      image ? "Image URL (HTTPS)" : "Link URL (HTTPS or /blog/post-slug)",
      image ? "https://" : "/blog/"
    );
    if (!url) return;
    try {
      const internal = !image && /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*(?:#[\w-]+)?$/.test(url);
      if (!internal && new URL(url).protocol !== "https:") throw new Error();
    } catch {
      setMessage(
        image ? "Please enter a valid HTTPS URL." : "Enter an HTTPS URL or /blog/post-slug."
      );
      return;
    }
    const safe = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
    format(image ? "![" : "[", `](${safe})`, image ? "Describe the image" : "Link text");
  }
  const endpoint = () => (props.editor ? "/api/admin/blog" : "/api/blog");
  async function request(url: string, method = "GET", body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-Admin-Token": token() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      // A first publish can reserve a private draft before GitHub fails.
      // Keep its durable ID/version so retrying uses the same repository file.
      if (method === "POST" && url === endpoint() && data.id && data.updated_at) {
        setPost((p) => ({ ...p, id: data.id, updated_at: data.updated_at }));
      }
      if (res.status === 401) {
        clearToken();
        setToken("");
      }
      throw new Error(data.error || "Request failed");
    }
    return data;
  }
  async function load() {
    const suffix =
      !props.editor && location.pathname.startsWith("/blog/")
        ? `?slug=${encodeURIComponent(location.pathname.slice(6))}`
        : "";
    setPosts(await request(endpoint() + suffix));
    setLoaded(true);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  onMount(() => {
    if (!props.editor || token()) void run(load);
  });
  function edit(p: Post) {
    if (dirty() && !confirm("Discard unsaved edits?")) return;
    setPost({ ...p });
    setDirty(false);
    setPreview(false);
    setMessage("");
  }
  function update(field: "title" | "slug" | "excerpt" | "body", value: string) {
    setPost((p) => ({ ...p, [field]: value }));
    setDirty(true);
  }
  async function save(published: boolean) {
    await run(async () => {
      const result = await request(endpoint(), "POST", { ...post(), published });
      await load();
      const saved = posts().find((p) => p.id === result.id);
      if (saved) setPost(saved);
      setDirty(false);
      setMessage(
        published
          ? "Committed to GitHub. Your story is live."
          : "Draft saved. Only you can see it here; earlier published versions remain in GitHub history."
      );
    });
  }
  return (
    <div class="blog-shell">
      <header class="blog-top">
        <a href="/">← {props.editor ? "Budget home" : "Portfolio"}</a>
        <span>pipboi / {props.editor ? "writing desk" : "journal"}</span>
        <Show when={props.editor && token()}>
          <nav class="blog-app-switch" aria-label="Private apps">
            <a
              href="/budget"
              onClick={(e) => {
                if (dirty() && !confirm("Discard unsaved edits?")) e.preventDefault();
              }}>
              Budget
            </a>
            <a href="/cms" aria-current="page">
              CMS
            </a>
          </nav>
          <button
            onClick={() => {
              if (!dirty() || confirm("Discard unsaved edits and sign out?")) {
                setToken("");
                setPosts([]);
                setPost(empty());
                setDirty(false);
              }
            }}>
            Sign out
          </button>
        </Show>
      </header>
      <Show when={message()}>
        <p class="blog-message" role="status">
          {message()}
        </p>
      </Show>
      <Show when={!props.editor}>
        <Show
          when={!location.pathname.startsWith("/blog/")}
          fallback={
            <Show
              when={posts()[0]}
              fallback={<p>{loaded() ? "Story not found or unpublished." : "Loading story…"}</p>}>
              <Article post={posts()[0]} />
            </Show>
          }>
          <div class="blog-intro">
            <span class="blog-eyebrow">IDEAS, BUILDS & THINGS LEARNED</span>
            <h1>
              Field notes<span>.</span>
            </h1>
            <p>A journal of experiments, lessons, and things worth sharing.</p>
          </div>
          <div class="blog-grid">
            <For each={posts()}>
              {(p) => (
                <a class="blog-card" href={`/blog/${p.slug}`}>
                  <span class="blog-eyebrow">
                    {Math.max(1, Math.ceil(p.body.split(/\s+/).length / 200))} MIN READ
                  </span>
                  <h2>{p.title}</h2>
                  <BlogMetadata post={p} link={false} />
                  <p>{p.excerpt}</p>
                  <span class="blog-read">Read story ↗</span>
                </a>
              )}
            </For>
          </div>
          <Show when={loaded() && !posts().length}>
            <p class="blog-empty">The notebook is open. First story coming soon.</p>
          </Show>
        </Show>
      </Show>
      <Show when={props.editor}>
        <Show
          when={token()}
          fallback={
            <form
              class="blog-login"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const auth = await request("/api/admin/auth", "POST", { password: password() });
                  saveToken(auth.token, false);
                  setToken(auth.token);
                  setPassword("");
                  await load();
                });
              }}>
              <span class="blog-eyebrow">PRIVATE WRITING DESK</span>
              <h1>Make yourself heard.</h1>
              <p>Sign in to write, revise, and publish your stories.</p>
              <label>
                Admin password
                <input
                  type="password"
                  autocomplete="current-password"
                  required
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
              </label>
              <button disabled={busy()} type="submit">
                {busy() ? "Signing in…" : "Open writing desk →"}
              </button>
            </form>
          }>
          <div class="blog-workspace">
            <aside class="blog-sidebar">
              <button class="blog-primary" onClick={() => edit(empty())}>
                + New story
              </button>
              <h2>Your notebook</h2>
              <For each={posts()}>
                {(p) => (
                  <button
                    class={`blog-post-choice ${post().id === p.id ? "selected" : ""}`}
                    onClick={() => edit(p)}>
                    <strong>{p.title}</strong>
                    <span>{p.published ? "Published" : "Draft"}</span>
                  </button>
                )}
              </For>
            </aside>
            <section class="blog-editor">
              <div class="blog-toolbar">
                <span>
                  {dirty()
                    ? "Unsaved changes"
                    : post().published
                      ? "Published story"
                      : "Draft story"}
                </span>
                <button onClick={() => setPreview((v) => !v)}>
                  {preview() ? "Edit" : "Preview"}
                </button>
              </div>
              <Show when={!preview()} fallback={<Article post={post()} />}>
                <label>
                  Title
                  <input
                    placeholder="A story worth telling"
                    maxlength="200"
                    value={post().title}
                    onInput={(e) => update("title", e.currentTarget.value)}
                  />
                </label>
                <label>
                  URL slug
                  <div class="blog-slug">
                    <span>/blog/</span>
                    <input
                      placeholder="my-first-story"
                      value={post().slug}
                      onInput={(e) => update("slug", e.currentTarget.value)}
                    />
                  </div>
                </label>
                <label>
                  Short introduction
                  <textarea
                    rows="2"
                    maxlength="600"
                    placeholder="Give readers a reason to stay."
                    value={post().excerpt}
                    onInput={(e) => update("excerpt", e.currentTarget.value)}
                  />
                </label>
                <div class="blog-format-bar" role="group" aria-label="Story formatting">
                  <button type="button" onClick={() => format("**", "**")}>
                    Bold
                  </button>
                  <button type="button" onClick={() => format("*", "*")}>
                    Italic
                  </button>
                  <button type="button" onClick={() => format("\n\n## ", "\n\n", "Heading")}>
                    Heading
                  </button>
                  <button type="button" onClick={() => link()}>
                    Link
                  </button>
                  <button type="button" onClick={() => link(true)}>
                    Image
                  </button>
                  <button type="button" onClick={() => format("\n\n- ", "\n\n", "List item")}>
                    Bullets
                  </button>
                  <button type="button" onClick={() => format("\n\n1. ", "\n\n", "List item")}>
                    Numbered list
                  </button>
                  <button type="button" onClick={() => format("\n\n> ", "\n\n", "Quote")}>
                    Quote
                  </button>
                  <button
                    type="button"
                    onClick={() => format("\n\n```\n", "\n```\n\n", "Your code")}>
                    Code block
                  </button>
                </div>
                <p class="blog-format-hint">
                  Select text and choose formatting. Preview shows the published layout. Images use
                  a hosted HTTPS URL. Link to another story with /blog/post-slug. Paste emojis or
                  press Windows + . to open the emoji picker.
                </p>
                <p class="blog-format-hint">
                  Publishing saves a Markdown version in GitHub. Drafts stay private; published
                  versions remain in GitHub history even after unpublishing or deleting a story.
                </p>
                <label>
                  Story
                  <textarea
                    ref={bodyInput}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && ["b", "i"].includes(e.key.toLowerCase())) {
                        e.preventDefault();
                        const marker = e.key.toLowerCase() === "b" ? "**" : "*";
                        format(marker, marker);
                      }
                    }}
                    class="blog-body"
                    rows="16"
                    placeholder="Start writing… Separate paragraphs with a blank line. Plain text is supported; HTML is displayed as text."
                    value={post().body}
                    onInput={(e) => update("body", e.currentTarget.value)}
                  />
                </label>
              </Show>
              <div class="blog-actions">
                <button disabled={busy()} onClick={() => void save(false)}>
                  {post().published ? "Unpublish & save draft" : "Save draft"}
                </button>
                <button
                  class="blog-primary"
                  disabled={busy()}
                  onClick={() => {
                    if (confirm("Commit this story to GitHub and publish it on your portfolio?"))
                      void save(true);
                  }}>
                  Commit & publish ↗
                </button>
                <Show when={post().id}>
                  <button
                    class="blog-delete"
                    disabled={busy()}
                    onClick={() => {
                      if (
                        confirm(
                          "Delete this story from the site and remove its current GitHub file? Earlier published versions remain in GitHub history."
                        )
                      )
                        void run(async () => {
                          await request(endpoint(), "DELETE", {
                            id: post().id,
                            updated_at: post().updated_at,
                          });
                          setPost(empty());
                          setDirty(false);
                          await load();
                          setMessage("Story deleted.");
                        });
                    }}>
                    Delete
                  </button>
                </Show>
              </div>
            </section>
          </div>
        </Show>
      </Show>
    </div>
  );
}
