#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadState, signBip322Simple } from './danaus-real-test.mjs';

const SITE_URL = 'https://danaus-dev.netlify.app/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENSHOT = path.join(ROOT, '.secrets', 'danaus-browser-smoke.png');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error('Unable to connect to Chrome DevTools'));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function runtimeValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  }
  return result.result?.value;
}

function clickTextExpression(text) {
  return `(() => {
    const wanted = ${JSON.stringify(text)};
    const element = [...document.querySelectorAll('button, a')]
      .find((candidate) => candidate.textContent.trim() === wanted);
    if (!element) return false;
    element.click();
    return true;
  })()`;
}

function fillPlaceholderExpression(placeholder, value) {
  return `(() => {
    const element = document.querySelector('[placeholder=${JSON.stringify(placeholder)}]');
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

async function clickText(cdp, text) {
  const clicked = await runtimeValue(cdp, clickTextExpression(text));
  if (!clicked) throw new Error(`Could not find browser control: ${text}`);
}

async function main() {
  const state = loadState();
  const account = state.accounts[99];
  if (!account?.registered) throw new Error('Test account 100 is not ready');

  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'danaus-browser-smoke-'));
  const debuggingPort = 19223;
  const chrome = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let cdp;
  try {
    const targets = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
        return response.ok ? response.json() : null;
      } catch {
        return null;
      }
    }, 'Chrome DevTools');
    const page = targets.find((target) => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target unavailable');

    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: SITE_URL });
    await waitFor(
      () => runtimeValue(cdp, "document.readyState === 'complete' && document.body.innerText.includes('Bitcoin opens the door.')"),
      'Danaus landing page',
    );

    await clickText(cdp, 'Open Danaus');
    await waitFor(
      () => runtimeValue(cdp, "document.body.innerText.includes('Sign in with your password')"),
      'Danaus sign-in screen',
    );
    await clickText(cdp, 'Wallet');
    await clickText(cdp, 'Browser');
    await clickText(cdp, 'Manual signature');
    await waitFor(
      () => runtimeValue(cdp, "Boolean(document.querySelector('[placeholder=\"1..., 3... or bc1...\"]'))"),
      'manual Bitcoin address field',
    );

    const addressFilled = await runtimeValue(
      cdp,
      fillPlaceholderExpression('1..., 3... or bc1...', account.address),
    );
    if (!addressFilled) throw new Error('Could not fill Bitcoin address');
    await clickText(cdp, 'Generate challenge');

    const challenge = await waitFor(
      () => runtimeValue(cdp, `(() => {
        const value = document.querySelector('pre')?.innerText || '';
        return value.includes('Bitcoin Access authentication request') ? value : '';
      })()`),
      'server authentication challenge',
    );
    const signature = signBip322Simple(
      challenge,
      Buffer.from(account.privateKey, 'hex'),
      Buffer.from(account.publicKey, 'hex'),
      account.address,
    );
    const signatureFilled = await runtimeValue(
      cdp,
      fillPlaceholderExpression('Paste the signature returned by your wallet', signature),
    );
    if (!signatureFilled) throw new Error('Could not fill BIP-322 signature');
    await clickText(cdp, 'Verify signature');

    await waitFor(
      () => runtimeValue(cdp, `document.body.innerText.includes(${JSON.stringify(account.displayName)}) || document.body.innerText.includes('Classic')`),
      'authenticated social screen',
      45_000,
    );
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT, Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
    fs.chmodSync(SCREENSHOT, 0o600);

    const title = await runtimeValue(cdp, 'document.title');
    const bodyText = await runtimeValue(cdp, 'document.body.innerText');
    process.stdout.write(`${JSON.stringify({
      success: true,
      title,
      account: account.index,
      displayNameVisible: bodyText.includes(account.displayName),
      socialScreenVisible: bodyText.includes('Classic'),
      screenshot: path.relative(ROOT, SCREENSHOT),
    }, null, 2)}\n`);
  } finally {
    try {
      await cdp?.send('Browser.close');
    } catch {
      chrome.kill('SIGTERM');
    }
    cdp?.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Danaus browser smoke failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
