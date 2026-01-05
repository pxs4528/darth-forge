import { createSignal } from "solid-js";

const files = ["home", "about", "experience", "projects", "skills", "contact"];

type Props = {
  onSelect?: (_selectedFile: string) => void;
};

const Navbar = (props: Props) => {
  const [active, setActive] = createSignal<string>(files[0]);

  const handleClick = (f: string) => {
    setActive(f);
    const element = document.getElementById(f);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (props.onSelect) {
      props.onSelect(f);
    }
  };

  return (
    <nav class="sticky top-0 z-50 bg-black border-b-2 border-green-500 px-4 py-3">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <div class="text-green-500 font-bold">
          <span class="text-green-400">root@darth-forge:~$</span>
        </div>
        <div class="flex gap-4 flex-wrap">
          {files.map((f) => (
            <button
              onClick={() => handleClick(f)}
              class={`px-3 py-1 transition-colors ${
                active() === f
                  ? "bg-green-500 text-black"
                  : "text-green-500 hover:bg-green-900"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
