import next from "eslint-config-next/core-web-vitals";
import ts from "typescript-eslint";
const config = [
  ...next,
  ...ts.configs.recommended,
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    settings: { next: { rootDir: ["apps/web/"] } },
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
export default config;
