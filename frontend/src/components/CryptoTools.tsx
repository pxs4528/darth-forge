import type { Component } from "solid-js";
import { createSignal, Show, For } from "solid-js";
import { telemetry } from "../services/telemetry";

type ToolId = "cipher" | "rsa" | "ecdh" | "elgamal-enc" | "elgamal-sig" | "stego";

const tools: { id: ToolId; label: string; cmd: string }[] = [
  { id: "cipher",      label: "Substitution Cipher", cmd: "cipher.py"               },
  { id: "rsa",         label: "RSA",                  cmd: "rsa.py"                  },
  { id: "ecdh",        label: "ECDH",                 cmd: "ecdh.py"                 },
  { id: "elgamal-enc", label: "ElGamal Encrypt",      cmd: "elgamal_encryption.py"   },
  { id: "elgamal-sig", label: "ElGamal Sign",         cmd: "elgamal_signatures.py"   },
  { id: "stego",       label: "Steganography",        cmd: "steganography.py"        },
];

// ─── Code snippets ───────────────────────────────────────────────────────────

const CODE: Record<ToolId, string> = {
  cipher: `\
def generate_key() -> dict[str, str]:
    shuffled = PRINTABLE_CHARS.copy()
    secrets.SystemRandom().shuffle(shuffled)
    return dict(zip(PRINTABLE_CHARS, shuffled))

def encrypt(plaintext: str, key: dict) -> str:
    return "".join(
        key.get(char, char)
        for char in plaintext
    )

def decrypt(ciphertext: str, key: dict) -> str:
    reverse_key = {v: k for k, v in key.items()}
    return "".join(
        reverse_key.get(char, char)
        for char in ciphertext
    )`,

  rsa: `\
def mod_exp(base, exp, mod):
    result = 1
    base %= mod
    while exp > 0:
        if exp & 1:
            result = (result * base) % mod
        exp >>= 1
        base = (base * base) % mod
    return result                  # O(log exp)

def generate_keys(p, q):
    n     = p * q
    phi_n = (p - 1) * (q - 1)
    e     = 65537          # Fermat prime F4
    d     = mod_inverse(e, phi_n)
    return (e, n), (d, n)

def encrypt(m, public_key):
    e, n = public_key
    return mod_exp(m, e, n)    # m^e mod n

def decrypt(c, private_key):
    d, n = private_key
    return mod_exp(c, d, n)    # c^d mod n`,

  ecdh: `\
def point_add(P, Q):
    if P is None: return Q
    if Q is None: return P
    x1, y1 = P;  x2, y2 = Q
    if x1 == x2 and y1 != y2:
        return None  # P + (-P) = identity
    if P == Q:  # doubling: slope of tangent
        m = 3*x1*x1 * inv(2*y1)   # a=0 secp256k1
    else:       # addition: slope of secant
        m = (y2-y1) * inv(x2-x1)
    x3 = (m*m - x1 - x2) % p
    y3 = (m*(x1 - x3) - y1) % p
    return x3, y3

def scalar_multiply(k, P):
    result, addend = None, P   # identity, P
    while k:
        if k & 1:
            result = point_add(result, addend)
        addend = point_add(addend, addend)
        k >>= 1
    return result              # O(log k)

# Alice: a·B = a·(b·G) = (ab)·G
# Bob:   b·A = b·(a·G) = (ab)·G  ← same!`,

  "elgamal-enc": `\
def generate_keys(p, g):
    x = secrets.randbelow(p - 3) + 2  # private
    y = pow(g, x, p)                   # public
    return (p, g, y), (p, g, x)

def encrypt(m, public_key):
    p, g, y = public_key
    # Fresh random k gives different ciphertext
    # each call — semantic security (IND-CPA)
    k  = secrets.randbelow(p - 3) + 2
    c1 = pow(g, k, p)         # g^k mod p
    c2 = (m * pow(y,k,p)) % p # m·y^k mod p
    return c1, c2

def decrypt(ciphertext, private_key):
    p, _, x = private_key
    c1, c2  = ciphertext
    K = pow(c1, x, p)          # g^(kx) mod p
    return (c2 * pow(K,-1,p)) % p  # c2/K`,

  "elgamal-sig": `\
def sign_message(message, private_key):
    p, g, x = private_key
    h = hash_message(message, p)   # H(m) mod p
    # k MUST be unique per signature —
    # reuse leaks x (see: Sony PS3 2010)
    while True:
        k = secrets.randbelow(p - 2) + 1
        if gcd(k, p - 1) == 1: break
    s1 = pow(g, k, p)
    s2 = (pow(k,-1,p-1) * (h - x*s1)) % (p-1)
    return s1, s2

def verify_signature(message, sig, public_key):
    p, g, y = public_key
    s1, s2  = sig
    h = hash_message(message, p)
    lhs = pow(g, h, p)             # g^H(m)
    rhs = pow(y,s1,p)*pow(s1,s2,p) % p
    return lhs == rhs  # g^H(m) ≡ y^s1·s1^s2`,

  stego: `\
# Each pixel has R, G, B channels (0–255).
# We overwrite the LSB of each channel
# with one bit of the secret message.

def hide_bit(channel: int, bit: int) -> int:
    return (channel & 0xFE) | bit  # Δ ≤ 1

# Encode: iterate secret bytes, embed bits
for byte in secret_data:
    for pos in range(8):
        bit = (byte >> (7 - pos)) & 1
        r, g, b, a = pixels[i]
        r = hide_bit(r, bit)
        pixels[i] = (r, g, b, a)
        i += 1

# Decode: read LSB from each channel
bits = [pixels[i][0] & 1 for i in range(n)]
secret = bytes(
    int("".join(map(str,bits[i:i+8])), 2)
    for i in range(0, len(bits), 8)
)`,
};

