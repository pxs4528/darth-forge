import type { Component } from "solid-js";

const About: Component = () => {
  return (
    <section id="about" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ cat about.txt</span>
        </div>

        <div class="terminal-window p-6 space-y-4 text-white">
          <p class="terminal-prompt">
            software Engineer @ General Motors | building full-stack features for the GM Insurance
            claims platform
          </p>
          <p class="terminal-prompt">
            B.S. computer science, UT arlington | magna cum laude | GPA: 3.76
          </p>
          <p class="terminal-prompt">
            if you want to hire me, please reach out via email or linkedin
          </p>
          <p class="terminal-prompt">
            this website is brought to you by my Raspberry Pi 4 operating intermittently in my home
            lab
          </p>
          <p class="terminal-prompt">
            interests: full-stack | distributed systems | Autonomous Robotics | compilers
          </p>
        </div>
      </div>
    </section>
  );
};

export default About;
