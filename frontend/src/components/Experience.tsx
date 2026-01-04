import type { Component } from "solid-js";

const experiences = [
  {
    title: "Software Engineer",
    company: "General Motors",
    period: "Current",
    highlights: [
      "Built and scaled full-stack features in Next.js serving 17K+ users, optimizing API performance and implementing efficient state management patterns that reduced unnecessary re-renders and improved application responsiveness",
      "Drove monorepo modernization by migrating to latest Next.js/Nx versions, refactoring 15+ legacy components to improve build times and developer velocity while establishing reusable architectural patterns across multiple teams",
      "Implemented data-driven product decisions through A/B testing with LaunchDarkly, analyzing user behavior to optimize conversion funnels and establishing feature flag best practices that reduced technical debt from stale configurations",
      "Designed end-to-end testing strategy with Cypress, achieving comprehensive coverage of critical user flows and integrating into CI/CD pipeline to prevent regressions and accelerate deployment velocity",
      "Owned production reliability through on-call rotation, building monitoring dashboards for proactive incident detection that improved incident response times while maintaining 99.9% uptime",
    ],
  },
  {
    title: "Software Engineer & Research Assistant",
    company: "The University of Texas at Arlington - EECS Department",
    period: "September 2023 – May 2024",
    highlights: [
      "Architected full-stack Android application in Java for real-time environment monitoring interfacing with custom PCB sensor hardware",
      "Designed distributed Spring Boot microservices handling 100K+ daily sensor readings, implementing event-driven architecture with message queuing for reliable data processing at scale",
    ],
  },
];

const Experience: Component = () => {
  return (
    <section id="experience" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-4xl md:text-5xl font-bold mb-12 text-purple-400">Experience</h2>
        <div class="space-y-12">
          {experiences.map((exp) => (
            <div class="border-l-2 border-purple-500 pl-6">
              <div class="mb-4">
                <h3 class="text-2xl font-bold text-white">{exp.title}</h3>
                <p class="text-xl text-gray-300">{exp.company}</p>
                <p class="text-sm text-gray-500">{exp.period}</p>
              </div>
              <ul class="space-y-3">
                {exp.highlights.map((highlight) => (
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

export default Experience;