// ─── Syntax highlighter ───────────────────────────────────────────────────────

type Segment = { text: string; cls: string };

function highlightLine(line: string): Segment[] {
  if (line.trim().startsWith("#")) {
    return [{ text: line, cls: "text-gray-500" }];
  }

  const segments: Segment[] = [];
  let rest = line;

  // leading whitespace
  const indent = rest.match(/^(\s*)/)?.[1] ?? "";
  segments.push({ text: indent, cls: "text-white" });
  rest = rest.slice(indent.length);

  // def keyword
  if (rest.startsWith("def ")) {
    segments.push({ text: "def ", cls: "text-green-400" });
    rest = rest.slice(4);
    const nameEnd = rest.search(/[(:]/);
    if (nameEnd > -1) {
      segments.push({ text: rest.slice(0, nameEnd), cls: "text-white" });
      rest = rest.slice(nameEnd);
    }
  }

  // inline comment
  const commentIdx = rest.indexOf("  #");
  if (commentIdx > -1) {
    segments.push({ text: rest.slice(0, commentIdx), cls: "text-white" });
    segments.push({ text: rest.slice(commentIdx), cls: "text-gray-500" });
    return segments;
  }

  // return keyword
  if (rest.trimStart().startsWith("return ")) {
    const sp = rest.indexOf("return ");
    segments.push({ text: rest.slice(0, sp), cls: "text-white" });
    segments.push({ text: "return ", cls: "text-yellow-300" });
    rest = rest.slice(sp + 7);
  }

  segments.push({ text: rest, cls: "text-white" });
  return segments;
}

const CodePanel: Component<{ code: string }> = (props) => {
  const lines = () => props.code.split("\n");
  return (
    <pre class="text-xs font-mono leading-relaxed overflow-auto h-full whitespace-pre">
      <For each={lines()}>
        {(line) => (
          <div>
            <For each={highlightLine(line)}>
              {(seg) => <span class={seg.cls}>{seg.text}</span>}
            </For>
          </div>
        )}
      </For>
    </pre>
  );
};

// ─── Shared layout wrapper ────────────────────────────────────────────────────

const SideBySide: Component<{ id: ToolId; children: any }> = (props) => (
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-700">
    {/* Code panel */}
    <div class="p-4 overflow-auto max-h-96 lg:max-h-none">
      <div class="text-gray-600 text-xs mb-2">// core algorithm</div>
      <CodePanel code={CODE[props.id]} />
    </div>
    {/* Demo panel */}
    <div class="p-4">{props.children}</div>
  </div>
);

// ─── Tool demos ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Result = Record<string, any>;

async function callApi(tool: string, body: object): Promise<Result> {
  const res = await fetch(`/api/infosec/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "request failed");
  return data;
}

const CipherDemo: Component = () => {
  const [message, setMessage] = createSignal("Hello, World!");
  const [result, setResult]   = createSignal<Result | null>(null);
  const [savedKey, setSavedKey] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError]     = createSignal("");

  const encrypt = async () => {
    setLoading(true); setError("");
    try {
      const r = await callApi("cipher", { action: "encrypt", message: message() });
      setResult(r); setSavedKey(r.key);
      telemetry.trackClick("infosec-cipher-encrypt");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const decrypt = async () => {
    setLoading(true); setError("");
    try {
      const r = await callApi("cipher", {
        action: "decrypt", ciphertext: result()?.ciphertext, key: savedKey(),
      });
      setResult((prev) => ({ ...prev, decrypted: r.plaintext }));
      telemetry.trackClick("infosec-cipher-decrypt");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div class="space-y-3">
      <p class="text-gray-400 text-xs">
        Bijective character substitution. Trivially broken by frequency
        analysis — each letter maps to a fixed substitute.
      </p>
      <div class="space-y-1">
        <label class="text-green-400 text-xs">plaintext</label>
        <input
          type="text" value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          class="w-full bg-black border border-gray-700 text-white px-3 py-1.5 font-mono text-sm focus:outline-none focus:border-green-400"
        />
      </div>
      <div class="flex gap-2">
        <button onClick={encrypt} disabled={loading()}
          class="px-3 py-1 text-xs border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
          {loading() ? "..." : "encrypt()"}
        </button>
        <Show when={savedKey()}>
          <button onClick={decrypt} disabled={loading()}
            class="px-3 py-1 text-xs border border-gray-600 text-gray-400 hover:bg-gray-400/10 transition-colors disabled:opacity-50">
            decrypt()
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="text-red-400 text-xs">error: {error()}</div>
      </Show>
      <Show when={result()}>
        <div class="font-mono text-xs space-y-1.5 pt-1">
          <div><span class="text-gray-500">plaintext  </span><span class="text-white">{message()}</span></div>
          <div><span class="text-gray-500">ciphertext </span><span class="text-yellow-300">{result()!.ciphertext}</span></div>
          <Show when={result()!.decrypted !== undefined}>
            <div><span class="text-gray-500">decrypted  </span><span class="text-green-400">{result()!.decrypted}</span></div>
          </Show>
          <div class="text-gray-600 text-xs pt-1">
            key preview: {Object.entries(result()!.preview as Record<string, string>).map(([k, v]) => `'${k}'→'${v}'`).join("  ")}
          </div>
        </div>
      </Show>
    </div>
  );
};

const RsaDemo: Component = () => {
  const [p, setP] = createSignal("61");
  const [q, setQ] = createSignal("53");
  const [msg, setMsg] = createSignal("42");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true); setError("");
    try {
      const r = await callApi("rsa", { p: +p(), q: +q(), message: +msg() });
      setResult(r);
      telemetry.trackClick("infosec-rsa-demo");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div class="space-y-3">
      <p class="text-gray-400 text-xs">
        Security: integer factorization hardness. Real RSA uses 2048–4096 bit
        primes with OAEP padding.
      </p>
      <div class="flex gap-3 flex-wrap">
        {([["p", p, setP], ["q", q, setQ], ["m", msg, setMsg]] as const).map(([label, get, set]) => (
          <div class="space-y-0.5">
            <label class="text-green-400 text-xs">{label}</label>
            <input type="number" value={get()} onInput={(e) => set(e.currentTarget.value)}
              class="w-20 bg-black border border-gray-700 text-white px-2 py-1 font-mono text-sm focus:outline-none focus:border-green-400" />
          </div>
        ))}
      </div>
      <button onClick={run} disabled={loading()}
        class="px-3 py-1 text-xs border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
        {loading() ? "..." : "generate_keys() → encrypt() → decrypt()"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-xs">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="font-mono text-xs space-y-1 pt-1">
            <div><span class="text-gray-500">n = p×q     </span><span class="text-white">{r().params.n}</span><span class="text-gray-500">  φ(n) = </span><span class="text-white">{r().params.phi_n}</span></div>
            <div><span class="text-gray-500">public (e,n) </span><span class="text-yellow-300">({r().public_key.e}, {r().public_key.n})</span></div>
            <div><span class="text-gray-500">private(d,n) </span><span class="text-red-400">({r().private_key.d}, {r().private_key.n})</span></div>
            <div class="pt-1"><span class="text-gray-500">m={r().message}  →  c=m^e mod n=</span><span class="text-yellow-300">{r().ciphertext}</span></div>
            <div><span class="text-gray-500">c={r().ciphertext}  →  m=c^d mod n=</span><span class={r().correct ? "text-green-400" : "text-red-400"}>{r().recovered} {r().correct ? "✓" : "✗"}</span></div>
          </div>
        )}
      </Show>
    </div>
  );
};

const EcdhDemo: Component = () => {
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await callApi("ecdh", {}));
      telemetry.trackClick("infosec-ecdh-demo");
    } finally { setLoading(false); }
  };

  return (
    <div class="space-y-3">
      <p class="text-gray-400 text-xs">
        Key exchange on secp256k1 (Bitcoin's curve). Security: ECDLP hardness.
        256-bit keys ≈ RSA-3072 security.
      </p>
      <button onClick={run} disabled={loading()}
        class="px-3 py-1 text-xs border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
        {loading() ? "..." : "new exchange"}
      </button>
      <Show when={result()}>
        {(r) => (
          <div class="font-mono text-xs space-y-2 pt-1">
            <div class="text-gray-600">// curve: {r().curve}  y²=x³+7 mod p</div>
            {(["alice", "bob"] as const).map((party) => (
              <div>
                <span class="text-blue-400">{party}  </span>
                <span class="text-gray-500">priv </span><span class="text-red-400">{r()[party].private}  </span>
                <span class="text-gray-500">pub.x </span><span class="text-yellow-300">{r()[party].public.x}</span>
              </div>
            ))}
            <div class="border-t border-gray-800 pt-1 space-y-0.5">
              <div><span class="text-gray-500">alice shared_x </span><span class="text-green-400">{r().alice_shared_x}</span></div>
              <div><span class="text-gray-500">bob   shared_x </span><span class="text-green-400">{r().bob_shared_x}</span></div>
              <div class={r().match ? "text-green-400" : "text-red-400"}>
                {r().match ? "✓ match — same (ab)·G reached independently" : "✗ mismatch (bug!)"}
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const ElgamalEncDemo: Component = () => {
  const [msg, setMsg] = createSignal("42");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true); setError("");
    try {
      setResult(await callApi("elgamal-enc", { message: +msg() }));
      telemetry.trackClick("infosec-elgamal-enc-demo");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div class="space-y-3">
      <p class="text-gray-400 text-xs">
        Probabilistic encryption — same plaintext produces different ciphertext
        each call. Security: Discrete Logarithm Problem.
      </p>
      <div class="space-y-0.5">
        <label class="text-green-400 text-xs">message (int, 1 &lt; m &lt; 2357)</label>
        <input type="number" value={msg()} onInput={(e) => setMsg(e.currentTarget.value)}
          class="w-28 block bg-black border border-gray-700 text-white px-2 py-1 font-mono text-sm focus:outline-none focus:border-green-400" />
      </div>
      <button onClick={run} disabled={loading()}
        class="px-3 py-1 text-xs border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
        {loading() ? "..." : "encrypt() → decrypt()"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-xs">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="font-mono text-xs space-y-1 pt-1">
            <div class="text-gray-600">// p={r().params.p}  g={r().params.g}</div>
            <div><span class="text-gray-500">public y  </span><span class="text-yellow-300">{r().public_key.y}</span></div>
            <div><span class="text-gray-500">m={r().message}  →  </span><span class="text-yellow-300">(c1={r().ciphertext.c1}, c2={r().ciphertext.c2})</span></div>
            <div><span class="text-gray-500">decrypted </span><span class={r().correct ? "text-green-400" : "text-red-400"}>{r().recovered} {r().correct ? "✓" : "✗"}</span></div>
            <div class="text-gray-600 pt-1">run again — (c1,c2) changes each call</div>
          </div>
        )}
      </Show>
    </div>
  );
};

const ElgamalSigDemo: Component = () => {
  const [msg, setMsg] = createSignal("Hello, World!");
  const [result, setResult] = createSignal<Result | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async () => {
    setLoading(true); setError("");
    try {
      setResult(await callApi("elgamal-sig", { message: msg() }));
      telemetry.trackClick("infosec-elgamal-sig-demo");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div class="space-y-3">
      <p class="text-gray-400 text-xs">
        Authentication + integrity + non-repudiation. Reusing ephemeral k
        leaks the private key — this exact flaw broke Sony PS3 signing (2010).
      </p>
      <div class="space-y-0.5">
        <label class="text-green-400 text-xs">message</label>
        <input type="text" value={msg()} onInput={(e) => setMsg(e.currentTarget.value)}
          class="w-full bg-black border border-gray-700 text-white px-2 py-1 font-mono text-sm focus:outline-none focus:border-green-400" />
      </div>
      <button onClick={run} disabled={loading()}
        class="px-3 py-1 text-xs border border-green-400 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
        {loading() ? "..." : "sign_message() → verify_signature()"}
      </button>
      <Show when={error()}>
        <div class="text-red-400 text-xs">error: {error()}</div>
      </Show>
      <Show when={result()}>
        {(r) => (
          <div class="font-mono text-xs space-y-1 pt-1">
            <div><span class="text-gray-500">message   </span><span class="text-white">"{r().message}"</span></div>
            <div><span class="text-gray-500">signature </span><span class="text-yellow-300">(s1={r().signature.s1}, s2={r().signature.s2})</span></div>
            <div class={r().valid ? "text-green-400" : "text-red-400"}>
              {r().valid ? "✓" : "✗"} original  → {r().valid ? "valid" : "invalid"}
            </div>
            <div class={!r().tampered_valid ? "text-green-400" : "text-red-400"}>
              {!r().tampered_valid ? "✓" : "✗"} tampered (+"!") → {r().tampered_valid ? "valid (bug!)" : "rejected"}
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const StegoDemo: Component = () => (
  <div class="space-y-3">
    <p class="text-gray-400 text-xs">
      LSB steganography hides data in image pixels by overwriting the least
      significant bit of each colour channel. A 1920×1080 RGB image carries
      ~750 KB hidden — visually indistinguishable from the original.
    </p>
    <div class="font-mono text-xs space-y-1.5">
      <div><span class="text-gray-500">capacity   </span><span class="text-white">width × height × 3 channels ÷ 8 bits</span></div>
      <div><span class="text-gray-500">delta      </span><span class="text-white">≤ 1 per channel (imperceptible)</span></div>
      <div class="pt-1"><span class="text-gray-500">attack     </span><span class="text-yellow-300">chi-squared steganalysis detects LSB patterns statistically</span></div>
      <div><span class="text-gray-500">mitigation </span><span class="text-white">encrypt payload with AES-256-GCM before embedding</span></div>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const CryptoTools: Component = () => {
  const [active, setActive] = createSignal<ToolId>("cipher");

  const selectTool = (id: ToolId) => {
    setActive(id);
    telemetry.trackClick(`infosec-tab-${id}`);
  };

  return (
    <section id="infosec" class="min-h-screen px-4 py-20">
      <div class="max-w-6xl mx-auto">
        <div class="mb-6">
          <span class="text-green-400 text-2xl">$ ls ~/infosec/</span>
        </div>

        {/* Tab bar */}
        <div class="flex flex-wrap gap-2 mb-4">
          {tools.map((t) => (
            <button
              onClick={() => selectTool(t.id)}
              class={`px-3 py-1 text-xs font-mono transition-colors ${
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
        <div class="terminal-window">
          <div class="px-4 py-2 border-b border-gray-700 text-green-400 text-xs">
            $ python3 {tools.find((t) => t.id === active())?.cmd}
          </div>

          <Show when={active() === "cipher"}>
            <SideBySide id="cipher"><CipherDemo /></SideBySide>
          </Show>
          <Show when={active() === "rsa"}>
            <SideBySide id="rsa"><RsaDemo /></SideBySide>
          </Show>
          <Show when={active() === "ecdh"}>
            <SideBySide id="ecdh"><EcdhDemo /></SideBySide>
          </Show>
          <Show when={active() === "elgamal-enc"}>
            <SideBySide id="elgamal-enc"><ElgamalEncDemo /></SideBySide>
          </Show>
          <Show when={active() === "elgamal-sig"}>
            <SideBySide id="elgamal-sig"><ElgamalSigDemo /></SideBySide>
          </Show>
          <Show when={active() === "stego"}>
            <SideBySide id="stego"><StegoDemo /></SideBySide>
          </Show>
        </div>
      </div>
    </section>
  );
};

export default CryptoTools;
