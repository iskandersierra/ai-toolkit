import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const defaultRetries = 4;
const defaultDelayMs = 15000;
const retryableOutputPattern = /vscode-updating is held|Code is currently being updated|EPIPE: broken pipe, write/i;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getVscodeTestCommand() {
  return {
    executable: process.execPath,
    args: [path.join(process.cwd(), 'node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs')],
    checkPath: path.join(process.cwd(), 'node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs'),
  };
}

async function ensureCommandExists(commandPath) {
  try {
    await access(commandPath);
  } catch {
    console.error(`Unable to find vscode-test executable at ${commandPath}.`);
    process.exit(1);
  }
}

function runAttempt(commandPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandPath.executable, commandPath.args.concat(args), {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let combinedOutput = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        combinedOutput,
      });
    });
  });
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function main() {
  const retries = parsePositiveInteger(process.env.VSCODE_TEST_MUTEX_RETRIES, defaultRetries);
  const delayMs = parsePositiveInteger(process.env.VSCODE_TEST_MUTEX_DELAY_MS, defaultDelayMs);
  const commandPath = getVscodeTestCommand();
  const args = process.argv.slice(2);

  await ensureCommandExists(commandPath.checkPath);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await runAttempt(commandPath, args);
    if (result.code === 0) {
      process.exit(0);
    }

    const shouldRetry = retryableOutputPattern.test(result.combinedOutput);
    const hasAttemptsRemaining = attempt < retries;
    if (!shouldRetry || !hasAttemptsRemaining) {
      process.exit(result.code);
    }

    const retryNumber = attempt + 1;
    console.error(
      `Detected transient VS Code updater lock. Retrying test launch in ${delayMs}ms (${retryNumber}/${retries}).`,
    );
    await sleep(delayMs);
  }
}

await main();