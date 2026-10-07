import { createSignal, For, onCleanup, Show } from "solid-js";
import "./portfolio.css";

type Section = "about" | "work" | "projects" | "writing" | "contact";
const nodes: { key: Section; label: string; x: number; y: number; z: number }[] = [
  { key: "about", label: "About", x: -205, y: -80, z: 70 },
  { key: "work", label: "Work", x: 170, y: -105, z: -40 },
  { key: "projects", label: "Projects", x: 210, y: 95, z: 90 },
  { key: "writing", label: "Writing", x: -35, y: 155, z: -60 },
  { key: "contact", label: "Contact", x: -215, y: 100, z: -30 },
];
const satellites = [
  { x: -110, y: -170, z: -100 },
  { x: 70, y: -195, z: 80 },
  { x: 280, y: -15, z: -130 },
  { x: 100, y: 190, z: 20 },
  { x: -280, y: -10, z: -80 },
];
export default function Portfolio() {
  const [section, setSection] = createSignal<Section | "">("");
  const [zooming, setZooming] = createSignal(false);
  const [target, setTarget] = createSignal({ x: 0, y: 0 });
  const [angle, setAngle] = createSignal({ x: 0.12, y: -0.2 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heading: HTMLHeadingElement | undefined;
  onCleanup(() => clearTimeout(timer));
  function project(n: { x: number; y: number; z: number }) {
    const a = angle();
    const x = n.x * Math.cos(a.y) + n.z * Math.sin(a.y);
    const z = -n.x * Math.sin(a.y) + n.z * Math.cos(a.y);
    const y = n.y * Math.cos(a.x) - z * Math.sin(a.x);
    const depth = n.y * Math.sin(a.x) + z * Math.cos(a.x);
    const scale = 650 / (650 - depth);
    return { x: 400 + x * scale, y: 240 + y * scale, scale };
  }
  function open(key: Section) {
    if (zooming()) return;
    const node = nodes.find((n) => n.key === key)!;
    const p = project(node);
    setTarget({ x: p.x, y: p.y });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setZooming(!reduced);
    timer = setTimeout(
      () => {
        setSection(key);
        setZooming(false);
        heading?.focus();
      },
      reduced ? 0 : 500
    );
  }
  function back() {
    setSection("");
  }
  return (
    <div class="personal-site">
      <header class="personal-nav">
        <button onClick={back} aria-label="Return to overview">
          Parth Sharma<span> / </span>
        </button>
        <nav aria-label="Sections">
          <For each={nodes}>
            {(n) => (
              <button
                aria-current={section() === n.key ? "page" : undefined}
                onClick={() => open(n.key)}>
                {n.label}
              </button>
            )}
          </For>
        </nav>
      </header>
      <main>
        <Show
          when={!section()}
          fallback={
            <section class="personal-section">
              <button class="back-link" onClick={back}>
                ← Back to overview
              </button>
              <span class="personal-kicker">
                {String(nodes.find((n) => n.key === section())?.label)}
              </span>
              <h1 ref={heading} tabindex="-1">
                {section() === "about"
                  ? "A little about me."
                  : section() === "work"
                    ? "What I work on."
                    : section() === "projects"
                      ? "Things I’ve built."
                      : section() === "writing"
                        ? "Notes along the way."
                        : "Let’s talk."}
              </h1>
              <Show when={section() === "about"}>
                <p>
                  I’m Parth, a software engineer at General Motors. I like building useful things
                  and understanding how they work.
                </p>
                <p>
                  I studied computer science at UT Arlington. Outside work, my interests tend to
                  wander between distributed systems, robotics, compilers, and the servers in my
                  homelab.
                </p>
                <aside class="personal-note">
                  <span>Currently exploring</span>
                  <p>Self-hosting, my Pi setup, and learning to own the software I build.</p>
                </aside>
              </Show>
              <Show when={section() === "work"}>
                <div class="personal-entry">
                  <span>General Motors · Current</span>
                  <h2>Software Engineer</h2>
                  <p>
                    Building full-stack features for the GM Insurance claims platform, modernizing
                    the frontend, and making deployments and tests more dependable.
                  </p>
                </div>
                <div class="personal-entry">
                  <span>UT Arlington · September 2023 — May 2024</span>
                  <h2>Software Engineer & Research Assistant</h2>
                  <p>
                    Built an Android environment-monitoring app and Spring Boot services for sensor
                    data.
                  </p>
                </div>
              </Show>
              <Show when={section() === "projects"}>
                <div class="personal-entry">
                  <span>Go / SolidJS / Docker</span>
                  <h2>This little corner of the internet</h2>
                  <p>
                    My portfolio, a private budget tool, and a self-hosted pipeline. An ongoing
                    lesson in running my own software.
                  </p>
                  <a href="https://github.com/pxs4528/darth-forge">Explore the code ↗</a>
                </div>
                <div class="personal-entry">
                  <span>Java / Scala</span>
                  <h2>JCompile</h2>
                  <p>A compiler built from scratch, from parsing source text to generating code.</p>
                </div>
                <div class="personal-entry">
                  <span>Python / C++ / ROS2</span>
                  <h2>Trailblazer</h2>
                  <p>
                    An autonomous rover using sensor fusion and SLAM to make sense of its
                    surroundings.
                  </p>
                </div>
                <a href="https://github.com/pxs4528">More on GitHub ↗</a>
              </Show>
              <Show when={section() === "writing"}>
                <p>Experiments, lessons learned, and questions I’m still working through.</p>
                <a class="personal-cta" href="/blog">
                  Open the journal →
                </a>
              </Show>
              <Show when={section() === "contact"}>
                <p>Have something in mind, a question, or just want to say hello?</p>
                <a class="personal-email" href="mailto:parthsharma.cs@gmail.com">
                  parthsharma.cs@gmail.com ↗
                </a>
                <div class="personal-social">
                  <a href="https://github.com/pxs4528">GitHub ↗</a>
                  <a href="https://www.linkedin.com/in/parthsharma0310/">LinkedIn ↗</a>
                </div>
              </Show>
            </section>
          }>
          <section class="personal-home">
            <span class="personal-kicker">A small map of my world</span>
            <h1>Parth Sharma</h1>
            <p class="personal-subtitle">Engineer, builder, and a curious person.</p>
            <div
              class={`node-scene ${zooming() ? "is-zooming" : ""}`}
              onPointerMove={(e) => {
                if (zooming()) return;
                if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
                const r = e.currentTarget.getBoundingClientRect();
                setAngle({
                  x: ((e.clientY - r.top) / r.height - 0.5) * 0.45,
                  y: ((e.clientX - r.left) / r.width - 0.5) * 0.7,
                });
              }}
              onPointerLeave={() => setAngle({ x: 0.12, y: -0.2 })}>
              <svg
                viewBox="0 0 800 480"
                role="img"
                aria-label="A three-dimensional graph of my interests. Use the labeled buttons to explore."
                style={{ "transform-origin": `${target().x / 8}% ${target().y / 4.8}%` }}>
                <defs>
                  <radialGradient id="node-halo">
                    <stop stop-color="#c0d3b1" stop-opacity=".24" />
                    <stop offset="1" stop-color="#c0d3b1" stop-opacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="400" cy="240" r="175" fill="url(#node-halo)" />
                <For each={[...nodes, ...satellites]}>
                  {(n) => (
                    <line
                      x1="400"
                      y1="240"
                      x2={project(n).x}
                      y2={project(n).y}
                      stroke="#718871"
                      stroke-opacity=".48"
                      stroke-width="1"
                    />
                  )}
                </For>
                <For each={nodes}>
                  {(n, i) => (
                    <line
                      x1={project(n).x}
                      y1={project(n).y}
                      x2={project(nodes[(i() + 1) % nodes.length]).x}
                      y2={project(nodes[(i() + 1) % nodes.length]).y}
                      stroke="#718871"
                      stroke-opacity=".3"
                    />
                  )}
                </For>
                <For each={satellites}>
                  {(n) => (
                    <circle
                      cx={project(n).x}
                      cy={project(n).y}
                      r={3 * project(n).scale}
                      fill="#687b69"
                    />
                  )}
                </For>
                <circle cx="400" cy="240" r="10" fill="#d5dec7" />
                <circle cx="400" cy="240" r="23" fill="none" stroke="#a9bb9b" stroke-opacity=".3" />
                <For each={nodes}>
                  {(n) => (
                    <>
                      <circle
                        cx={project(n).x}
                        cy={project(n).y}
                        r={22 * project(n).scale}
                        fill="url(#node-halo)"
                      />
                      <circle
                        cx={project(n).x}
                        cy={project(n).y}
                        r={7 * project(n).scale}
                        fill="#baceac"
                      />
                    </>
                  )}
                </For>
              </svg>
              <For each={nodes}>
                {(n) => (
                  <button
                    class="node-label"
                    disabled={zooming()}
                    style={{ left: `${project(n).x / 8}%`, top: `${project(n).y / 4.8}%` }}
                    onClick={() => open(n.key)}>
                    <span class="node-hit" />
                    <span>{n.label}</span>
                    <small>↗</small>
                  </button>
                )}
              </For>
            </div>
            <p class="node-caption">Choose a node to explore. Move your pointer to turn the map.</p>
          </section>
        </Show>
      </main>
      <footer class="personal-footer">
        <span>Always a work in progress.</span>
        <a href="mailto:parthsharma.cs@gmail.com">Say hello ↗</a>
      </footer>
    </div>
  );
}
