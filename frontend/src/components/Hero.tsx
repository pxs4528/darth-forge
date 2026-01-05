import type { Component } from "solid-js";

const Hero: Component = () => {
  return (
    <section id="home" class="min-h-screen flex items-center justify-center px-4 py-20">
      <div class="max-w-4xl w-full">
        <pre class="ascii-art text-green-500 text-xs sm:text-sm mb-8 overflow-x-auto">
{`
 ██▓███   ▄▄▄       ██▀███  ▄▄▄█████▓ ██░ ██      ██████  ██░ ██  ▄▄▄       ██▀███   ███▄ ▄███▓ ▄▄▄
▓██░  ██▒▒████▄    ▓██ ▒ ██▒▓  ██▒ ▓▒▓██░ ██▒   ▒██    ▒ ▓██░ ██▒▒████▄    ▓██ ▒ ██▒▓██▒▀█▀ ██▒▒████▄
▓██░ ██▓▒▒██  ▀█▄  ▓██ ░▄█ ▒▒ ▓██░ ▒░▒██▀▀██░   ░ ▓██▄   ▒██▀▀██░▒██  ▀█▄  ▓██ ░▄█ ▒▓██    ▓██░▒██  ▀█▄
▒██▄█▓▒ ▒░██▄▄▄▄██ ▒██▀▀█▄  ░ ▓██▓ ░ ░▓█ ░██      ▒   ██▒░▓█ ░██ ░██▄▄▄▄██ ▒██▀▀█▄  ▒██    ▒██ ░██▄▄▄▄██
▒██▒ ░  ░ ▓█   ▓██▒░██▓ ▒██▒  ▒██▒ ░ ░▓█▒░██▓   ▒██████▒▒░▓█▒░██▓ ▓█   ▓██▒░██▓ ▒██▒▒██▒   ░██▒ ▓█   ▓██▒
▒▓▒░ ░  ░ ▒▒   ▓▒█░░ ▒▓ ░▒▓░  ▒ ░░    ▒ ░░▒░▒   ▒ ▒▓▒ ▒ ░ ▒ ░░▒░▒ ▒▒   ▓▒█░░ ▒▓ ░▒▓░░ ▒░   ░  ░ ▒▒   ▓▒█░
░▒ ░       ▒   ▒▒ ░  ░▒ ░ ▒░    ░     ▒ ░▒░ ░   ░ ░▒  ░ ░ ▒ ░▒░ ░  ▒   ▒▒ ░  ░▒ ░ ▒░░  ░      ░  ▒   ▒▒ ░
░░         ░   ▒     ░░   ░   ░       ░  ░░ ░   ░  ░  ░   ░  ░░ ░  ░   ▒     ░░   ░ ░      ░     ░   ▒
               ░  ░   ░               ░  ░  ░         ░   ░  ░  ░      ░  ░   ░            ░         ░  ░
`}
        </pre>

        <div class="terminal-window p-6 mb-6">
          <div class="mb-4">
            <span class="text-green-400">System Info:</span>
            <div class="ml-4 mt-2 space-y-1">
              <div class="terminal-prompt">Name: Parth Sharma</div>
              <div class="terminal-prompt">Role: Software Engineer @ General Motors</div>
              <div class="terminal-prompt">Location: Texas, USA</div>
              <div class="terminal-prompt">Specialization: Full-Stack Development, Distributed Systems</div>
            </div>
          </div>

          <div class="mb-4">
            <span class="text-green-400">Current Status:</span>
            <div class="ml-4 mt-2">
              <div class="terminal-prompt">Building scalable applications serving 17K+ users</div>
              <div class="terminal-prompt">Running production homelab on Raspberry Pi</div>
            </div>
          </div>

          <div>
            <span class="text-green-400">Quick Links:</span>
            <div class="ml-4 mt-2 flex gap-4 flex-wrap">
              <a href="mailto:parthsharma.cs@gmail.com" class="text-green-500 hover:bg-green-900 px-2 py-1 border border-green-500">
                [email]
              </a>
              <a href="https://github.com/parthsharma" target="_blank" rel="noopener noreferrer"
                 class="text-green-500 hover:bg-green-900 px-2 py-1 border border-green-500">
                [github]
              </a>
              <a href="https://linkedin.com/in/parth-sharma" target="_blank" rel="noopener noreferrer"
                 class="text-green-500 hover:bg-green-900 px-2 py-1 border border-green-500">
                [linkedin]
              </a>
            </div>
          </div>
        </div>

        <div class="text-green-400 text-sm animate-pulse">
          <span class="terminal-prompt">Type 'help' for available commands_</span>
        </div>
      </div>
    </section>
  );
};

export default Hero;
