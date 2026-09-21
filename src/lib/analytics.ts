// Production Analytics & Event Telemetry Module for Milady

export type AnalyticsEventType =
  | 'app_opened'
  | 'signin_started'
  | 'signin_completed'
  | 'home_loaded'
  | 'checkin_clicked'
  | 'rewarded_ad_requested'
  | 'rewarded_ad_started'
  | 'rewarded_ad_completed'
  | 'reward_claim_started'
  | 'reward_claim_completed'
  | 'reward_claim_failed'
  | 'activity_viewed'
  | 'notification_enabled'
  | 'offline_detected'
  | 'online_restored'
  | 'reward_reconciled';

export interface AnalyticsEventPayload {
  eventName: AnalyticsEventType;
  userId?: string;
  timestamp: number;
  properties?: Record<string, any>;
}

class AnalyticsService {
  private queue: AnalyticsEventPayload[] = [];
  private isFlushing = false;
  private sessionStartTime: number = Date.now();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  public track(eventName: AnalyticsEventType, properties: Record<string, any> = {}, userId?: string) {
    const payload: AnalyticsEventPayload = {
      eventName,
      userId: userId || undefined,
      timestamp: Date.now(),
      properties: {
        ...properties,
        session_duration_sec: Math.floor((Date.now() - this.sessionStartTime) / 1000),
        platform: 'android',
        app_version: '1.0.0',
      },
    };

    console.log(`[Telemetry] ${eventName}`, payload.properties);
    this.queue.push(payload);

    if (this.queue.length >= 3) {
      this.flush();
    }
  }

  public async flush() {
    if (this.queue.length === 0 || this.isFlushing) return;
    this.isFlushing = true;

    const batch = [...this.queue];
    this.queue = [];

    try {
      await fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // Re-queue on failure if not overloaded
      if (this.queue.length < 50) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }
}

export const analytics = new AnalyticsService();
