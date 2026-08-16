import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const landing = await readFile(resolve(root, 'docs/index.html'), 'utf8');
const appIndex = await readFile(resolve(root, 'docs/app/index.html'), 'utf8');
const assets = await readdir(resolve(root, 'docs/app/assets'));
const demoAsset = assets.find((name) => name.startsWith('demoApi-') && name.endsWith('.js'));
const appAsset = assets.find((name) => name.startsWith('index-') && name.endsWith('.js'));
const demoBundle = demoAsset
  ? await readFile(resolve(root, 'docs/app/assets', demoAsset), 'utf8')
  : '';
const appBundle = appAsset
  ? await readFile(resolve(root, 'docs/app/assets', appAsset), 'utf8')
  : '';

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
  [Boolean(demoAsset), 'demo adapter chunk exists'],
  [assets.some((name) => name.endsWith('.css')), 'compiled app stylesheet exists'],
  [demoBundle.includes('BUS_M42_7AV'), 'demo bundle includes representative bus stops'],
  [demoBundle.includes('detectable_warning'), 'demo bundle includes detailed curb-ramp data'],
  [appBundle.includes('Selected locations'), 'app bundle includes the selection-triggered map'],
  [appBundle.includes('Check equipment affecting subway accessibility'), 'app bundle includes improved outage disclosures'],
];

const failed = checks.filter(([pass]) => !pass);
for (const [pass, label] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
}

if (failed.length) process.exitCode = 1;
