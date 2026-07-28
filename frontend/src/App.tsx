import type { Component } from "solid-js";
import { createSignal, onMount, Show } from "solid-js";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import About from "./components/About";
import Experience from "./components/Experience";
import Projects from "./components/Projects";
import Skills from "./components/Skills";
import Contact from "./components/Contact";
import Logs from "./components/Logs";
import CryptoTools from "./components/CryptoTools";
import Terminal from "./components/Terminal";
import USCISAdmin from "./components/USCISAdmin";
import BudgetPage from "./budget/BudgetPage";
import { path } from "./lib/router";
import { telemetry } from "./services/telemetry";

const App: Component = () => {
  const [adminToken, setAdminToken] = createSignal("");

  onMount(() => {
    telemetry.trackPageView(path() === "/budget" ? "budget" : "home");
  });

  return (
    <Show when={path() !== "/budget"} fallback={<BudgetPage />}>
      <div class="min-h-screen bg-black">
        <Navbar />
        <main>
          <Hero />
          <About />
          <Experience />
          <Projects />
          <Skills />
          <Contact />
          <CryptoTools />
          <Logs />
        </main>
        <Terminal onAdminLogin={setAdminToken} />
        <Show when={adminToken()}>
          <USCISAdmin token={adminToken()} onClose={() => setAdminToken("")} />
        </Show>
      </div>
    </Show>
  );
};

export default App;
