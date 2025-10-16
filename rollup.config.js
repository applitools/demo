import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'src/server.ts',
  output: {
    file: 'dist/bundle.js',
    format: 'es',
    sourcemap: true,
    banner: '#!/usr/bin/env node'
  },
  plugins: [
    json(),
    resolve({
      preferBuiltins: true
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      outputToFilesystem: false
    })
  ],
  external: ['express']
};
