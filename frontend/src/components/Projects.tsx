import type { Component } from "solid-js";

const projects = [
  {
    title: "Homelab Portfolio with GitOps Automation",
    tech: "SolidJS, Go, Podman, Cloudflare",
    period: "Current",
    links: { live: "#", github: "#" },
    highlights: [
      "Engineered production homelab on Raspberry Pi with custom Go webhook daemon running as systemd service, automating zero-downtime deployments from GitHub pushes with less than 30 second deployment cycles",
      "Implemented resilient CI/CD pipeline with systemd auto-restart, journald logging, and health monitoring, orchestrating Podman containers through webhook events with automatic rollback on deployment failures",
      "Built high-performance SolidJS frontend and Go REST APIs, self-hosted via Cloudflare Tunnel with Caddy reverse proxy, demonstrating full infrastructure ownership from bare metal to application layer",
    ],
  },
  {
    title: "JCompile - Custom Compiler Implementation",
    tech: "Java, Scala",
    period: "Spring 2024",
    links: { github: "#" },
    highlights: [
      "Architected full-featured compiler in Java with modular design covering lexical analysis, parsing, semantic analysis, and code generation, applying Gang of Four patterns (Visitor, Strategy, Factory) for extensibility",
      "Engineered AST construction and symbol table management with optimization passes (constant folding, dead code elimination) and comprehensive error handling with detailed diagnostics",
    ],
  },
  {
    title: "Trailblazer - Autonomous Rover",
    tech: "Python, C++, ROS2",
    period: "April 2025",
    highlights: [
      "Designed autonomous rover system, modifying ROS 2 differential drive to support four independent motor controllers with custom kinematics",
      "Developed sensor fusion algorithms combining LIDAR, OpenCV, and IMU for real-time SLAM with Kalman filtering and TensorFlow-based path planning achieving 95% navigation success rate",
    ],
  },
];

const Projects: Component = () => {
  return (
    <section id="projects" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-4xl md:text-5xl font-bold mb-12 text-purple-400">Projects</h2>
        <div class="space-y-12">
          {projects.map((project) => (
            <div class="bg-gray-900/50 rounded-lg p-6 border border-gray-800 hover:border-purple-500 transition-colors">
              <div class="mb-4">
                <div class="flex items-start justify-between flex-wrap gap-2">
                  <h3 class="text-2xl font-bold text-white">{project.title}</h3>
                  <div class="flex gap-3">
                    {project.links.live && (
                      <a
                        href={project.links.live}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-purple-400 hover:text-purple-300 text-sm">
                        Live ↗
                      </a>
                    )}
                    {project.links.github && (
                      <a
                        href={project.links.github}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-purple-400 hover:text-purple-300 text-sm">
                        GitHub ↗
                      </a>
                    )}
                  </div>
                </div>
                <p class="text-gray-400 text-sm mt-1">{project.tech}</p>
                <p class="text-gray-500 text-xs mt-1">{project.period}</p>
              </div>
              <ul class="space-y-3">
                {project.highlights.map((highlight) => (
                  <li class="text-gray-400 flex gap-3">
                    <span class="text-purple-400 mt-1.5">▹</span>
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Projects;
