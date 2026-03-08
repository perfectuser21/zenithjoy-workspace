# ZenithJoy Dashboard

Social media automation platform for teams.

## Features

- 工作台 (Workbench)
- 新媒体运营 (Media Operations)
- AI 员工管理 (AI Employees)
- 账号管理 (Account Management)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deployment

Build output is in `dist/` directory. Serve with any static file server.

## Tech Stack

- React 18
- Vite 5
- TailwindCSS 3
- TypeScript 5

## Analytics & A/B Testing

This project includes built-in analytics and A/B testing capabilities for conversion optimization.

### Setup Microsoft Clarity

1. Create a free account at [clarity.microsoft.com](https://clarity.microsoft.com)
2. Create a new project and get your Project ID
3. Add the Project ID to your `.env` file:

```bash
# .env.development or .env.production
VITE_CLARITY_ID=your_project_id_here
```

4. Restart the dev server

### A/B Testing Framework

The dashboard includes a cookie-based A/B testing framework. See `src/lib/ab-testing.ts` for usage.

**Example**:

```tsx
import { ABTest } from './components/ABTest';
import { trackABTestConversion } from './lib/ab-testing';

<ABTest
  config={{
    id: 'my_experiment',
    variants: ['control', 'variant_a']
  }}
>
  {(variant) => (
    variant === 'control' ? (
      <button>Original Button</button>
    ) : (
      <button>New Button</button>
    )
  )}
</ABTest>
```

### Current Experiments

- **Login CTA Optimization**: Testing different button styles and messaging
- **Hero Section**: Testing different value propositions

See `docs/CONVERSION_ANALYSIS.md` for detailed analysis and experiment results.

### Analytics Hooks

```tsx
import { useAnalytics, useScrollTracking } from './hooks/useAnalytics';

function MyComponent() {
  const { trackEvent } = useAnalytics();
  useScrollTracking(); // Auto-track scroll depth

  return <button onClick={() => trackEvent('click', { button: 'signup' })}>
    Sign Up
  </button>;
}
```
