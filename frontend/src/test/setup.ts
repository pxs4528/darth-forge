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

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
