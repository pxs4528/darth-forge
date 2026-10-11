import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import Blog from "./Blog";

vi.mock("../budget/api", () => ({
  loadToken: () => "test-token",
  saveToken: vi.fn(),
  clearToken: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const story = {
  id: 1,
  title: "A story",
  slug: "a-story",
  excerpt: "Intro",
  body: "Text",
  published: true,
  published_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
};

it("sends the loaded version when deleting a story", async () => {
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => ({
    ok: true,
    json: async () => (options.method === "DELETE" ? { deleted: true } : [story]),
  }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("confirm", () => true);
  render(() => <Blog editor />);
  fireEvent.click(await screen.findByRole("button", { name: /A story/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/blog",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ id: 1, updated_at: story.updated_at }),
      })
    )
  );
});

it("retries a failed first publish with the reserved draft ID and version", async () => {
  const writes: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    if (options.method === "POST") {
      writes.push(JSON.parse(options.body as string));
      return {
        ok: false,
        status: 502,
        json: async () => ({ error: "GitHub unavailable", id: 7, updated_at: story.updated_at }),
      };
    }
    return { ok: true, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("confirm", () => true);
  render(() => <Blog editor />);
  fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New story" } });
  fireEvent.input(screen.getByLabelText(/URL slug/), { target: { value: "new-story" } });
  fireEvent.input(screen.getByLabelText("Story"), { target: { value: "Body" } });
  const publish = screen.getByRole("button", { name: /Commit & publish/ });
  await waitFor(() => expect(publish).not.toBeDisabled());
  fireEvent.click(publish);
  await screen.findByText("GitHub unavailable");
  await waitFor(() => expect(publish).not.toBeDisabled());
  fireEvent.click(publish);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].id).toBe(0);
  expect(writes[1]).toMatchObject({ id: 7, updated_at: story.updated_at, title: "New story" });
});
