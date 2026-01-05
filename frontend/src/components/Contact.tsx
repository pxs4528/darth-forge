import type { Component } from "solid-js";

const Contact: Component = () => {
  return (
    <section id="contact" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ cat /etc/contact</span>
        </div>

        <div class="terminal-window p-6 space-y-4">
          <div>
            <div class="text-green-400 mb-2">[Contact Information]</div>
            <div class="space-y-2">
              <div class="terminal-prompt">
                Email:{" "}
                <a href="mailto:parthsharma.cs@gmail.com" class="text-green-400 hover:underline">
                  parthsharma.cs@gmail.com
                </a>
              </div>
              <div class="terminal-prompt">
                Phone:{" "}
                <a href="tel:469-664-5069" class="text-green-400 hover:underline">
                  469-664-5069
                </a>
              </div>
              <div class="terminal-prompt">
                LinkedIn:{" "}
                <a
                  href="https://linkedin.com/in/parth-sharma"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-green-400 hover:underline"
                >
                  linkedin.com/in/parth-sharma
                </a>
              </div>
              <div class="terminal-prompt">
                GitHub:{" "}
                <a
                  href="https://github.com/parthsharma"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-green-400 hover:underline"
                >
                  github.com/parthsharma
                </a>
              </div>
            </div>
          </div>

          <div class="border-t-2 border-green-900 pt-4 mt-6">
            <div class="text-green-400 mb-2">[System Info]</div>
            <div class="terminal-prompt text-green-500">
              Stack: SolidJS + TailwindCSS + Go
            </div>
            <div class="terminal-prompt text-green-500">
              Hosted: Raspberry Pi 5 (8GB RAM) @ homelab
            </div>
            <div class="terminal-prompt text-green-500">
              Deployment: GitOps via Cloudflare Tunnel
            </div>
          </div>

          <div class="text-center pt-6 text-green-600 text-sm">
            <p>---</p>
            <p>Built with &lt;3 and late-night coffee</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
