import type { Component } from "solid-js";

const About: Component = () => {
  return (
    <section id="about" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ cat about.txt</span>
        </div>

        <div class="terminal-window p-6 space-y-4 text-green-500">
          <p class="terminal-prompt">
            Software Engineer @ General Motors | Building full-stack features in Next.js for 17K+ users
          </p>
          <p class="terminal-prompt">
            B.S. Computer Science, UT Arlington | Magna Cum Laude | GPA: 3.76
          </p>
          <p class="terminal-prompt">
            Passionate about homelab infrastructure, self-hosting, and GitOps automation
          </p>
          <p class="terminal-prompt">
            Running production Raspberry Pi homelab with custom Go services and zero-downtime deployments
          </p>
          <p class="terminal-prompt">
            Interests: Distributed Systems | Cloud-Native | Autonomous Robotics | DevOps
          </p>
        </div>
      </div>
    </section>
  );
};

export default About;
