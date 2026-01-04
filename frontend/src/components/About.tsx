import type { Component } from "solid-js";

const About: Component = () => {
  return (
    <section id="about" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-4xl md:text-5xl font-bold mb-8 text-purple-400">About Me</h2>
        <div class="space-y-6 text-gray-300 text-lg leading-relaxed">
          <p>
            I'm a Software Engineer at General Motors, where I build and scale full-stack features
            in Next.js serving over 17,000 users. My work focuses on optimizing API performance,
            implementing efficient state management patterns, and driving monorepo modernization.
          </p>
          <p>
            I graduated Magna Cum Laude from The University of Texas at Arlington with a B.S. in
            Computer Science (GPA: 3.76), where I also worked as a Software Engineer and Research
            Assistant in the Electrical Engineering & Computer Science Department.
          </p>
          <p>
            Beyond my day job, I'm passionate about homelab infrastructure and self-hosting. I run a
            production homelab on Raspberry Pi with custom Go services, implementing GitOps
            automation for zero-downtime deployments. I believe in owning the full stack - from bare
            metal to application layer.
          </p>
          <p>
            My interests span distributed systems, cloud-native architectures, autonomous robotics,
            and building developer tools that improve velocity and reliability. I enjoy tackling
            complex problems and learning new technologies.
          </p>
        </div>
      </div>
    </section>
  );
};

export default About;
