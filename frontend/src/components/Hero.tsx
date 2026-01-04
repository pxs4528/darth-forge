import type { Component } from "solid-js";

const Hero: Component = () => {
  return (
    <section id="home" class="min-h-screen flex items-center justify-center px-4 py-20">
      <div class="max-w-4xl w-full text-center">
        <div class="mb-8 flex justify-center">
          <div class="w-48 h-48 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-6xl font-bold shadow-2xl">
            PS
          </div>
        </div>
        <h1 class="text-5xl md:text-7xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
          Parth Sharma
        </h1>
        <h2 class="text-2xl md:text-3xl text-gray-300 mb-6">Software Engineer</h2>
        <p class="text-lg text-gray-400 mb-8 max-w-2xl mx-auto">
          Full-stack engineer building scalable applications with Next.js, React, and Go. Currently
          at General Motors, serving 17K+ users. Passionate about distributed systems, homelab
          infrastructure, and autonomous robotics.
        </p>
        <div class="flex gap-4 justify-center flex-wrap">
          <a
            href="mailto:parthsharma.cs@gmail.com"
            class="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
            Get in Touch
          </a>
          <a
            href="https://github.com/parthsharma"
            target="_blank"
            rel="noopener noreferrer"
            class="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            View GitHub
          </a>
        </div>
      </div>
    </section>
  );
};

export default Hero;
