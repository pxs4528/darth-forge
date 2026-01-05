import type { Component } from "solid-js";

const experiences = [
  {
    title: "Software Engineer",
    company: "General Motors",
    period: "Current",
    highlights: [
      "Built full-stack features in Next.js serving 17K+ users",
      "Drove monorepo modernization (Next.js/Nx migration)",
      "Implemented A/B testing with LaunchDarkly",
      "Designed E2E testing strategy with Cypress",
      "Maintained 99.9% uptime via on-call rotation",
    ],
  },
  {
    title: "Software Engineer & Research Assistant",
    company: "UT Arlington - EECS Department",
    period: "Sept 2023 – May 2024",
    highlights: [
      "Architected Android app for real-time environment monitoring",
      "Designed Spring Boot microservices (100K+ daily sensor readings)",
    ],
  },
];

const Experience: Component = () => {
  return (
    <section id="experience" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ ls -la experience/</span>
        </div>

        <div class="space-y-6">
          {experiences.map((exp) => (
            <div class="terminal-window p-6">
              <div class="mb-3">
                <div class="text-green-400 font-bold">{exp.title}</div>
                <div class="text-green-500">{exp.company}</div>
                <div class="text-green-600 text-sm">{exp.period}</div>
              </div>
              <div class="space-y-2">
                {exp.highlights.map((highlight) => (
                  <div class="terminal-prompt text-green-500">{highlight}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Experience;
