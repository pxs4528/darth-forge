// Plaid Link is a hosted widget: the script is loaded from Plaid's CDN on
// demand rather than bundled, because it must be the version Plaid serves.
// There is no CSP on this site, so the load is unblocked.

type PlaidHandler = {
  open: () => void;
  exit: () => void;
  destroy: () => void;
};

type PlaidLinkGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string) => void;
    onExit: (error: { display_message?: string; error_message?: string } | null) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidLinkGlobal;
  }
}

const SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

let loading: Promise<PlaidLinkGlobal> | null = null;

/** Loads the Link script once, reusing the same promise for later opens. */
export const loadPlaidLink = (): Promise<PlaidLinkGlobal> => {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.onload = () => {
      if (window.Plaid) resolve(window.Plaid);
      else reject(new Error("Plaid Link loaded but did not register"));
    };
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      loading = null;
      reject(new Error("Could not reach Plaid — check your connection"));
    };
    document.head.appendChild(script);
  });
  return loading;
};

/**
 * Opens Link and resolves with the public token once the user finishes.
 * Resolves with null when they close it without linking, which is a normal
 * outcome rather than an error.
 */
export const openPlaidLink = async (linkToken: string): Promise<string | null> => {
  const plaid = await loadPlaidLink();
  return new Promise((resolve, reject) => {
    const handler = plaid.create({
      token: linkToken,
      onSuccess: (publicToken) => {
        resolve(publicToken);
        handler.destroy();
      },
      onExit: (error) => {
        if (error) {
          reject(new Error(error.display_message || error.error_message || "Link failed"));
        } else {
          resolve(null);
        }
        handler.destroy();
      },
    });
    handler.open();
  });
};
