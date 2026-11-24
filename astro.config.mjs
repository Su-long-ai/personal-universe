// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const site = process.env.PUBLIC_SITE_URL || undefined;
const configuredBase = process.env.PUBLIC_BASE_PATH || '/';
// Astro preserves the configured base in import.meta.env.BASE_URL. Keep one
// trailing slash so runtime public-asset concatenation remains valid on project
// sites such as /personal-universe as well as at the domain root.
const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;

export default defineConfig({
  site,
  base,
  integrations: [react()],
  devToolbar: {
    enabled: false,
  },
});
