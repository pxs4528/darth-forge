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
// Render text through Solid's escaping, never innerHTML. Blank lines form paragraphs.
const Article = (props: { post: Post }) => (
  <article class="blog-article">
    <span class="blog-eyebrow">FIELD NOTES / PARTH SHARMA</span>
    <h1>{props.post.title || "Untitled story"}</h1>
    <p class="blog-deck">{props.post.excerpt}</p>
    <div class="blog-prose">
      <For each={props.post.body.split(/\n\s*\n/)}>{(paragraph) => <p>{paragraph}</p>}</For>
    </div>
  </article>
);

export default function Blog(props: { editor?: boolean }) {
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [post, setPost] = createSignal<Post>(empty());
  const [token, setToken] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [preview, setPreview] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const endpoint = () => (props.editor ? "/api/admin/blog" : "/api/blog");
  async function request(url: string, method = "GET", body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-Admin-Token": token() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) setToken("");
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
    if (!props.editor) void run(load);
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
        published ? "Published. Your story is live." : "Draft saved. Only you can see it."
      );
    });
  }
  return (
    <div class="blog-shell">
      <header class="blog-top">
        <a href="/">← {props.editor ? "Budget home" : "Portfolio"}</a>
        <span>pipboi / {props.editor ? "writing desk" : "journal"}</span>
        <Show when={props.editor && token()}>
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
                    {p.published_at.slice(0, 10)} ·{" "}
                    {Math.max(1, Math.ceil(p.body.split(/\s+/).length / 200))} MIN READ
                  </span>
                  <h2>{p.title}</h2>
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
                <label>
                  Story
                  <textarea
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
                    if (confirm("Publish this story on your public portfolio?")) void save(true);
                  }}>
                  Publish story ↗
                </button>
                <Show when={post().id}>
                  <button
                    class="blog-delete"
                    disabled={busy()}
                    onClick={() => {
                      if (confirm("Permanently delete this story?"))
                        void run(async () => {
                          await request(endpoint(), "DELETE", { id: post().id });
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
