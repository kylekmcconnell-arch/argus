import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.claude/**', 'node_modules*/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      'src/components/InvestigationDecisionCanvas.tsx',
      'src/components/SocialActivityPanel.tsx',
      'src/components/Report.tsx',
      'src/components/InvestigationReport.tsx',
      'src/reports/shared/**/*.{ts,tsx}',
    ],
    ignores: ['src/reports/shared/reportLaneRegistry.ts', 'src/reports/shared/reportLaneRendererRegistry.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/reports/kyle/**', '**/reports/enigma/**', '**/reports/production/**', '**/reports/raw/**'],
          message: 'Shared report code must use neutral ReportLaneDefinition renderer slots instead of importing an owned lane.',
        }],
      }],
    },
  },
])
