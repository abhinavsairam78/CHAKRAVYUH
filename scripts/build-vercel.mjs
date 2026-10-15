import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await writeFile('dist/hosting.js', 'window.CHAKRAVYUH_HOSTED = true;\n');
