import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import BlogMetadata from "./BlogMetadata";

afterEach(cleanup);

it("shows original publication and update dates with semantic timestamps and a commit link", () => {
  const { container } = render(() => (
    <BlogMetadata
      post={{
        published_at: "2026-10-01T00:30:00Z",
        updated_at: "2026-10-10T13:00:00Z",
        commit_url: "https://github.com/owner/repo/commit/abc123",
      }}
    />
  ));
  expect(screen.getByText(/Published/).textContent).toContain("Oct 1, 2026");
  expect(screen.getByText(/Last updated/).textContent).toContain("Oct 10, 2026");
  expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-01T00:30:00Z");
  expect(screen.getByRole("link").getAttribute("href")).toContain("/commit/abc123");
});

it("hides dates for drafts and rejects unsafe commit links", () => {
  const { container } = render(() => (
    <BlogMetadata
      post={{ published_at: "", updated_at: "bad", commit_url: "javascript:alert(1)" }}
    />
  ));
  expect(container.textContent).toBe("");
  expect(screen.queryByRole("link")).toBeNull();
});

it("avoids nested links on article cards", () => {
  render(() => (
    <BlogMetadata
      link={false}
      post={{
        published_at: "2026-10-01T00:00:00Z",
        commit_url: "https://github.com/owner/repo/commit/abc123",
      }}
    />
  ));
  expect(screen.queryByRole("link")).toBeNull();
});
