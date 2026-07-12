import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

if (process.versions.node.split('.')[0] !== '24') {
  console.error(`Voluble requires Node 24 for local Vercel Functions; found ${process.version}. Run: nvm use`);
  process.exit(1);
}

if (!existsSync('.env.local')) {
  console.error('Missing .env.local. Create it with: cp .env.example .env.local');
  process.exit(1);
}

process.loadEnvFile('.env.local');

const required = [
  'APP_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PICKER_API_KEY',
  'GOOGLE_KMS_KEY_NAME',
  'POSTGRES_URL',
  'SESSION_SECRET'
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Missing required variables in .env.local: ${missing.join(', ')}`);
  process.exit(1);
}

const forwarded = process.argv.slice(2);
const hasListen = forwarded.includes('--listen') || forwarded.includes('-l');
const args = ['vercel', 'dev', ...(hasListen ? [] : ['--listen', '3000']), ...forwarded];
const child = spawn('npx', args, { stdio: 'inherit', env: process.env });

child.on('error', (error) => {
  console.error(`Unable to start Vercel CLI: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
