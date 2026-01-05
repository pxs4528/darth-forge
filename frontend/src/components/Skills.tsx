import type { Component } from "solid-js";

const skillCategories = [
  {
    category: "Languages",
    skills: "TypeScript, JavaScript, Python, Java, Go, C++, C, Scala, SQL",
  },
  {
    category: "Frameworks",
    skills: "Next.js, React, Spring Boot, Node.js, SolidJS",
  },
  {
    category: "Tools",
    skills: "Docker, Kubernetes, AWS, Azure, Git, PostgreSQL, MongoDB, ROS2, Cypress",
  },
];

const Skills: Component = () => {
  return (
    <section id="skills" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ grep -r skills</span>
        </div>

        <div class="terminal-window p-6 space-y-4">
          {skillCategories.map((category) => (
            <div>
              <div class="text-green-400 mb-2">[{category.category}]</div>
              <div class="terminal-prompt text-green-500">{category.skills}</div>
            </div>
          ))}

          <div class="border-t-2 border-green-900 pt-4 mt-6">
            <div class="text-green-400 mb-2">[Education]</div>
            <div class="terminal-prompt text-green-500">
              The University of Texas at Arlington
            </div>
            <div class="terminal-prompt text-green-500">
              B.S. Computer Science | Magna Cum Laude | GPA: 3.76 | Class of 2025
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Skills;
