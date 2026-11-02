import { defineConfig } from 'astro/config';

// Static site on GitHub Pages, under the repository's path. Albanian is the
// default language at the base, English at `en/`.
export default defineConfig({
  site: 'https://viganm.github.io',
  base: '/rutta-website/',
  output: 'static',
  i18n: {
    locales: ['sq', 'en'],
    defaultLocale: 'sq',
    routing: { prefixDefaultLocale: false },
  },
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
