# @happyc/auto-deploy
A tool dedicated to build, upload and deploy.

[![NPM version](https://img.shields.io/npm/v/@happyc/auto-deploy?color=a1b858)](https://www.npmjs.com/package/@happyc/auto-deploy)

##### Understand and Use

- you can use `pnpx @happyc/auto-deploy` directly.
- Use the current version's `preid` when available.
- Confirmation before bumping.
- Conventional Commits by default.
- Ships ESM and CJS bundles.
- Supports config file `auto-deploy.config.ts`:

```ts
// auto-deploy.config.ts
import { defineConfig } from '@happyc/auto-deploy'

export default defineConfig({
  // ...options
})
```

