import type { Component } from "solid-js";
import { createSignal, For, onMount } from "solid-js";
import { telemetry } from "../services/telemetry";

type CommandOutput = {
  command: string;
  output: string;
};

const Terminal: Component = () => {
  const [input, setInput] = createSignal("");
  const [history, setHistory] = createSignal<CommandOutput[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  let inputRef: HTMLInputElement | undefined;

  const commands: Record<string, string> = {
    help: `Available commands:
  help       - Show this help message
  about      - Jump to About section
  experience - Jump to Experience section
  projects   - Jump to Projects section
  skills     - Jump to Skills section
  contact    - Jump to Contact section
  whoami     - Display system info
  clear      - Clear terminal output
  ls         - List available sections
  logs       - Open live log viewer`,

    whoami: `Parth Sharma (aka pipboi / darth)
Software Engineer @ General Motors
Building scalable apps for 17K+ users
Location: Texas, USA`,

    ls: `total 7
drwxr-xr-x  about/
drwxr-xr-x  experience/
drwxr-xr-x  projects/
drwxr-xr-x  skills/
drwxr-xr-x  contact/
drwxr-xr-x  logs/`,

    about: "Navigating to About section...",
    experience: "Navigating to Experience section...",
    projects: "Navigating to Projects section...",
    skills: "Navigating to Skills section...",
    contact: "Navigating to Contact section...",
  };

  const handleCommand = (cmd: string) => {
    const trimmedCmd = cmd.trim().toLowerCase();

    if (trimmedCmd === "clear") {
      setHistory([]);
      telemetry.trackCommand("clear");
      return;
    }

    if (trimmedCmd === "logs") {
      const element = document.getElementById("logs");
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
      setHistory([...history(), { command: cmd, output: "Navigating to Logs section..." }]);
      setInput("");
      telemetry.trackCommand("logs");
      telemetry.trackNavigation("terminal", "logs");
      return;
    }

    let output = "";
    let commandFound = true;

    if (trimmedCmd === "") {
      return;
    } else if (commands[trimmedCmd]) {
      output = commands[trimmedCmd];

      // Navigate to sections
      if (["about", "experience", "projects", "skills", "contact", "home", "logs"].includes(trimmedCmd)) {
        const element = document.getElementById(trimmedCmd);
        if (element) {
          setTimeout(() => {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }
        telemetry.trackCommand(trimmedCmd);
        telemetry.trackNavigation("terminal", trimmedCmd);
      } else {
        telemetry.trackCommand(trimmedCmd);
      }
    } else {
      output = `Command not found: ${trimmedCmd}
Type 'help' for available commands.`;
      commandFound = false;
      telemetry.trackCommand(trimmedCmd, false);
    }

    setHistory([...history(), { command: cmd, output }]);
    setInput("");

    // Scroll to bottom after adding output
    setTimeout(() => {
      const terminalOutput = document.getElementById("terminal-output");
      if (terminalOutput) {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
      }
    }, 50);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommand(input());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const allCommands = history().map(h => h.command);
      if (allCommands.length > 0) {
        const newIndex = historyIndex() === -1 ? allCommands.length - 1 : Math.max(0, historyIndex() - 1);
        setHistoryIndex(newIndex);
        setInput(allCommands[newIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const allCommands = history().map(h => h.command);
      if (historyIndex() !== -1) {
        const newIndex = Math.min(allCommands.length - 1, historyIndex() + 1);
        setHistoryIndex(newIndex);
        setInput(allCommands[newIndex] || "");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const currentInput = input().toLowerCase();
      const matches = Object.keys(commands).filter(cmd => cmd.startsWith(currentInput));
      if (matches.length === 1) {
        setInput(matches[0]);
      }
    }
  };

  onMount(() => {
    // Show welcome message
    setHistory([{
      command: "",
      output: `Welcome to Parth's Terminal Portfolio!
Type 'help' to see available commands.`
    }]);
  });

  return (
    <div class="fixed bottom-4 right-4 w-full max-w-2xl z-50 px-4">
      <div class="terminal-window p-4 max-h-96 flex flex-col">
        {/* Output area */}
        <div id="terminal-output" class="flex-1 overflow-y-auto mb-4 space-y-2 text-sm">
          <For each={history()}>
            {(item) => (
              <div>
                {item.command && (
                  <div class="text-[#5bff4d]">
                    <span class="text-white">$</span> {item.command}
                  </div>
                )}
                <pre class="text-gray-300 whitespace-pre-wrap font-mono text-sm">{item.output}</pre>
              </div>
            )}
          </For>
        </div>

        {/* Input area */}
        <div class="flex items-center gap-2 border-t border-gray-700 pt-2">
          <span class="text-[#5bff4d]">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            class="flex-1 bg-transparent text-white outline-none font-mono"
            placeholder="Type 'help' for commands..."
            autocomplete="off"
            spellcheck={false}
          />
        </div>
      </div>
    </div>
  );
};

export default Terminal;
