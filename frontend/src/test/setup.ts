import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock telemetry service
vi.mock("../services/telemetry", () => ({
  telemetry: {
    trackClick: vi.fn(),
    trackCommand: vi.fn(),
    trackNavigation: vi.fn(),
    trackPageView: vi.fn(),
    trackInteraction: vi.fn(),
  },
}));

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;

  constructor(_url: string) {
    // Don't actually connect
  }

  close() {
    // No-op
  }

  send(_data: string) {
    // No-op
  }
}

globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// jsdom has no matchMedia. Rather than a stub that always says "no", this
// evaluates simple width queries against window.innerWidth, so a test can set
// innerWidth and get the breakpoint behaviour it expects. jsdom defaults to
// 1024px, which reads as desktop.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => {
    const evaluate = () => {
      const min = /\(min-width:\s*(\d+)px\)/.exec(query);
      if (min) return window.innerWidth >= Number(min[1]);
      const max = /\(max-width:\s*(\d+)px\)/.exec(query);
      if (max) return window.innerWidth <= Number(max[1]);
      return false;
    };
    return {
      media: query,
      get matches() {
        return evaluate();
      },
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}
