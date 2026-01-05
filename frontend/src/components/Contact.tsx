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
                email:{" "}
                <a href="mailto:parthsharma.cs@gmail.com" class="text-white hover:underline">
                  parthsharma.cs@gmail.com
                </a>
              </div>
              <div class="terminal-prompt">
                phone:{" "}
                <a href="tel:469-664-5069" class="text-white hover:underline">
                  469-664-5069
                </a>
              </div>
              <div class="terminal-prompt">
                linkedIn:{" "}
                <a
                  href="https://www.linkedin.com/in/parthsharma0310/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-white hover:underline">
                  linkedin.com/in/parth-sharma
                </a>
              </div>
              <div class="terminal-prompt">
                gitHub:{" "}
                <a
                  href="https://github.com/pxs4528"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-white hover:underline">
                  github.com/pxs4528
                </a>
              </div>
            </div>
          </div>

          <div class="border-t-2 border-green-900 pt-4 mt-6">
            <div class="text-green-400 mb-2">[System Info]</div>
            <div class="terminal-prompt text-white">stack: solidJS + tailwindCSS + go</div>
            <div class="terminal-prompt text-white">hosted: raspberry pi 4 @ homelab</div>
            <div class="terminal-prompt text-white">deployment: GitOps via cloudflare tunnel</div>
          </div>

          <div class="text-center pt-6 text-green-600 text-sm">
            <p>---</p>
            {/* <p>Built with &lt;3 and late-night coffee</p> */}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
