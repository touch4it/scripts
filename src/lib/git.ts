import process from 'node:process';
import {execFileSync, spawn} from 'node:child_process';

export type PushResult = {
  code: number | undefined;
  output: string;
};

export function git(args: string[]): string {
  return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

function tryGit(args: string[]): string | undefined {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

export function repoRoot(): string | undefined {
  return tryGit(['rev-parse', '--show-toplevel']);
}

export function currentBranch(): string | undefined {
  return tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

export function originUrl(): string | undefined {
  return tryGit(['remote', 'get-url', 'origin']);
}

export function isDirty(): boolean {
  return git(['status', '--porcelain']).length > 0;
}

/** Best-effort: a stale remote-tracking ref is better than hanging on a dead network. */
export function fetchOrigin(): boolean {
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {...process.env, GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=8 -o BatchMode=yes'},
    });
    return true;
  } catch {
    return false;
  }
}

export function hasRef(ref: string): boolean {
  return tryGit(['rev-parse', '--verify', '--quiet', ref]) !== undefined;
}

export function revision(ref: string): string | undefined {
  return tryGit(['rev-parse', ref]);
}

export function commitsAhead(target: string): number {
  return Number(git(['rev-list', '--count', `origin/${target}..HEAD`]));
}

/** Subject of the oldest commit on the branch — the one that named the work. */
export function firstCommitSubject(target: string): string {
  const subjects = git(['log', '--format=%s', `origin/${target}..HEAD`]).split('\n').filter(Boolean);
  return subjects.at(-1) ?? '';
}

/** Streams push output through to the terminal while capturing it for inspection. */
export async function push({options, branch}: {options: string[]; branch: string}): Promise<PushResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['push', '--set-upstream', ...options, 'origin', `HEAD:refs/heads/${branch}`], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    const tee = (stream: NodeJS.ReadableStream, sink: NodeJS.WritableStream): void => {
      // Decoding per chunk would mangle a multi-byte character split across a chunk boundary.
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output += chunk;
        sink.write(chunk);
      });
    };

    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', code => {
      resolve({code: code ?? undefined, output});
    });
  });
}
