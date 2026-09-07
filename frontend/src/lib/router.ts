import { createSignal } from "solid-js";

// Minimal path-based router. The site only needs "is this /budget or not",
// so this avoids pulling in a routing dependency. Caddy already falls back to
// index.html for unknown paths, so deep links work in production.
//
// In production the budget tool is served from its own hostname
// (budget.example.com) rather than a path on the portfolio, so that the public
// site and the ledger are separate origins. One bundle serves both, so the
// root path on that hostname has to resolve to /budget — otherwise the
// dedicated host would render the portfolio.

/** True when this page is being served from the dedicated budget hostname. */
export const isBudgetHost = (): boolean => window.location.hostname.split(".")[0] === "budget";

const resolve = (pathname: string): string =>
  isBudgetHost() && pathname === "/" ? "/budget" : pathname;

const [path, setPath] = createSignal(resolve(window.location.pathname));

window.addEventListener("popstate", () => setPath(resolve(window.location.pathname)));

export const navigate = (to: string) => {
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  setPath(resolve(to));
};

export { path };
