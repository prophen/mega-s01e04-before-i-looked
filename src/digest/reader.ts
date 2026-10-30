import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v.at) ||
    !validNight(v.at.slice(0, 10)) || !Number.isFinite(Date.parse(v.at)) ||
    typeof v.job !== 'string' || !v.job.trim() ||
    (v.status !== 'ok' && v.status !== 'retry' && v.status !== 'fail') ||
    (v.owner !== null && typeof v.owner !== 'string') ||
    (v.error !== undefined && typeof v.error !== 'string')
  ) return null;
  return { at: v.at, job: v.job, status: v.status, owner: v.owner, ...(v.error === undefined ? {} : { error: v.error }) };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validNight(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const events: RunEvent[] = [];
  let badLines = 0;
  const lines = text.split(/\r?\n/);
  // A newline terminates a record; it does not create one more empty record.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const event = parseEvent(line);
    if (event) events.push(event);
    else badLines++;
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status]++;
    let row = rows.get(event.job);
    if (!row) {
      row = { job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at };
      rows.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error !== undefined) row.lastError = event.error;
  }
  return { night, rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0), badLines, counts };
};
