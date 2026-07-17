#!/usr/bin/env node
import process from 'node:process';
import {runMr} from './mr/index.ts';

const COMMANDS = {mr: runMr};

type Command = keyof typeof COMMANDS;

const isCommand = (value: string): value is Command => value in COMMANDS;

const args = process.argv.slice(2);
const name = args.find(arg => !arg.startsWith('-')) ?? 'mr';

if (!isCommand(name)) {
  console.error(`scripts: unknown command '${name}' (expected: ${Object.keys(COMMANDS).join(', ')})`);
  process.exit(2);
}

await COMMANDS[name]({dryRun: args.includes('--dry-run')});
