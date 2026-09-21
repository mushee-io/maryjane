// Production Crash Reporting & Error Telemetry with strict PII/token sanitization

interface CrashReport {
  message: string;
  stack?: string;
  componentStack?: string;
  context?: Record<string, any>;
  timestamp: number;
  appVersion: string;
  deviceInfo: {
    userAgent: string;
    language: string;
    screenResolution: string;
    online: boolean;
  };
}

class CrashReporter {
  private sanitize(obj: any): any {
    if (typeof obj === 'string') {
      // Scrub tokens, secrets, emails, keys
      return obj
        .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]')
        .replace(/milady_session_[A-Za-z0-9-_]+/gi, 'milady_session_[REDACTED]')
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
        .replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[JWT_REDACTED]');
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized: Record<string, any> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (/token|secret|password|key|auth|credential/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(val);
        }
      }
      return sanitized;
    }
    return obj;
  }

  public reportError(error: Error | string, context: Record<string, any> = {}) {
    try {
      const message = typeof error === 'string' ? error : error.message;
      const stack = typeof error === 'string' ? undefined : error.stack;

      const report: CrashReport = {
        message: this.sanitize(message),
        stack: stack ? this.sanitize(stack) : undefined,
        context: this.sanitize(context),
        timestamp: Date.now(),
        appVersion: '1.0.0',
        deviceInfo: {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
          screenResolution: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
          online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        },
      };

      console.warn('[CrashReporter] Captured error:', report);

      // Forward to backend crash collector endpoint
      fetch('/api/telemetry/crash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      }).catch(() => {
        // silent fail
      });
    } catch {
      // prevent recursive failure
    }
  }
}

export const crashReporter = new CrashReporter();
