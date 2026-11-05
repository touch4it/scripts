import process from 'node:process';
import {execFile, spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- backported to 20.12, the lowest supported Node
import {parseEnv} from 'node:util';

const TIMEOUT_MS = 15_000;
const ENV_FILE_KEYS = ['GITLAB_TOKEN', 'GITLAB_HOST'];

/** The environment for glab: the env file's glab variables, overridden by any the shell already sets. */
export function glabEnv(envFileText: string | undefined, shell: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const fromFile = envFileText === undefined ? {} : parseEnv(envFileText);
  const picked = Object.fromEntries(ENV_FILE_KEYS.flatMap(key => {
    const value = fromFile[key];
    return value === undefined ? [] : [[key, value]];
  }));
  return {...picked, ...shell};
}

type GlabRun = {stdout: string} | {failure: 'missing' | 'failed'};

async function runGlab(args: string[], env: NodeJS.ProcessEnv): Promise<GlabRun> {
  return new Promise(resolve => {
    execFile('glab', args, {env, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024}, (error, stdout) => {
      if (error) {
        resolve({failure: error.code === 'ENOENT' ? 'missing' : 'failed'});
        return;
      }

      resolve({stdout});
    });
  });
}

export type Glab = {
  host: string;
  getJson: (path: string) => Promise<unknown>;
  /** Runs glab with stdin fed from `input` and output streamed to the terminal. */
  exec: (args: string[], input: string) => Promise<number | undefined>;
};

export type GlabStatus
  = | {kind: 'ready'; glab: Glab}
    | {kind: 'missing'}
    | {kind: 'logged-out'; host: string};

/** Glab only counts as available when it can authenticate against this exact host. */
export async function connectGlab(host: string, envFile: string): Promise<GlabStatus> {
  const env = glabEnv(existsSync(envFile) ? readFileSync(envFile, 'utf8') : undefined, process.env);
  const auth = await runGlab(['auth', 'status', '--hostname', host], env);
  if ('failure' in auth) {
    return auth.failure === 'missing' ? {kind: 'missing'} : {kind: 'logged-out', host};
  }

  return {
    kind: 'ready',
    glab: {
      host,
      async getJson(path) {
        const result = await runGlab(['api', '--hostname', host, '--paginate', path], env);
        if ('failure' in result) {
          throw new Error(`glab api ${path} failed`);
        }

        return JSON.parse(result.stdout) as unknown;
      },
      async exec(args, input) {
        return new Promise((resolve, reject) => {
          const child = spawn('glab', args, {env, stdio: ['pipe', 'inherit', 'inherit']});
          child.on('error', reject);
          child.on('close', code => {
            resolve(code ?? undefined);
          });
          child.stdin.end(input);
        });
      },
    },
  };
}

export const projectPath = (project: string): string => `projects/${encodeURIComponent(project)}`;
