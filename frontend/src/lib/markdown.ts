import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: false }), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
      "del",
      "a",
      "img",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "start"],
    ALLOW_DATA_ATTR: false,
  });
}
