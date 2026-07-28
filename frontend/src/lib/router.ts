import { createSignal } from "solid-js";

// Minimal path-based router. The site only needs "is this /budget or not",
// so this avoids pulling in a routing dependency. Caddy already falls back to
// index.html for unknown paths, so deep links work in production.
const [path, setPath] = createSignal(window.location.pathname);

window.addEventListener("popstate", () => setPath(window.location.pathname));

export const navigate = (to: string) => {
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  setPath(to);
};

export { path };
