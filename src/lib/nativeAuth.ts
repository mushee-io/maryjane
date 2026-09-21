import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export class NativeAuthService {
  private static isInitialized = false;

  public static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initializes deep link listeners for Android OAuth callbacks.
   */
  public static initDeepLinkListener(onAuthSuccess: (token: string, user: any) => void) {
    if (!this.isNative() || this.isInitialized) return;
    this.isInitialized = true;

    App.addListener('appUrlOpen', async (data) => {
      console.log('[NativeAuth] App opened with URL:', data.url);

      // Handle xyz.missmilady.app:// auth redirects
      if (data.url.includes('xyz.missmilady.app') || data.url.includes('auth-callback') || data.url.includes('#access_token') || data.url.includes('?code=')) {
        try {
          await Browser.close();
        } catch {
          // ignore if already closed
        }

        const supabase = getSupabaseClient();
        if (supabase) {
          // Extract session from URL hash or query params
          const urlObj = new URL(data.url);
          const hashParams = new URLSearchParams(urlObj.hash.substring(1));
          const queryParams = urlObj.searchParams;

          const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { data: sessionData, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (!error && sessionData.session) {
              localStorage.setItem('milady_auth_token', sessionData.session.access_token);
              onAuthSuccess(sessionData.session.access_token, sessionData.session.user);
              return;
            }
          }
        }
      }
    });
  }

  /**
   * Initiates Google Sign-In.
   * On Native Android: Opens in-app browser with deep link redirect.
   * On Web: Standard OAuth or local demo flow.
   */
  public static async signInWithGoogle(): Promise<{ success: boolean; url?: string; error?: string }> {
    const supabase = getSupabaseClient();
    if (!supabase || !isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured' };
    }

    try {
      const redirectTo = this.isNative()
        ? 'xyz.missmilady.app://auth-callback'
        : `${window.location.origin}`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: this.isNative(),
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (this.isNative() && data?.url) {
        await Browser.open({ url: data.url, windowName: '_self' });
        return { success: true, url: data.url };
      }

      return { success: true, url: data?.url };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to start Google sign in' };
    }
  }
}
