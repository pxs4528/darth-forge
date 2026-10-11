import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import BlogMetadata, { type BlogDates } from "./BlogMetadata";

type PreviewPost = BlogDates & { title: string; body: string; excerpt: string };

// Only published articles on this site are eligible; external links stay ordinary links.
export function previewSlug(href: string): string | undefined {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    return /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(url.pathname)?.[1];
  } catch {
    return;
  }
}

export default function BlogProse(props: { body: string }) {
  let root!: HTMLDivElement;
  let popup: HTMLDivElement | undefined;
  let active: HTMLAnchorElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  const [visible, setVisible] = createSignal(false);
  const [post, setPost] = createSignal<PreviewPost>();
  const [message, setMessage] = createSignal("");
  const [position, setPosition] = createSignal({ left: "0px", top: "0px" });

  function cancelTimer() {
    clearTimeout(timer);
  }
  function close() {
    cancelTimer();
    generation++;
    controller?.abort();
    active = undefined;
    setVisible(false);
  }
  function positionPopup() {
    if (!active || !popup) return;
    const rect = active.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - 12 ? below : rect.top - height - 8;
    setPosition({
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      top: `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`,
    });
  }
  async function open(link: HTMLAnchorElement, slug: string) {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    active = link;
    setPost(undefined);
    setMessage("Loading preview…");
    setVisible(true);
    positionPopup();
    try {
      const response = await fetch(`/api/blog?slug=${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Preview unavailable");
      const posts: PreviewPost[] = await response.json();
      if (current !== generation) return;
      setPost(posts[0]);
      setMessage(posts[0] ? "" : "This story is unavailable or unpublished.");
    } catch {
      if (current !== generation) return;
      setMessage("Preview unavailable. Follow the link to open the story.");
    }
    positionPopup();
  }
  function enter(event: PointerEvent | FocusEvent) {
    if ("pointerType" in event && event.pointerType === "touch") return;
    const target = event.target;
    if (!(target instanceof Element) || popup?.contains(target)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !root.contains(link)) return;
    const slug = previewSlug(link.href);
    if (!slug) return;
    cancelTimer();
    if (active === link) return;
    close();
    timer = setTimeout(() => void open(link, slug), event.type === "focusin" ? 0 : 220);
  }
  function leave(event: PointerEvent | FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && (active?.contains(next) || popup?.contains(next))) return;
    cancelTimer();
    timer = setTimeout(close, 200);
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const link = active;
    const restoreFocus = popup?.contains(document.activeElement);
    if (restoreFocus) link?.focus();
    close();
  }
  function scroll(event: Event) {
    if (event.target instanceof Node && popup?.contains(event.target)) return;
    close();
  }
  onMount(() => {
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
  });
  onCleanup(() => {
    close();
    document.removeEventListener("keydown", escape);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", scroll, true);
  });

  return (
    <div ref={root} onPointerOver={enter} onPointerOut={leave} onFocusIn={enter} onFocusOut={leave}>
      <div class="blog-prose" innerHTML={renderMarkdown(props.body)} />
      <Show when={visible()}>
        <div
          ref={popup}
          class="blog-link-preview"
          role="region"
          aria-label="Linked story preview"
          tabindex="0"
          style={position()}
          onPointerEnter={cancelTimer}
          onFocusIn={cancelTimer}>
          <div class="blog-preview-top">
            <span class="blog-eyebrow">STORY PREVIEW</span>
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => {
                active?.focus();
                close();
              }}>
              ×
            </button>
          </div>
          <Show when={post()} fallback={<p role="status">{message()}</p>}>
            {(story) => (
              <>
                <h2>{story().title}</h2>
                <BlogMetadata post={story()} />
                <p class="blog-deck">{story().excerpt}</p>
                <div class="blog-prose" innerHTML={renderMarkdown(story().body)} />
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
