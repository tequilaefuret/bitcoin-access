import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const parseEnvFile = (filePath) => {
  try {
    return Object.fromEntries(
      readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        })
    );
  } catch {
    return {};
  }
};

const repositoryRoot = resolve(import.meta.dirname, '..');
const fileEnvironment = parseEnvFile(resolve(repositoryRoot, '.env.production'));
const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || fileEnvironment.REACT_APP_SUPABASE_URL || '')
  .replace(/\/$/, '');

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
  throw new Error('REACT_APP_SUPABASE_URL must be a valid Supabase project URL before building.');
}

const routes = [
  `/api/auth/*  ${supabaseUrl}/functions/v1/:splat  200`,
  '/*  /index.html  200',
  '',
].join('\n');

writeFileSync(resolve(repositoryRoot, 'public', '_redirects'), routes, 'utf8');
