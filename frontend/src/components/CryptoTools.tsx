import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import { telemetry } from "../services/telemetry";

type ToolId = "cipher" | "rsa" | "ecdh" | "elgamal-enc" | "elgamal-sig" | "stego";

const tools: { id: ToolId; label: string; cmd: string }[] = [
  { id: "cipher", label: "Substitution Cipher", cmd: "cipher.py" },
  { id: "rsa", label: "RSA", cmd: "rsa.py" },
  { id: "ecdh", label: "ECDH", cmd: "ecdh.py" },
  { id: "elgamal-enc", label: "ElGamal Encrypt", cmd: "elgamal_encryption.py" },
  { id: "elgamal-sig", label: "ElGamal Sign", cmd: "elgamal_signatures.py" },
  { id: "stego", label: "Steganography", cmd: "steganography.py" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = Record<string, any>;

async function callApi(tool: string, body: object): Promise<Result> {
  const res = await fetch(`/api/infosec/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

// ─── Sub-components ────────────────────────────────────────────────────────

const CipherTool: Component = () => {
  const [message, setMessage] = createSignal("Hello, World!");
  const [result, setResult] = createSignal<Result | null>(null);
  const [ciphertext, setCiphertext] = createSignal("");
  const [savedKey, setSavedKey] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const encrypt = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("cipher", { action: "encrypt", message: message() });
      setResult(r);
      setSavedKey(r.key);
      setCiphertext(r.ciphertext);
      telemetry.trackClick("infosec-cipher-encrypt");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const decrypt = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("cipher", {
        action: "decrypt",
        ciphertext: ciphertext(),
        key: savedKey(),
      });
      setResult(r);
      telemetry.trackClick("infosec-cipher-decrypt");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-gray-400 text-sm">
        Bijective character-substitution cipher. Trivially broken by frequency
        analysis — here to show why modern ciphers are designed differently.
      </p>
      <div class="space-y-2">
        <label class="text-green-400 text-sm">message</label>
        <input
          type="text"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          class="w-full bg-black border border-gray-600 text-white px-3 py-2 font-mono text-sm focus:outline-none focus:border-green-400"
          placeholder="Enter plaintext..."
        />
      </div>
      <div class="flex gap-2">
        <button
          onClick={encrypt}
          disabled={loading()}
          class="px-4 py-2 text-sm border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
        >
          {loading() ? "running..." : "encrypt"}
        </button>
        <Show when={savedKey()}>
          <button
            onClick={decrypt}
            disabled={loading()}
            class="px-4 py-2 text-sm border border-gray-500 text-gray-400 hover:bg-gray-400/10 transition-colors disabled:opacity-50"
          >
            decrypt
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="text-red-400 text-sm">error: {error()}</div>
      </Show>
      <Show when={result()}>
        <div class="terminal-window p-4 space-y-2 text-sm font-mono">
          <Show when={result()!.ciphertext !== undefined}>
            <div>
              <span class="text-gray-500">original:   </span>
              <span class="text-white">{message()}</span>
            </div>
            <div>
              <span class="text-gray-500">encrypted:  </span>
              <span class="text-yellow-300">{result()!.ciphertext}</span>
            </div>
            <div class="text-gray-500 text-xs mt-2">
              key preview:{" "}
              {Object.entries(result()!.preview as Record<string, string>)
                .map(([k, v]) => `'${k}'→'${v}'`)
                .join("  ")}
            </div>
          </Show>
          <Show when={result()!.plaintext !== undefined}>
            <div>
              <span class="text-gray-500">decrypted:  </span>
              <span class="text-green-400">{result()!.plaintext}</span>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const RsaTool: Component = () => {
  const [p, setP] = createSignal("61");
  const [q, setQ] = createSignal("53");
  const [msg, setMsg] = createSignal("42");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("rsa", {
        p: parseInt(p()),
        q: parseInt(q()),
        message: parseInt(msg()),
      });
      setResult(r);
      telemetry.trackClick("infosec-rsa-demo");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-gray-400 text-sm">
        RSA with educational small primes. Real RSA uses 2048–4096 bit primes
        with OAEP padding. Security basis: integer factorization hardness.
      </p>
      <div class="flex gap-4 flex-wrap">
        {(
          [
            ["prime p", p, setP],
            ["prime q", q, setQ],
            ["message m", msg, setMsg],
          ] as const
        ).map(([label, getter, setter]) => (
          <div class="space-y-1">
            <label class="text-green-400 text-xs">{label}</label>
            <input
              type="number"
              value={getter()}
              onInput={(e) => setter(e.currentTarget.value)}
              class="w-24 bg-black border border-gray-600 text-white px-2 py-1 font-mono text-sm focus:outline-none focus:border-green-400"
            />
          </div>
        ))}
      </div>
      <button
        onClick={run}
        disabled={loading()}
        class="px-4 py-2 text-sm border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
      >
        {loading() ? "running..." : "run demo"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-sm">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="terminal-window p-4 font-mono text-sm space-y-1">
            <div class="text-gray-500 mb-2">// key generation</div>
            <div>
              <span class="text-gray-500">n = p×q = </span>
              <span class="text-white">{r().params.n}</span>
              <span class="text-gray-500">  φ(n) = </span>
              <span class="text-white">{r().params.phi_n}</span>
            </div>
            <div>
              <span class="text-gray-500">public  (e,n) = </span>
              <span class="text-yellow-300">
                ({r().public_key.e}, {r().public_key.n})
              </span>
            </div>
            <div>
              <span class="text-gray-500">private (d,n) = </span>
              <span class="text-red-400">
                ({r().private_key.d}, {r().private_key.n})
              </span>
            </div>
            <div class="text-gray-500 mt-2 mb-1">// encrypt / decrypt</div>
            <div>
              <span class="text-gray-500">m = </span>
              <span class="text-white">{r().message}</span>
              <span class="text-gray-500">  →  c = m^e mod n = </span>
              <span class="text-yellow-300">{r().ciphertext}</span>
            </div>
            <div>
              <span class="text-gray-500">c = </span>
              <span class="text-yellow-300">{r().ciphertext}</span>
              <span class="text-gray-500">  →  m = c^d mod n = </span>
              <span class={r().correct ? "text-green-400" : "text-red-400"}>
                {r().recovered}
              </span>
              <span class={r().correct ? "text-green-400" : "text-red-400"}>
                {" "}
                {r().correct ? "✓" : "✗"}
              </span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const EcdhTool: Component = () => {
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await callApi("ecdh", {});
      setResult(r);
      telemetry.trackClick("infosec-ecdh-demo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-gray-400 text-sm">
        ECDH key exchange on secp256k1 (Bitcoin's curve). Alice and Bob each
        generate a key pair, exchange public keys, and independently arrive at
        the same shared secret. Security basis: ECDLP hardness.
      </p>
      <button
        onClick={run}
        disabled={loading()}
        class="px-4 py-2 text-sm border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
      >
        {loading() ? "generating..." : "new exchange"}
      </button>
      <Show when={result()}>
        {(r) => (
          <div class="terminal-window p-4 font-mono text-sm space-y-3">
            <div class="text-gray-500">// {r().curve}  y²=x³+7 mod p</div>
            {(["alice", "bob"] as const).map((party) => (
              <div class="space-y-0.5">
                <div class="text-blue-400">{party}</div>
                <div class="pl-4">
                  <span class="text-gray-500">private: </span>
                  <span class="text-red-400">{r()[party].private}</span>
                </div>
                <div class="pl-4">
                  <span class="text-gray-500">public:  </span>
                  <span class="text-yellow-300">
                    ({r()[party].public.x}, {r()[party].public.y})
                  </span>
                </div>
              </div>
            ))}
            <div class="border-t border-gray-700 pt-2 space-y-0.5">
              <div class="text-gray-500">// alice computes a·B, bob computes b·A</div>
              <div>
                <span class="text-gray-500">alice shared x: </span>
                <span class="text-green-400">{r().alice_shared_x}</span>
              </div>
              <div>
                <span class="text-gray-500">bob   shared x: </span>
                <span class="text-green-400">{r().bob_shared_x}</span>
              </div>
              <div
                class={`font-bold ${r().match ? "text-green-400" : "text-red-400"}`}
              >
                {r().match ? "✓ shared secrets match" : "✗ mismatch (bug!)"}
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const ElgamalEncTool: Component = () => {
  const [msg, setMsg] = createSignal("42");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("elgamal-enc", { message: parseInt(msg()) });
      setResult(r);
      telemetry.trackClick("infosec-elgamal-enc-demo");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-gray-400 text-sm">
        Probabilistic public-key encryption. Same plaintext encrypts to
        different ciphertext each run (semantic security via random ephemeral
        key k). Security basis: Discrete Logarithm Problem.
      </p>
      <div class="space-y-1">
        <label class="text-green-400 text-xs">message (integer, 1 &lt; m &lt; 2357)</label>
        <input
          type="number"
          value={msg()}
          onInput={(e) => setMsg(e.currentTarget.value)}
          class="w-32 bg-black border border-gray-600 text-white px-2 py-1 font-mono text-sm focus:outline-none focus:border-green-400"
        />
      </div>
      <button
        onClick={run}
        disabled={loading()}
        class="px-4 py-2 text-sm border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
      >
        {loading() ? "running..." : "encrypt / decrypt"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-sm">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="terminal-window p-4 font-mono text-sm space-y-1">
            <div class="text-gray-500">// p={r().params.p}  g={r().params.g}</div>
            <div>
              <span class="text-gray-500">public y = g^x mod p = </span>
              <span class="text-yellow-300">{r().public_key.y}</span>
            </div>
            <div>
              <span class="text-gray-500">m = </span>
              <span class="text-white">{r().message}</span>
              <span class="text-gray-500">  →  (c1,c2) = </span>
              <span class="text-yellow-300">
                ({r().ciphertext.c1}, {r().ciphertext.c2})
              </span>
            </div>
            <div>
              <span class="text-gray-500">decrypted = </span>
              <span class={r().correct ? "text-green-400" : "text-red-400"}>
                {r().recovered}
              </span>
              <span class={r().correct ? "text-green-400" : "text-red-400"}>
                {" "}
                {r().correct ? "✓" : "✗"}
              </span>
            </div>
            <div class="text-gray-600 text-xs mt-1">
              run again — (c1,c2) changes each time due to random ephemeral key
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const ElgamalSigTool: Component = () => {
  const [msg, setMsg] = createSignal("Hello, World!");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("elgamal-sig", { message: msg() });
      setResult(r);
      telemetry.trackClick("infosec-elgamal-sig-demo");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-gray-400 text-sm">
        Digital signatures: authentication, integrity, non-repudiation. Critical
        flaw: reusing ephemeral key k leaks the private key — this exact bug
        compromised Sony PS3's signing key in 2010.
      </p>
      <div class="space-y-1">
        <label class="text-green-400 text-xs">message</label>
        <input
          type="text"
          value={msg()}
          onInput={(e) => setMsg(e.currentTarget.value)}
          class="w-full bg-black border border-gray-600 text-white px-3 py-2 font-mono text-sm focus:outline-none focus:border-green-400"
        />
      </div>
      <button
        onClick={run}
        disabled={loading()}
        class="px-4 py-2 text-sm border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50"
      >
        {loading() ? "signing..." : "sign & verify"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-sm">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="terminal-window p-4 font-mono text-sm space-y-1">
            <div>
              <span class="text-gray-500">message:   </span>
              <span class="text-white">"{r().message}"</span>
            </div>
            <div>
              <span class="text-gray-500">signature: </span>
              <span class="text-yellow-300">
                (s1={r().signature.s1}, s2={r().signature.s2})
              </span>
            </div>
            <div class={r().valid ? "text-green-400" : "text-red-400"}>
              {r().valid ? "✓" : "✗"} original message:{" "}
              {r().valid ? "valid" : "invalid"}
            </div>
            <div class={!r().tampered_valid ? "text-green-400" : "text-red-400"}>
              {!r().tampered_valid ? "✓" : "✗"} tampered message (+"!"):{" "}
              {r().tampered_valid ? "valid (bug!)" : "rejected"}
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const StegoInfo: Component = () => (
  <div class="space-y-4">
    <p class="text-gray-400 text-sm">
      LSB (Least Significant Bit) steganography hides data inside image pixels
      by overwriting the lowest bit of each color channel. A 1920×1080 RGB
      image can carry ~750 KB of hidden data with no visible change.
    </p>
    <div class="terminal-window p-4 font-mono text-sm space-y-2">
      <div class="text-gray-500">// technique</div>
      <div class="terminal-prompt text-white">
        pixel (R=200, G=150, B=100) → hide bit '1' in R LSB
      </div>
      <div class="terminal-prompt text-white">
        R=200 (11001000₂) → 11001001₂ = 201 (Δ=1, imperceptible)
      </div>
      <div class="text-gray-500 mt-2">// security note</div>
      <div class="terminal-prompt text-yellow-300">
        steganography ≠ encryption — message existence is hidden, not content
      </div>
      <div class="terminal-prompt text-white">
        chi-squared steganalysis can detect LSB-modified images statistically
      </div>
      <div class="terminal-prompt text-white">
        combine with AES-256-GCM for hidden + encrypted payloads
      </div>
    </div>
  </div>
);

// ─── Main component ─────────────────────────────────────────────────────────

const CryptoTools: Component = () => {
  const [active, setActive] = createSignal<ToolId>("cipher");

  const selectTool = (id: ToolId) => {
    setActive(id);
    telemetry.trackClick(`infosec-tab-${id}`);
  };

  return (
    <section id="infosec" class="min-h-screen px-4 py-20">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ ls ~/infosec/</span>
        </div>

        {/* Tab bar */}
        <div class="flex flex-wrap gap-2 mb-6">
          {tools.map((t) => (
            <button
              onClick={() => selectTool(t.id)}
              class={`px-3 py-1 text-sm font-mono transition-colors ${
                active() === t.id
                  ? "bg-white text-black font-medium"
                  : "text-white hover:bg-white/20"
              }`}
            >
              {t.cmd}
            </button>
          ))}
        </div>

        {/* Tool panel */}
        <div class="terminal-window p-6">
          <div class="text-green-400 text-sm mb-4 border-b border-gray-700 pb-2">
            $ python3{" "}
            {tools.find((t) => t.id === active())?.cmd}
          </div>
          <Show when={active() === "cipher"}>
            <CipherTool />
          </Show>
          <Show when={active() === "rsa"}>
            <RsaTool />
          </Show>
          <Show when={active() === "ecdh"}>
            <EcdhTool />
          </Show>
          <Show when={active() === "elgamal-enc"}>
            <ElgamalEncTool />
          </Show>
          <Show when={active() === "elgamal-sig"}>
            <ElgamalSigTool />
          </Show>
          <Show when={active() === "stego"}>
            <StegoInfo />
          </Show>
        </div>
      </div>
    </section>
  );
};

export default CryptoTools;
