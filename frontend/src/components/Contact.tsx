import type { Component } from "solid-js";

const badges = [
  { alt: "Trans Rights Now!", src: "https://cyber.dabamos.de/88x31/transgender_now.gif" },
  { alt: "Say NO to Web3", src: "https://cyber.dabamos.de/88x31/say_no_to_web3.gif" },
  { alt: "Get a computer NOW!", src: "https://cyber.dabamos.de/88x31/computer_now.gif" },
  { alt: "100% hand coded HTML", src: "https://cyber.dabamos.de/88x31/handcoded.gif" },
  { alt: "View source now!", src: "https://cyber.dabamos.de/88x31/view_source.gif" },
  { alt: "CSS is difficult", src: "https://cyber.dabamos.de/88x31/css_fuck_off.gif" },
  { alt: "got html?", src: "https://cyber.dabamos.de/88x31/got_html.gif" },
  { alt: "Made with VSCodium", src: "https://cyber.dabamos.de/88x31/vscodium.gif" },
  {
    alt: "Use uBlock Origin",
    src: "https://cyber.dabamos.de/88x31/ublock_origin_2.gif",
  },
  { alt: "Internet archive", src: "https://cyber.dabamos.de/88x31/internet_archive.gif" },
  { alt: "GrapheneOS", src: "https://cyber.dabamos.de/88x31/grapheneos.gif" },
  { alt: "Eliminate DRM!", src: "https://cyber.dabamos.de/88x31/drm_free_1.gif" },
];

const Contact: Component = () => {
  return (
    <section id="contact" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-4xl md:text-5xl font-bold mb-12 text-purple-400">Contact</h2>

        <div class="space-y-8">
          <div class="bg-gray-900/50 rounded-lg p-8 border border-gray-800">
            <h3 class="text-2xl font-bold text-white mb-6">Get in Touch</h3>
            <div class="space-y-4">
              <div class="flex items-center gap-4">
                <span class="text-gray-400 w-24">Email:</span>
                <a
                  href="mailto:parthsharma.cs@gmail.com"
                  class="text-purple-400 hover:text-purple-300">
                  parthsharma.cs@gmail.com
                </a>
              </div>
              <div class="flex items-center gap-4">
                <span class="text-gray-400 w-24">Phone:</span>
                <a href="tel:469-664-5069" class="text-purple-400 hover:text-purple-300">
                  469-664-5069
                </a>
              </div>
              <div class="flex items-center gap-4">
                <span class="text-gray-400 w-24">LinkedIn:</span>
                <a
                  href="https://linkedin.com/in/parth-sharma"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-purple-400 hover:text-purple-300">
                  linkedin.com/in/parth-sharma
                </a>
              </div>
              <div class="flex items-center gap-4">
                <span class="text-gray-400 w-24">GitHub:</span>
                <a
                  href="https://github.com/parthsharma"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-purple-400 hover:text-purple-300">
                  github.com/parthsharma
                </a>
              </div>
            </div>
          </div>

          <div class="bg-gray-900/50 rounded-lg p-8 border border-gray-800">
            <h3 class="text-2xl font-bold text-white mb-6">88x31 Badges</h3>
            <div class="flex flex-wrap gap-2 justify-center md:justify-start">
              {badges.map((badge) => (
                <img
                  src={badge.src}
                  alt={badge.alt}
                  class="w-[88px] h-[31px] image-render-pixelated"
                  loading="lazy"
                />
              ))}
            </div>
          </div>

          <div class="text-center text-gray-500 text-sm">
            <p>Built with SolidJS, TailwindCSS, and Go</p>
            <p class="mt-2">Self-hosted on Raspberry Pi homelab via Cloudflare Tunnel</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
