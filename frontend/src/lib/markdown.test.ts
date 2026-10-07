import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("blog Markdown", () => {
  it("renders headings, emphasis, lists, and fenced code", () => {
    const html = renderMarkdown(
      "## Heading\n\n**Bold** and *italic*\n\n- item\n\n```js\nconst x = 1;\n```"
    );
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain("<pre><code");
  });
  it("removes scripts, handlers, unsafe links and embedded frames", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">click</a><iframe src="https://example.com"></iframe>'
    );
    expect(html).not.toMatch(/<script|onerror|javascript:|<iframe/);
  });
  it("retains safe links and images", () => {
    const html = renderMarkdown(
      "[Example](https://example.com)\n\n![Alt](https://example.com/photo.jpg)"
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('alt="Alt"');
  });
});
