import Docker from 'dockerode';
import fs from 'fs';
import os from 'os';
import path from 'path';

const docker = new Docker();

// Language configuration: image, command, file extension
const LANGUAGE_CONFIG = {
  javascript: {
    image: 'node:20-alpine',
    getCmd: (filename) => ['node', filename],
    extension: '.js',
  },
  typescript: {
    image: 'node:20-alpine',
    getCmd: (filename) => ['sh', '-c', `npx --yes tsx ${filename}`],
    extension: '.ts',
  },
  python: {
    image: 'python:3.12-alpine',
    getCmd: (filename) => ['python', filename],
    extension: '.py',
  },
  java: {
    image: 'eclipse-temurin:21-jdk-alpine',
    getCmd: () => ['sh', '-c', 'javac Main.java && java Main'],
    extension: '.java',
    filename: 'Main.java', // Java requires class name to match filename
  },
  c_cpp: {
    image: 'gcc:14',
    getCmd: (filename) => ['sh', '-c', `gcc ${filename} -o /tmp/code_out -lm && /tmp/code_out`],
    extension: '.c',
  },
  golang: {
    image: 'golang:1.22-alpine',
    getCmd: (filename) => ['go', 'run', filename],
    extension: '.go',
  },
};

const EXECUTION_TIMEOUT_MS = 10000; // 10 seconds
const MEMORY_LIMIT = 256 * 1024 * 1024; // 256 MB
const MAX_OUTPUT_LENGTH = 50000; // Max characters of output

/**
 * Execute code inside a Docker container.
 * @param {string} code - The source code to execute.
 * @param {string} language - The language identifier (matches LANGUAGE_CONFIG keys).
 * @returns {Promise<{output: string, error: string, exitCode: number, executionTime: number, timedOut: boolean}>}
 */
export async function executeCode(code, language) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    return {
      output: '',
      error: `Unsupported language: ${language}`,
      exitCode: 1,
      executionTime: 0,
      timedOut: false,
    };
  }

  // Create a temp directory to hold the code file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-exec-'));
  const filename = config.filename || `code${config.extension}`;
  const codePath = path.join(tempDir, filename);

  try {
    // Write code to temp file
    fs.writeFileSync(codePath, code, 'utf8');

    const startTime = Date.now();
    let timedOut = false;

    // Create container
    const container = await docker.createContainer({
      Image: config.image,
      Cmd: config.getCmd(filename),
      WorkingDir: '/app',
      HostConfig: {
        Binds: [`${tempDir}:/app:ro`],
        Memory: MEMORY_LIMIT,
        MemorySwap: MEMORY_LIMIT, // No swap
        NanoCpus: 500000000, // 0.5 CPU
        NetworkMode: 'none', // No network access
        AutoRemove: false, // We'll remove manually after getting output
        PidsLimit: 64, // Limit number of processes
      },
      NetworkDisabled: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    // Set up timeout
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch {
          // Container may have already stopped
        }
        resolve();
      }, EXECUTION_TIMEOUT_MS);
    });

    // Start container and wait for it to finish
    const runPromise = (async () => {
      await container.start();
      await container.wait();
    })();

    // Race between execution and timeout
    await Promise.race([runPromise, timeoutPromise]);

    const executionTime = Date.now() - startTime;

    // Get logs (stdout and stderr)
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    // Parse multiplexed stream output
    const { stdout, stderr } = demuxStream(logs);

    // Clean up container
    try {
      await container.remove({ force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Truncate output if too long
    let output = stdout;
    let error = stderr;

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n\n... Output truncated (exceeded 50,000 characters)';
    }
    if (error.length > MAX_OUTPUT_LENGTH) {
      error = error.substring(0, MAX_OUTPUT_LENGTH) + '\n\n... Error output truncated (exceeded 50,000 characters)';
    }

    if (timedOut) {
      error = (error ? error + '\n' : '') + `⏱ Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`;
    }

    return {
      output,
      error,
      exitCode: timedOut ? 124 : 0,
      executionTime,
      timedOut,
    };
  } catch (err) {
    return {
      output: '',
      error: `Execution failed: ${err.message}`,
      exitCode: 1,
      executionTime: 0,
      timedOut: false,
    };
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Demultiplex Docker stream output into stdout and stderr strings.
 * Docker multiplexed streams have an 8-byte header per frame:
 *   [stream_type(1), 0, 0, 0, size(4 big-endian)]
 * stream_type: 1 = stdout, 2 = stderr
 */
function demuxStream(buffer) {
  let stdout = '';
  let stderr = '';

  // If buffer is a string, it's already demuxed (TTY mode)
  if (typeof buffer === 'string') {
    return { stdout: buffer, stderr: '' };
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let offset = 0;

  while (offset < buf.length) {
    // Need at least 8 bytes for header
    if (offset + 8 > buf.length) break;

    const streamType = buf.readUInt8(offset);
    const frameSize = buf.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + frameSize > buf.length) break;

    const content = buf.slice(offset, offset + frameSize).toString('utf8');

    if (streamType === 1) {
      stdout += content;
    } else if (streamType === 2) {
      stderr += content;
    }

    offset += frameSize;
  }

  return { stdout, stderr };
}

/**
 * Get list of supported languages.
 */
export function getSupportedLanguages() {
  return Object.keys(LANGUAGE_CONFIG);
}

/**
 * Check if a Docker image exists locally.
 */
async function imageExists(imageName) {
  try {
    const image = docker.getImage(imageName);
    await image.inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check which required images are available.
 */
export async function checkImages() {
  const results = {};
  for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
    results[lang] = {
      image: config.image,
      available: await imageExists(config.image),
    };
  }
  return results;
}
