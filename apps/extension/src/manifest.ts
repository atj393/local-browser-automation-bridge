import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Local Browser Automation Bridge',
  version: '0.1.0',
  description:
    'Local prototype that connects two existing websites in Chrome via a backend, dashboard, and a single MV3 extension.',
  icons: {
    '16': 'public/icon16.png',
    '48': 'public/icon48.png',
    '128': 'public/icon128.png',
  },
  action: {
    default_title: 'Local Browser Automation Bridge',
    default_icon: {
      '16': 'public/icon16.png',
      '48': 'public/icon48.png',
      '128': 'public/icon128.png',
    },
  },
  background: {
    service_worker: 'src/background/serviceWorker.ts',
    type: 'module',
  },
  permissions: ['tabs', 'activeTab'],
  host_permissions: [
    'http://localhost:*/*',
    'https://x.com/*',
    'https://twitter.com/*',
    'https://gemini.google.com/*',
  ],
  content_scripts: [
    {
      matches: ['https://x.com/*', 'https://twitter.com/*', 'http://localhost:4000/test/writer*'],
      js: ['src/content/xWriter.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
    {
      matches: ['https://gemini.google.com/*', 'http://localhost:4000/test/llm*'],
      js: ['src/content/geminiReader.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
});
