import type { Component } from "solid-js";
import { onMount } from "solid-js";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import About from "./components/About";
import Experience from "./components/Experience";
import Projects from "./components/Projects";
import Skills from "./components/Skills";
import Contact from "./components/Contact";
import Logs from "./components/Logs";
import Terminal from "./components/Terminal";
import { telemetry } from "./services/telemetry";

const App: Component = () => {
  onMount(() => {
    // Track initial page view
    telemetry.trackPageView("home");
  });

  return (
    <div class="min-h-screen bg-black">
      <Navbar />
      <main>
        <Hero />
        <About />
        <Experience />
        <Projects />
        <Skills />
        <Contact />
        <Logs />
      </main>
      <Terminal />
    </div>
  );
};

export default App;
