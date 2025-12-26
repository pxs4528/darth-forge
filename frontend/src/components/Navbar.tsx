import { createSignal, createEffect, onMount } from "solid-js";

const files = ["Home.tsx", "About.tsx", "Contact.tsx", "README.md", "styles.css"];

const FileIcon = () => (
  <svg
    class="w-4 h-4 text-gray-300 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true">
    <path
      d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M14 3v6h6"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

type Props = {
  onSelect?: (_selectedFile: string) => void;
};

const STORAGE_KEY = "navbar-active";
const STORAGE_OPEN = "navbar-open";

const Navbar = (props: Props) => {
  // index of the currently focused/active file
  const [active, setActive] = createSignal<string>(files[0]);
  const [open, setOpen] = createSignal<boolean>(true);

  // on mount, restore from localStorage if present
  onMount(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && files.includes(saved)) {
        setActive(saved);
      }
      const savedOpen = localStorage.getItem(STORAGE_OPEN);
      if (savedOpen === "0") {
        setOpen(false);
      }
    } catch {
      // ignore localStorage errors
    }
  });

  // persist active change and call optional callback
  createEffect(() => {
    const val = active();
    try {
      localStorage.setItem(STORAGE_KEY, val);
    } catch {
      // ignore localStorage errors
    }
    if (props.onSelect) {
      props.onSelect(val);
    }
  });

  createEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPEN, open() ? "1" : "0");
    } catch {
      // ignore localStorage errors
    }
  });

  // handle keyboard navigation when nav has focus
  const onKeyDown = (e: KeyboardEvent) => {
    const idx = files.indexOf(active());
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = files[(idx + 1) % files.length];
      setActive(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = files[(idx - 1 + files.length) % files.length];
      setActive(prev);
    } else if (e.key === "Enter") {
      // treat Enter as open
      // onSelect is already called by createEffect; but we also close drawer on small
      if (window.innerWidth < 768) {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      // close drawer on small screens
      if (window.innerWidth < 768) {
        setOpen(false);
      }
    }
  };

  const handleClick = (f: string) => {
    setActive(f);
    if (window.innerWidth < 768) {
      setOpen(false);
    }
  };

  return (
    <>
      {/* Hamburger for small screens */}
      <button
        class="md:hidden p-2 m-2 rounded bg-white/5 text-white"
        aria-label={open() ? "Close files" : "Open files"}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}>
        <svg
          class="w-6 h-6"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true">
          {open() ? (
            <path
              d="M6 18L18 6M6 6l12 12"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          ) : (
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          )}
        </svg>
      </button>

      {/* Sidebar: hidden on small screens when closed */}
      <aside
        class={`fixed inset-y-0 left-0 z-20 transform transition-transform duration-200 md:static md:translate-x-0 ${
          open() ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open() ? "true" : "false"}>
        <nav
          class="w-56 bg-black/80 text-white p-3 md:rounded-r-md shadow-lg h-full"
          role="navigation"
          aria-label="file navigation"
          tabIndex={0}
          onKeyDown={(e) => onKeyDown(e as KeyboardEvent)}>
          <div class="flex items-center justify-between">
            <div class="text-xs uppercase text-gray-400 mb-3">Files</div>
            <div class="hidden md:block text-xs text-gray-400">Select with ↑ ↓</div>
          </div>

          <ul class="flex flex-col gap-1" role="listbox" aria-activedescendant={active()}>
            {files.map((f) => (
              <li
                id={f}
                class={
                  "flex items-center gap-3 px-2 py-1 rounded cursor-pointer transition-colors duration-150 focus:outline-none " +
                  (active() === f ? "bg-white/10" : "hover:bg-white/5")
                }
                onClick={() => handleClick(f)}
                role="option"
                aria-selected={active() === f}
                tabIndex={0}>
                <FileIcon />
                <span class="truncate text-sm">{f}</span>
              </li>
            ))}
          </ul>

          <div class="mt-4 text-[13px] text-gray-300">
            Selected: <span class="font-medium">{active()}</span>
          </div>
        </nav>
      </aside>
    </>
  );
};

export default Navbar;
