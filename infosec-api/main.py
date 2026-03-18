#!/usr/bin/env python3
"""
Infosec API — HTTP wrapper around /home/darth/infosec crypto implementations.
Imports existing modules directly; no logic is duplicated here.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, "/infosec")

from substitution_cipher.substitution_cipher import (
    generate_key,
    encrypt as cipher_encrypt,
    decrypt as cipher_decrypt,
)
from rsa.rsa import (
    generate_keys as rsa_keygen,
    encrypt as rsa_encrypt,
    decrypt as rsa_decrypt,
)
from ecdh_key_exchange.ecdh import generate_keypair, compute_shared_secret
from elgamal_encryption.elgamal_encryption import (
    generate_keys as eg_enc_keygen,
    encrypt as eg_enc_encrypt,
    decrypt as eg_enc_decrypt,
)
from elgamal_signatures.elgamal_signatures import (
    generate_keys as eg_sig_keygen,
    sign_message,
    verify_signature,
)

PORT = int(os.getenv("INFOSEC_PORT", "5000"))

# Fixed small params matching the educational demos
ELGAMAL_PRIME = 2357
ELGAMAL_GENERATOR = 2


class InfosecHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "healthy"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON"})
            return

        path = self.path.rstrip("/")
        try:
            if path == "/api/infosec/cipher":
                result = self._cipher(data)
            elif path == "/api/infosec/rsa":
                result = self._rsa(data)
            elif path == "/api/infosec/ecdh":
                result = self._ecdh()
            elif path == "/api/infosec/elgamal-enc":
                result = self._elgamal_enc(data)
            elif path == "/api/infosec/elgamal-sig":
                result = self._elgamal_sig(data)
            else:
                self._send_json(404, {"error": "not found"})
                return
            self._send_json(200, result)
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    # -------------------------------------------------------------------------
    # Tool handlers
    # -------------------------------------------------------------------------

    def _cipher(self, data: dict) -> dict:
        action = data.get("action", "encrypt")
        if action == "keygen":
            key = generate_key()
            sample = {c: key[c] for c in "ABCabc123" if c in key}
            return {"key": key, "preview": sample}

        if action == "encrypt":
            key = data.get("key") or generate_key()
            message = data.get("message", "Hello, World!")
            ciphertext = cipher_encrypt(message, key)
            sample = {c: key[c] for c in "ABCabc123" if c in key}
            return {"ciphertext": ciphertext, "key": key, "preview": sample}

        if action == "decrypt":
            key = data.get("key")
            ciphertext = data.get("ciphertext", "")
            if not key:
                raise ValueError("key required for decryption")
            return {"plaintext": cipher_decrypt(ciphertext, key)}

        raise ValueError(f"unknown action: {action}")

    def _rsa(self, data: dict) -> dict:
        p = int(data.get("p", 61))
        q = int(data.get("q", 53))
        pub, priv = rsa_keygen(p, q)
        e, n = pub
        d, _ = priv

        message = int(data.get("message", 42))
        if not (0 < message < n):
            raise ValueError(f"message must satisfy 0 < m < {n}")

        ciphertext = rsa_encrypt(message, pub)
        recovered = rsa_decrypt(ciphertext, priv)

        return {
            "params": {"p": p, "q": q, "n": n, "phi_n": (p - 1) * (q - 1)},
            "public_key": {"e": e, "n": n},
            "private_key": {"d": d, "n": n},
            "message": message,
            "ciphertext": ciphertext,
            "recovered": recovered,
            "correct": message == recovered,
        }

    def _ecdh(self) -> dict:
        alice_priv, alice_pub = generate_keypair()
        bob_priv, bob_pub = generate_keypair()
        alice_shared = compute_shared_secret(alice_priv, bob_pub)
        bob_shared = compute_shared_secret(bob_priv, alice_pub)

        def _fmt(n: int) -> str:
            h = hex(n)
            return h[:20] + "..." if len(h) > 20 else h

        return {
            "curve": "secp256k1",
            "alice": {
                "private": _fmt(alice_priv),
                "public": {"x": _fmt(alice_pub[0]), "y": _fmt(alice_pub[1])},
            },
            "bob": {
                "private": _fmt(bob_priv),
                "public": {"x": _fmt(bob_pub[0]), "y": _fmt(bob_pub[1])},
            },
            "alice_shared_x": _fmt(alice_shared[0]),
            "bob_shared_x": _fmt(bob_shared[0]),
            "match": alice_shared == bob_shared,
        }

    def _elgamal_enc(self, data: dict) -> dict:
        pub, priv = eg_enc_keygen(ELGAMAL_PRIME, ELGAMAL_GENERATOR)
        p, g, y = pub
        message = int(data.get("message", 42))
        if not (1 < message < p):
            raise ValueError(f"message must satisfy 1 < m < {p}")
        c1, c2 = eg_enc_encrypt(message, pub)
        recovered = eg_enc_decrypt((c1, c2), priv)
        return {
            "params": {"p": p, "g": g},
            "public_key": {"y": y},
            "message": message,
            "ciphertext": {"c1": c1, "c2": c2},
            "recovered": recovered,
            "correct": message == recovered,
        }

    def _elgamal_sig(self, data: dict) -> dict:
        pub, priv = eg_sig_keygen(ELGAMAL_PRIME, ELGAMAL_GENERATOR)
        p, g, y = pub
        message = data.get("message", "Hello, World!")
        s1, s2 = sign_message(message, priv)
        valid = verify_signature(message, (s1, s2), pub)
        tampered_valid = verify_signature(message + "!", (s1, s2), pub)
        return {
            "params": {"p": p, "g": g},
            "public_key": {"y": y},
            "message": message,
            "signature": {"s1": s1, "s2": s2},
            "valid": valid,
            "tampered_valid": tampered_valid,
        }

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # suppress default access logs


if __name__ == "__main__":
    server = HTTPServer(("", PORT), InfosecHandler)
    print(f"Infosec API listening on :{PORT}", flush=True)
    server.serve_forever()
