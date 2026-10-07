import { Show } from "solid-js";
import Blog from "./components/Blog";
import Portfolio from "./components/Portfolio";
import BudgetPage from "./budget/BudgetPage";
import { path } from "./lib/router";

export default function App() {
  return (
    <Show when={path() !== "/budget"} fallback={<BudgetPage />}>
      <Show
        when={path() !== "/cms" && path() !== "/blog" && !path().startsWith("/blog/")}
        fallback={<Blog editor={path() === "/cms"} />}>
        <Portfolio />
      </Show>
    </Show>
  );
}
