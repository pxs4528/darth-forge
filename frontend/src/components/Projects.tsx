import type { Component } from "solid-js";

const projects = [
  {
    title: "Homelab Portfolio with GitOps",
    tech: "SolidJS | Go | Docker | Cloudflare",
    highlights: [
      "Production homelab on Raspberry Pi with custom Go webhook daemon",
      "Zero-downtime deployments (<30s deployment cycles)",
      "Cloudflare Tunnel + Caddy reverse proxy",
    ],
  },
  {
    title: "JCompile - Custom Compiler",
    tech: "Java | Scala",
    highlights: [
      "Full compiler: lexer, parser, semantic analysis, codegen",
      "AST construction with optimization passes",
    ],
  },
  {
    title: "Trailblazer - Autonomous Rover",
    tech: "Python | C++ | ROS2",
    highlights: [
      "Modified ROS2 differential drive for 4 independent motors",
      "Sensor fusion (LIDAR, OpenCV, IMU) with SLAM",
      "95% navigation success rate",
    ],
  },
];

const Projects: Component = () => {
  return (
    <section id="projects" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ cat projects/*</span>
        </div>

        <div class="space-y-6">
          {projects.map((project) => (
            <div class="terminal-window p-6">
              <div class="mb-3">
                <div class="text-green-400 font-bold">{project.title}</div>
                <div class="text-green-600 text-sm">{project.tech}</div>
              </div>
              <div class="space-y-2">
                {project.highlights.map((highlight) => (
                  <div class="terminal-prompt text-white">{highlight}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Projects;
