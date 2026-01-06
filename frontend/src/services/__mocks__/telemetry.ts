// Mock telemetry service for tests
class MockTelemetryService {
  trackClick(_element: string, _data?: Record<string, unknown>) {
    // No-op in tests
  }

  trackCommand(_command: string, _success: boolean = true) {
    // No-op in tests
  }

  trackNavigation(_from: string, _to: string) {
    // No-op in tests
  }

  trackPageView(_page: string) {
    // No-op in tests
  }

  trackInteraction(_action: string, _data?: Record<string, unknown>) {
    // No-op in tests
  }
}

export const telemetry = new MockTelemetryService();
