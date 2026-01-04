import type { Component } from "solid-js";

const skillCategories = [
  {
    category: "Programming Languages",
    skills: [
      "TypeScript",
      "JavaScript",
      "Python",
      "Java",
      "Scala",
      "C",
      "Go",
      "C++",
      "HTML5",
      "CSS",
      "SQL",
      "NoSQL",
    ],
  },
  {
    category: "Frameworks & Libraries",
    skills: ["Next.js", "Spring Boot", "React", "Node.js", "React Native", "JUnit"],
  },
  {
    category: "Tools & Technologies",
    skills: [
      "Azure",
      "AWS",
      "Docker",
      "Kubernetes",
      "Cypress",
      "Jest",
      "MongoDB",
      "PostgreSQL",
      "MySQL",
      "Git",
      "TensorFlow",
      "OpenCV",
      "Podman",
      "Cloudflare",
      "LaunchDarkly",
      "ROS2",
    ],
  },
];

const Skills: Component = () => {
  return (
    <section id="skills" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-4xl md:text-5xl font-bold mb-12 text-purple-400">Skills</h2>
        <div class="space-y-8">
          {skillCategories.map((category) => (
            <div>
              <h3 class="text-2xl font-bold text-white mb-4">{category.category}</h3>
              <div class="flex flex-wrap gap-3">
                {category.skills.map((skill) => (
                  <span class="px-4 py-2 bg-gray-800 rounded-lg text-gray-300 border border-gray-700 hover:border-purple-500 transition-colors">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="mt-12 p-6 bg-purple-900/20 border border-purple-500/30 rounded-lg">
          <h3 class="text-xl font-bold text-white mb-3">Education</h3>
          <p class="text-lg text-gray-300">
            <strong>The University of Texas at Arlington</strong>
          </p>
          <p class="text-gray-400">Bachelor of Science in Computer Science — Magna Cum Laude</p>
          <p class="text-gray-400">GPA: 3.76 | Class of 2025</p>
          <p class="text-sm text-gray-500 mt-2">
            Relevant Coursework: Distributed Systems, Algorithms, Operating Systems, Databases,
            Computer Networks
          </p>
        </div>
      </div>
    </section>
  );
};

export default Skills;
