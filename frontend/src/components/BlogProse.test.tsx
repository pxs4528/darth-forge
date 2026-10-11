import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import BlogProse from "./BlogProse";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function focusLink(name: string) {
  fireEvent.focusIn(screen.getByRole("link", { name }));
  await vi.advanceTimersByTimeAsync(1);
}

describe("blog link previews", () => {
  it("loads a published internal post on focus, sanitizes it, and closes with Escape", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          title: "Another story 🚀",
          excerpt: "Introduction",
          body: '**Hello**<img src="x" onerror="alert(1)">',
        },
      ],
    });
    vi.stubGlobal("fetch", fetcher);
    render(() => <BlogProse body="[Read more](/blog/another-story)" />);
    await focusLink("Read more");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/blog?slug=another-story",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    const preview = screen.getByRole("region", { name: "Linked story preview" });
    expect(preview.textContent).toContain("Another story 🚀");
    expect(preview.querySelector("strong")?.textContent).toBe("Hello");
    expect(preview.innerHTML).not.toContain("onerror");
    expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
      "/blog/another-story"
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("ignores external and non-post links", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(() => <BlogProse body="[External](https://elsewhere.example/blog/story) [Home](/)" />);
    await focusLink("External");
    await focusLink("Home");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("delays hover loading and lets readers move into and scroll the preview", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetcher);
    render(() => <BlogProse body="[Story](/blog/story)" />);
    const link = screen.getByRole("link");
    fireEvent.pointerOver(link);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    const preview = screen.getByRole("region");
    expect(preview.textContent).toContain("unavailable or unpublished");
    fireEvent.pointerOut(link, { relatedTarget: preview });
    fireEvent.pointerEnter(preview);
    fireEvent.scroll(preview);
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole("region")).toBe(preview);
    fireEvent.pointerOut(preview);
    await vi.advanceTimersByTimeAsync(250);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("does not reopen a dismissed preview when its request finishes", async () => {
    vi.useFakeTimers();
    let resolve!: (response: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
    );
    render(() => <BlogProse body="[Story](/blog/story)" />);
    await focusLink("Story");
    fireEvent.keyDown(document, { key: "Escape" });
    resolve({ ok: true, json: async () => [{ title: "Late", body: "Content", excerpt: "" }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps the link usable when loading fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(() => <BlogProse body="[Story](/blog/story)" />);
    await focusLink("Story");
    expect(screen.getByRole("status").textContent).toContain("Preview unavailable");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/blog/story");
  });
});
