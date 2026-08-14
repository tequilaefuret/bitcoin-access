import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeLogText } from '../supabase/functions/_shared/logging.mjs';

const functionRoot = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const testAddresses = [
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  'tb1qfm4w3g3q9m4pr7n0k8q07c8ef0r7j4t6l2p9fs',
  'bcrt1qft5e4ds9ye67l4x3ek8d9f6z0gyg7kv8tz2v3a',
  '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',
];

const sanitized = sanitizeLogText(`Database error for ${testAddresses.join(' and ')}`);
for (const address of testAddresses) {
  if (sanitized.includes(address)) {
    throw new Error(`Logging sanitizer leaked a Bitcoin address: ${address}`);
  }
}

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

const unsafePatterns = [
  { pattern: /\baddressTrunc\b/, reason: 'a truncated address is logged' },
  { pattern: /console\.[a-z]+\([^\n]*(?:\baddress\b|\bbitcoinAddress\b)(?!Info)/i, reason: 'an address is passed directly to a logger' },
  { pattern: /console\.[a-z]+\([^\n]*(?:address|bitcoinAddress)[^\n]*\.slice\s*\(/i, reason: 'an address slice is passed to a logger' },
];

for (const file of listTypeScriptFiles(functionRoot)) {
  const source = readFileSync(file, 'utf8');
  for (const { pattern, reason } of unsafePatterns) {
    if (pattern.test(source)) throw new Error(`${file}: ${reason}`);
  }
}

process.stdout.write('Server logging valid: Bitcoin addresses are redacted.\n');
