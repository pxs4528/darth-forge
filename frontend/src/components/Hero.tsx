import type { Component } from "solid-js";
import { createSignal, onMount, onCleanup } from "solid-js";

const asciiArt = [
  `
 ██▓███   ▄▄▄       ██▀███   ▄▄▄█████  ██  ██      ██████  ██  ██  ▄▄▄       ██▀███   ███▄ ▄███▓ ▄▄▄
▓██░  ██  ████▄     ██   ██  ▓  ██     ██  ██     ██    ▒  ██  ██  ████▄     ██   ██  ██▒▀█▀ ██  ████▄
▓██░ ██▓  ██  ▀█▄   ██  ▄█      ██     ██▀▀██      ▓██▄    ██▀▀██  ██  ▀█▄   ██  ▄█   ██    ▓██  ██  ▀█▄
▒██▄█▓    ██▄▄▄▄██  ██▀▀█▄      ██     ▓█  ██          ██  ▓█  ██  ██▄▄▄▄██  ██▀▀█▄   ██    ▒██  ██▄▄▄▄██
▒██       ▓█   ▓██  ██  ▒█      ██     ▓█  ██     ██████▒  ▓█  ██  ▓█   ▓██  █▓  ██   █▒    ██▒  █     █▒
`,
  `
       ██▓███   █  ██▓███   ▄▄▄▄     █████   ██
      ▓██   ██  ██  ██   ██  █████▄   ██▒  ██ ▓█
      ▓██  ██▓  ██  ██  ██▓  ██▒ ▄██  ██░  ██ ██
      ▒██▄█▓▒   ██  ██▄█▓    ██░█▀  █ █   ██  ██
      ▒██       ██  ██▒      ▓█  ▀█▓  ████▓   ██
      ▒▓        ▓   ▓        ▓███▀             ▓
`,
  `
              ▓█████▄  ▄▄▄       ██▀███  ▄▄▄█████▓ ██  ██
              ▒██▀ ██▌ ████▄     ██   █  ▓  ██     ██  ██
              ░██   █▌ ██  ▀█▄   ██  ▄█     ██     ██▀▀██
              ░▓█▄   ▌ ██▄▄▄▄██  ██▀▀█▄     ██     ▓█  ██
              ░▒████▓  ▓█   ▓██  ██   ██    ██     ▓█  ██▓
`
];

const Hero: Component = () => {
  const [nameIndex, setNameIndex] = createSignal(0);
  const [visible, setVisible] = createSignal(true);

  onMount(() => {
    // Flicker effect
    const flickerInterval = setInterval(() => {
      setVisible(false);
      setTimeout(() => setVisible(true), 100);
    }, 3000);

    // Change name occasionally
    const nameInterval = setInterval(() => {
      setNameIndex((prev) => (prev + 1) % asciiArt.length);
    }, 4000);

    onCleanup(() => {
      clearInterval(flickerInterval);
      clearInterval(nameInterval);
    });
  });

  return (
    <section id="home" class="min-h-screen flex items-center justify-center px-4 py-20">
      <div class="max-w-5xl w-full">
        <pre
          class={`ascii-art text-white text-[10px] sm:text-xs md:text-sm mb-8 overflow-x-auto transition-opacity duration-100 ${
            visible() ? "opacity-100" : "opacity-0"
          }`}
          style="line-height: 1.4;"
        >
{asciiArt[nameIndex()]}
        </pre>

        <div class="terminal-window p-6 mb-6 space-y-4">
          <div>
            <span class="text-[#5bff4d] font-bold">[system]</span>
            <div class="ml-4 mt-2 space-y-2">
              <div class="text-white">→ Software Engineer @ General Motors</div>
              <div class="text-white">→ Building scalable apps for 17K+ users</div>
              <div class="text-white">→ B.S. Computer Science, UT Arlington (3.76 GPA)</div>
            </div>
          </div>

          <div>
            <span class="text-[#5bff4d] font-bold">[focus]</span>
            <div class="ml-4 mt-2 space-y-2">
              <div class="text-white">→ Full-Stack Development (Next.js, React, Go)</div>
              <div class="text-white">→ Distributed Systems & Cloud-Native</div>
              <div class="text-white">→ Homelab Infrastructure & Self-Hosting</div>
            </div>
          </div>

          <div>
            <span class="text-[#5bff4d] font-bold">[connect]</span>
            <div class="ml-4 mt-2 flex gap-4 flex-wrap">
              <a href="mailto:parthsharma.cs@gmail.com"
                 class="text-[#5bff4d] hover:bg-[#5bff4d]/20 px-3 py-1 border border-[#5bff4d] transition-colors">
                email
              </a>
              <a href="https://github.com/pxs4528" target="_blank" rel="noopener noreferrer"
                 class="text-[#5bff4d] hover:bg-[#5bff4d]/20 px-3 py-1 border border-[#5bff4d] transition-colors">
                github
              </a>
              <a href="https://www.linkedin.com/in/parthsharma0310/" target="_blank" rel="noopener noreferrer"
                 class="text-[#5bff4d] hover:bg-[#5bff4d]/20 px-3 py-1 border border-[#5bff4d] transition-colors">
                linkedin
              </a>
            </div>
          </div>
        </div>

        <div class="text-gray-500 text-sm">
          <span class="animate-pulse text-[#5bff4d]">$</span> <span class="animate-pulse">_</span>
        </div>
      </div>
    </section>
  );
};

export default Hero;
