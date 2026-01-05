type TelemetryEvent = {
  type: "click" | "command" | "navigation" | "pageview" | "interaction";
  data: Record<string, unknown>;
  timestamp?: string;
};

class TelemetryService {
  private endpoint = "/api/telemetry";
  private sessionId: string;
  private userId: string;

  constructor() {
    // Generate or retrieve session ID
    this.sessionId = this.getOrCreateSessionId();
    this.userId = this.getOrCreateUserId();
  }

  private getOrCreateSessionId(): string {
    let sessionId = sessionStorage.getItem("telemetry_session_id");
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem("telemetry_session_id", sessionId);
    }
    return sessionId;
  }

  private getOrCreateUserId(): string {
    let userId = localStorage.getItem("telemetry_user_id");
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem("telemetry_user_id", userId);
    }
    return userId;
  }

  private async send(event: TelemetryEvent) {
    try {
      const payload = {
        ...event,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        userId: this.userId,
        userAgent: navigator.userAgent,
        url: window.location.href,
        referrer: document.referrer,
      };

      await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Failed to send telemetry:", error);
    }
  }

  trackClick(element: string, data?: Record<string, unknown>) {
    this.send({
      type: "click",
      data: {
        element,
        ...data,
      },
    });
  }

  trackCommand(command: string, success: boolean = true) {
    this.send({
      type: "command",
      data: {
        command,
        success,
      },
    });
  }

  trackNavigation(from: string, to: string) {
    this.send({
      type: "navigation",
      data: {
        from,
        to,
      },
    });
  }

  trackPageView(page: string) {
    this.send({
      type: "pageview",
      data: {
        page,
        title: document.title,
      },
    });
  }

  trackInteraction(action: string, data?: Record<string, unknown>) {
    this.send({
      type: "interaction",
      data: {
        action,
        ...data,
      },
    });
  }
}

// Export singleton instance
export const telemetry = new TelemetryService();
