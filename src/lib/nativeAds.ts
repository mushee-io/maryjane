import { Capacitor } from '@capacitor/core';

export interface NativeAdShowOptions {
  userId: string;
  adSessionId: string;
  adUnitId?: string;
  onAdOpened?: () => void;
  onUserEarnedReward?: (reward: { type: string; amount: number }) => void;
  onAdDismissed?: (completed: boolean) => void;
  onAdFailedToShow?: (error: string) => void;
}

/**
 * Native rewarded-ad facade.
 *
 * The previous @capacitor-community/admob bridge was removed because its Android
 * module introduced an incompatible Kotlin compiler into the Capacitor 8 build.
 * The Android app now owns Google Mobile Ads natively. Keeping this facade free
 * of the removed npm package allows the web bundle to compile cleanly while the
 * native Android rewarded-ad implementation remains in the Android source tree.
 */
export class NativeAdMobService {
  public static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  public static async initialize(): Promise<void> {
    // Google Mobile Ads is initialized natively in MainActivity.
  }

  public static async loadAndShowRewardedAd(options: NativeAdShowOptions): Promise<boolean> {
    if (!this.isNative()) return false;

    // There is intentionally no dependency on @capacitor-community/admob here.
    // Until the native manager is exposed through a dedicated Capacitor bridge,
    // report the unavailable bridge rather than falsely granting a client reward.
    options.onAdFailedToShow?.('Native rewarded-ad bridge is unavailable in this build.');
    return false;
  }
}
