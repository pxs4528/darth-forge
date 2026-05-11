import { createSignal, onMount, Show, For } from "solid-js";

type USCISStatus = {
  raw: Record<string, unknown> | null;
  checked_at: string;
  error?: string;
  changed?: boolean;
};

type Props = {
  token: string;
  onClose: () => void;
};

const USCISAdmin = (props: Props) => {
  const [status, setStatus] = createSignal<USCISStatus | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [cookie, setCookie] = createSignal("");
  const [bearer, setBearer] = createSignal("");
  const [ntfyTopic, setNtfyTopic] = createSignal(import.meta.env.VITE_NTFY_TOPIC ?? "");

  const headers = () => ({ "Content-Type": "application/json", "X-Admin-Token": props.token });

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/uscis/status", { headers: headers() });
      const data = await res.json();
      setStatus(data);
      setMessage("");
    } catch (e) {
      setMessage("Failed to fetch status");
    } finally {
      setLoading(false);
    }
  };

  const triggerCheck = async () => {
    setLoading(true);
    setMessage("Triggering check…");
    try {
      await fetch("/api/admin/uscis/check", { method: "POST", headers: headers() });
      setTimeout(fetchStatus, 2000); // wait 2s then refresh status
    } catch {
      setMessage("Failed to trigger check");
      setLoading(false);
    }
  };

  const updateCredentials = async () => {
    if (!cookie() && !bearer()) {
      setMessage("Enter at least a cookie or bearer token");
      return;
    }
    try {
      const res = await fetch("/api/admin/uscis/credentials", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ cookie: cookie(), bearer: bearer() }),
      });
      const data = await res.json();
      setMessage(data.message ?? data.error ?? "Done");
      setCookie("");
      setBearer("");
    } catch {
      setMessage("Failed to update credentials");
    }
  };

  const sendTestNotify = async () => {
    try {
      const res = await fetch("/api/admin/uscis/test-notify", { method: "POST", headers: headers() });
      const data = await res.json();
      setMessage(data.message ?? data.error ?? "Done");
    } catch {
      setMessage("Failed to send test notification");
    }
  };

  onMount(fetchStatus);

  const fmtDate = (iso: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  };

  return (
    <div class="fixed inset-0 z-[100] bg-black/80 flex items-start justify-center pt-10 px-4 overflow-y-auto">
      <div class="terminal-window w-full max-w-3xl p-6 space-y-6">
        {/* Header */}
        <div class="flex items-center justify-between border-b border-gray-700 pb-4">
          <div>
            <h2 class="text-white font-bold text-lg">USCIS Admin Panel</h2>
            <p class="text-gray-400 text-xs mt-1">STEM OPT · IOE9856492653</p>
          </div>
          <button onClick={props.onClose} class="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Status */}
        <section>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-[#5bff4d] font-mono text-sm">Case Status</h3>
            <div class="flex gap-2">
              <button
                onClick={triggerCheck}
                disabled={loading()}
                class="px-3 py-1 text-xs border border-[#5bff4d] text-[#5bff4d] hover:bg-[#5bff4d]/10 disabled:opacity-50"
              >
                {loading() ? "Checking…" : "Check Now"}
              </button>
              <button
                onClick={fetchStatus}
                class="px-3 py-1 text-xs border border-white text-white hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
          </div>

          <Show when={status()} fallback={<p class="text-gray-500 text-sm">Loading…</p>}>
            {(s) => (
              <div class="bg-black border border-gray-700 p-4 space-y-3 font-mono text-sm">
                <div class="flex gap-4 text-xs text-gray-400">
                  <span>Last checked: <span class="text-white">{fmtDate(s().checked_at)}</span></span>
                  {s().changed && <span class="text-yellow-400">⚡ Changed since last poll</span>}
                </div>

                <Show when={s().error}>
                  <div class="text-red-400 text-sm">
                    Error: {s().error}
                  </div>
                </Show>

                <Show when={s().raw} fallback={<p class="text-gray-500">No data yet</p>}>
                  <div class="space-y-1">
                    <For each={Object.entries(s().raw ?? {})}>
                      {([key, val]) => (
                        <div class="flex gap-2 text-xs">
                          <span class="text-blue-400 w-48 shrink-0">{key}:</span>
                          <span class="text-white break-all">
                            {typeof val === "object" ? JSON.stringify(val) : String(val)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </section>

        {/* Update Credentials */}
        <section>
          <h3 class="text-yellow-400 font-mono text-sm mb-3">Update USCIS Credentials</h3>
          <p class="text-gray-400 text-xs mb-3">
            After logging into <span class="text-white">my.uscis.gov</span>, open DevTools → Network,
            find the case API request, and copy either the <span class="text-white">Cookie</span> or{" "}
            <span class="text-white">Authorization: Bearer</span> header value.
          </p>
          <div class="space-y-2">
            <div>
              <label class="text-gray-400 text-xs block mb-1">Cookie header value</label>
              <input
                type="password"
                value={cookie()}
                onInput={(e) => setCookie(e.currentTarget.value)}
                placeholder="session=...; token=..."
                class="w-full bg-black border border-gray-600 text-white text-xs p-2 font-mono focus:border-[#5bff4d] outline-none"
              />
            </div>
            <div>
              <label class="text-gray-400 text-xs block mb-1">Bearer token (if any)</label>
              <input
                type="password"
                value={bearer()}
                onInput={(e) => setBearer(e.currentTarget.value)}
                placeholder="eyJ..."
                class="w-full bg-black border border-gray-600 text-white text-xs p-2 font-mono focus:border-[#5bff4d] outline-none"
              />
            </div>
            <button
              onClick={updateCredentials}
              class="px-4 py-2 text-xs bg-yellow-500 text-black font-bold hover:bg-yellow-400"
            >
              Update Credentials
            </button>
          </div>
        </section>

        {/* Test Notification */}
        <section>
          <h3 class="text-blue-400 font-mono text-sm mb-3">Push Notifications (ntfy.sh)</h3>
          <p class="text-gray-400 text-xs mb-3">
            Install the <span class="text-white">ntfy</span> app on your phone and subscribe to the topic
            configured in <span class="text-white">NTFY_TOPIC</span>.
            {ntfyTopic() && <> Current topic: <span class="text-[#5bff4d]">{ntfyTopic()}</span></>}
          </p>
          <button
            onClick={sendTestNotify}
            class="px-4 py-2 text-xs border border-blue-400 text-blue-400 hover:bg-blue-400/10"
          >
            Send Test Notification
          </button>
        </section>

        {/* Message */}
        <Show when={message()}>
          <div class="border border-gray-700 p-3 text-sm font-mono text-[#5bff4d]">{message()}</div>
        </Show>
      </div>
    </div>
  );
};

export default USCISAdmin;
