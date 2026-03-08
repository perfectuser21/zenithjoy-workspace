/**
 * Experiment 2: Login Hero Section Optimization
 *
 * Testing different headlines and value propositions
 *
 * Variants:
 * - control: Original headline
 * - variant_a: Benefit-focused headline
 * - variant_b: Problem-solution headline
 */

import { ABTest } from '../ABTest';

export function LoginHeroExperiment() {
  return (
    <ABTest
      config={{
        id: 'login_hero',
        variants: ['control', 'variant_a', 'variant_b']
      }}
    >
      {(variant) => {
        if (variant === 'control') {
          // Original: Generic branding
          return (
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                悦升云端
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-300">
                社交媒体自动化平台
              </p>
            </div>
          );
        }

        if (variant === 'variant_a') {
          // Variant A: Benefit-focused
          return (
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">
                节省 80% 运营时间
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">
                AI 驱动的社交媒体自动化平台
              </p>
              <div className="flex items-center justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>自动发布</span>
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>数据分析</span>
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>团队协作</span>
                </div>
              </div>
            </div>
          );
        }

        // Variant B: Problem-solution
        return (
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 rounded-full text-red-600 dark:text-red-400 text-sm mb-4">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>手动运营太耗时？</span>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              让 AI 帮你管理社交媒体
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              从内容创作到发布，全流程自动化
            </p>
          </div>
        );
      }}
    </ABTest>
  );
}
