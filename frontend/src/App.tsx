import type { Component } from "solid-js";
import { createSignal, onMount } from "solid-js";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import About from "./components/About";
import Experience from "./components/Experience";
import Projects from "./components/Projects";
import Skills from "./components/Skills";
import Contact from "./components/Contact";

const App: Component = () => {
  const [activeSection, setActiveSection] = createSignal("Home");

  // Scroll to section when navigation item is selected
  const handleSectionChange = (section: string) => {
    const element = document.getElementById(section.toLowerCase());
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(section);
    }
  };

  // Observe sections to update active navigation based on scroll position
  onMount(() => {
    const sections = ["home", "about", "experience", "projects", "skills", "contact"];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const sectionName = entry.target.id.charAt(0).toUpperCase() + entry.target.id.slice(1);
            setActiveSection(sectionName);
          }
        });
      },
      {
        threshold: 0.3,
      }
    );

    sections.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  });

  return (
    <div class="flex min-h-screen">
      <Navbar onSelect={handleSectionChange} />
      <main class="flex-1 md:ml-0">
        <Hero />
        <About />
        <Experience />
        <Projects />
        <Skills />
        <Contact />
      </main>
    </div>
  );
};

export default App;
