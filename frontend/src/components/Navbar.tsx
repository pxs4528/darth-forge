import { createSignal } from "solid-js";
import { telemetry } from "../services/telemetry";

const files = ["home", "about", "experience", "projects", "skills", "contact", "logs"];

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

    // Track navigation
    telemetry.trackClick(`navbar-${f}`);
    telemetry.trackNavigation("navbar", f);
  };

  return (
    <nav class="sticky top-0 z-50 bg-black border-b-2 border-white px-4 py-3 shadow-lg">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <div class="text-white font-bold">
          <span>root@darth-forge:~$</span>
        </div>
        <div class="flex gap-4 flex-wrap">
          {files.map((f) => (
            <button
              onClick={() => handleClick(f)}
              class={`px-3 py-1 transition-colors ${
                active() === f
                  ? "bg-[#fff] text-black font-medium"
                  : "text-white hover:bg-[#fff]/20"
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
