import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const landing = await readFile(resolve(root, 'docs/index.html'), 'utf8');
const appIndex = await readFile(resolve(root, 'docs/app/index.html'), 'utf8');
const assets = await readdir(resolve(root, 'docs/app/assets'));

const checks = [
  [landing.includes('href="./app/"'), 'project page links to ./app/'],
  [
    landing.includes('https://github.com/hme222/MTA_Accessbility_Trip_Planning'),
    'project page links to the exact source repository',
  ],
  [
    appIndex.includes('/MTA_Accessbility_Trip_Planning/app/assets/'),
    'app assets use the GitHub Pages repository base path',
  ],
  [assets.some((name) => name.startsWith('demoApi-') && name.endsWith('.js')), 'demo adapter chunk exists'],
  [assets.some((name) => name.endsWith('.css')), 'compiled app stylesheet exists'],
];

const failed = checks.filter(([pass]) => !pass);
for (const [pass, label] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed.length) process.exitCode = 1;
