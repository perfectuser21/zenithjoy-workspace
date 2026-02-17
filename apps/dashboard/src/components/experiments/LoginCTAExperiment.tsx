/**
 * Experiment 1: Login CTA Optimization
 *
 * Testing different button text and styling to improve click-through rate
 *
 * Variants:
 * - control: Original button
 * - variant_a: More action-oriented text
 * - variant_b: Emphasized security message
 */

import { ABTest } from '../ABTest';
import { trackABTestConversion } from '../../lib/ab-testing';

interface LoginCTAExperimentProps {
  onClick: () => void;
  loading?: boolean;
}

export function LoginCTAExperiment({ onClick, loading }: LoginCTAExperimentProps) {
  const handleClick = () => {
    trackABTestConversion('login_cta', 'button_click');
    onClick();
  };

  return (
    <ABTest
      config={{
        id: 'login_cta',
        variants: ['control', 'variant_a', 'variant_b']
      }}
    >
      {(variant) => {
        if (variant === 'control') {
          // Original: Simple text
          return (
            <button
              onClick={handleClick}
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '使用飞书登录'}
            </button>
          );
        }

        if (variant === 'variant_a') {
          // Variant A: More action-oriented, vibrant colors
          return (
            <button
              onClick={handleClick}
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? '正在连接...' : '🚀 立即开始使用'}
            </button>
          );
        }

        // Variant B: Security-focused
        return (
          <button
            onClick={handleClick}
            disabled={loading}
            className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              '验证中...'
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                安全登录
              </>
            )}
          </button>
        );
      }}
    </ABTest>
  );
}
