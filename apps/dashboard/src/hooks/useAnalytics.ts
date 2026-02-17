import { useEffect } from 'react';

/**
 * Analytics Hook
 *
 * Provides utilities for tracking events with Microsoft Clarity
 */

declare global {
  interface Window {
    clarity?: (action: string, ...args: any[]) => void;
  }
}

/**
 * Track a custom event
 *
 * @example
 * ```tsx
 * const analytics = useAnalytics();
 * analytics.trackEvent('button_click', 'cta_signup');
 * ```
 */
export function useAnalytics() {
  const trackEvent = (eventName: string, data?: Record<string, any>) => {
    if (typeof window !== 'undefined' && window.clarity) {
      window.clarity('event', eventName);

      // Set custom data if provided
      if (data) {
        Object.entries(data).forEach(([key, value]) => {
          window.clarity?.('set', key, String(value));
        });
      }

      console.log(`[Analytics] Event tracked: ${eventName}`, data);
    } else {
      console.warn('[Analytics] Clarity not loaded');
    }
  };

  const trackPageView = (pageName: string) => {
    if (typeof window !== 'undefined' && window.clarity) {
      window.clarity('set', 'page', pageName);
      console.log(`[Analytics] Page view: ${pageName}`);
    }
  };

  const identifyUser = (userId: string, userProps?: Record<string, any>) => {
    if (typeof window !== 'undefined' && window.clarity) {
      window.clarity('identify', userId, undefined, undefined, userProps);
      console.log(`[Analytics] User identified: ${userId}`);
    }
  };

  return {
    trackEvent,
    trackPageView,
    identifyUser
  };
}

/**
 * Track page views automatically
 */
export function usePageTracking(pageName: string) {
  const { trackPageView } = useAnalytics();

  useEffect(() => {
    trackPageView(pageName);
  }, [pageName, trackPageView]);
}

/**
 * Track scroll depth
 */
export function useScrollTracking() {
  useEffect(() => {
    let maxScroll = 0;
    const milestones = [25, 50, 75, 100];
    const tracked = new Set<number>();

    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;

      const scrollPercent = Math.round(
        ((scrollTop + windowHeight) / documentHeight) * 100
      );

      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent;

        // Track milestones
        milestones.forEach(milestone => {
          if (scrollPercent >= milestone && !tracked.has(milestone)) {
            tracked.add(milestone);
            if (window.clarity) {
              window.clarity('event', `scroll_${milestone}%`);
              console.log(`[Analytics] Scroll milestone: ${milestone}%`);
            }
          }
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
}
