import { defineConfig } from 'astro/config';

// Static site on GitHub Pages at its own domain. Albanian is the default
// language at `/`, English at `/en/`.
export default defineConfig({
  site: 'https://ruttadispatching.com',
  output: 'static',
  i18n: {
    locales: ['sq', 'en'],
    defaultLocale: 'sq',
    routing: { prefixDefaultLocale: false },
  },
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
