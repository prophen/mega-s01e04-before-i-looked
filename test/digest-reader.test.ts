import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const dirs: string[] = [];
function fixture(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  dirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), text);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

describe('readNight', () => {
  it('reads the supplied night without losing failed jobs, retries or null owners', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('orders by instants, preserving timestamp offsets and the latest owner', () => {
    const dir = fixture([
      { at: '2026-10-29T01:00:00+02:00', job: 'job', owner: null, status: 'fail', error: 'latest' },
      { at: '2026-10-29T00:30:00+02:00', job: 'job', owner: 'old', status: 'retry', error: 'old' },
      { at: '2026-10-29T00:00:00+01:00', job: 'job', owner: 'final', status: 'ok' },
    ].map((event) => JSON.stringify(event)).join('\n'));
    expect(readNight(dir, '2026-10-28')?.rows[0]).toEqual({
      job: 'job', owner: 'final', runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstAt: '2026-10-29T00:30:00+02:00', lastAt: '2026-10-29T00:00:00+01:00',
    });
  });

  it('counts invalid JSON and invalid event fields, retaining valid rows', () => {
    const valid = { at: '2026-10-28T23:00:00+01:00', job: 'safe', owner: null, status: 'ok' };
    const dir = fixture(['{', 'null', '[]', JSON.stringify({ ...valid, status: 'unknown' }),
      JSON.stringify({ ...valid, owner: 2 }), JSON.stringify({ ...valid, at: '2026-02-30T23:00:00+01:00' }),
      JSON.stringify(valid)].join('\n') + '\n');
    expect(readNight(dir, '2026-10-28')).toMatchObject({ badLines: 6, counts: { ok: 1, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-28')?.rows).toHaveLength(1);
  });

  it('distinguishes empty and missing nights and rejects unsafe or invalid dates', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-28')).toEqual({ night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-29')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
    expect(readNight(dir, '2026-02-30')).toBeNull();
  });
});
