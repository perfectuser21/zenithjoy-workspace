import zenithjoyConfig from '@zenithjoy/eslint-config';

// Override rules for migration phase
const configWithOverrides = zenithjoyConfig.map((config) => {
  if (config.rules) {
    return {
      ...config,
      rules: {
        ...config.rules,
        // Migration phase: temporarily relax some rules
        // TODO: Gradually enable these rules and fix existing code
        '@typescript-eslint/no-unused-vars': 'warn',
        '@typescript-eslint/consistent-type-imports': 'warn',
        'no-console': 'off',
      },
    };
  }
  return config;
});

export default [
  ...configWithOverrides,
  {
    ignores: ['dist/**', 'dist-dev/**', 'node_modules/**'],
  },
];
