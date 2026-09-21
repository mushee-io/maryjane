// Offline Reward Recovery & Idempotent Reconciliation Queue

import { analytics } from './analytics';

export interface PendingRewardClaim {
  idempotencyKey: string;
  adSessionId: string;
  watchedDurationSeconds: number;
  timestamp: number;
  userId: string;
  retryCount: number;
}

const STORAGE_KEY = 'milady_pending_claims_v1';

class OfflineRewardQueue {
  private isReconciling = false;

  public getPendingClaims(): PendingRewardClaim[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public enqueueClaim(claim: Omit<PendingRewardClaim, 'retryCount'>): void {
    const claims = this.getPendingClaims();
    // Prevent duplicate entries for same idempotency key
    if (!claims.some((c) => c.idempotencyKey === claim.idempotencyKey)) {
      claims.push({ ...claim, retryCount: 0 });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
      console.log('[OfflineQueue] Enqueued pending claim for recovery:', claim.idempotencyKey);
    }
  }

  public removeClaim(idempotencyKey: string): void {
    const claims = this.getPendingClaims().filter((c) => c.idempotencyKey !== idempotencyKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
  }

  public async reconcile(
    onSuccessCallback?: (result: any) => void
  ): Promise<{ reconciled: number; failed: number }> {
    if (this.isReconciling || !navigator.onLine) {
      return { reconciled: 0, failed: 0 };
    }

    const pending = this.getPendingClaims();
    if (pending.length === 0) return { reconciled: 0, failed: 0 };

    this.isReconciling = true;
    console.log(`[OfflineQueue] Attempting reconciliation for ${pending.length} pending claims...`);

    let reconciled = 0;
    let failed = 0;

    for (const claim of pending) {
      try {
        const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${claim.userId}`;
        const res = await fetch('/api/checkin/claim', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${storedToken}`,
          },
          body: JSON.stringify({
            adSessionId: claim.adSessionId,
            watchedDurationSeconds: claim.watchedDurationSeconds,
            idempotencyKey: claim.idempotencyKey,
            isReconciliation: true,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          console.log('[OfflineQueue] Successfully reconciled pending reward claim:', claim.idempotencyKey);
          this.removeClaim(claim.idempotencyKey);
          reconciled++;
          analytics.track('reward_reconciled', { idempotencyKey: claim.idempotencyKey }, claim.userId);
          if (onSuccessCallback) {
            onSuccessCallback(data);
          }
        } else if (res.status === 400 && data.error?.includes('already')) {
          // Already claimed previously, safe to discard from queue
          this.removeClaim(claim.idempotencyKey);
        } else {
          // Increment retry count or expire after 5 attempts
          claim.retryCount += 1;
          if (claim.retryCount > 5) {
            this.removeClaim(claim.idempotencyKey);
          }
          failed++;
        }
      } catch {
        failed++;
      }
    }

    this.isReconciling = false;
    return { reconciled, failed };
  }
}

export const offlineRewardQueue = new OfflineRewardQueue();
