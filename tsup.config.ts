import { defineConfig } from 'tsup'
import packageJson from './package.json';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'cli': 'src/cli.ts',
  },
  external: Object.keys(packageJson.dependencies),
  format: ['cjs', 'esm'],
  cjsInterop: true,
  splitting: true,
  keepNames: true,
  silent: true,
  clean: true,
  target: 'es2020',
  sourcemap: false,
  dts: {
    compilerOptions: {
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'node',
      resolveJsonModule: true,
      esModuleInterop: true,
      lib: [
        'dom',
        'esnext'
      ],
    }
  },
})
