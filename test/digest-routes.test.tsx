import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

const dirs: string[] = [];

function runsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

function configFor(dir: string): RigConfig {
  return {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves the same sorted jobs as HTML and JSON, preserving null owners, warning rows, and time offsets', async () => {
    const events = [
      { at: '2026-10-28T23:10:00+01:00', job: 'zeta', owner: null, status: 'fail', error: 'quota exceeded' },
      { at: '2026-10-28T23:00:00+01:00', job: 'retrying', owner: 'rook', status: 'retry', error: 'upstream 503' },
      { at: '2026-10-28T23:01:00+01:00', job: 'retrying', owner: 'rook', status: 'retry' },
      { at: '2026-10-28T23:02:00+01:00', job: 'retrying', owner: 'rook', status: 'retry' },
      { at: '2026-10-28T23:03:00+01:00', job: 'retrying', owner: 'rook', status: 'ok' },
      { at: '2026-10-28T23:05:00+05:30', job: '<script>alert(1)</script>', owner: null, status: 'ok', error: '</td><script>alert(1)</script>' },
    ];
    const dir = runsDir({
      '2026-10-28.jsonl': events.map((event) => JSON.stringify(event)).join('\n') + '\n{bad line\n',
    });
    const app = createApp(configFor(dir));

    const [page, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    const html = await page.text();
    const digest = await json.json() as NightDigest;

    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual(['<script>alert(1)</script>', 'retrying', 'zeta']);
    expect(digest.rows[0]).toMatchObject({ owner: null, firstAt: '2026-10-28T23:05:00+05:30', lastAt: '2026-10-28T23:05:00+05:30' });
    expect(digest.rows[1]).toMatchObject({ retries: 3, lastStatus: 'ok' });
    expect(digest.rows[2]).toMatchObject({ lastStatus: 'fail' });

    const tbody = html.match(/<tbody>(.*?)<\/tbody>/s)?.[1] ?? '';
    const htmlJobs = [...tbody.matchAll(/<tr(?: class="([^"]+)")?><td>(.*?)<\/td>/g)];
    expect(htmlJobs.map((match) => match[2])).toEqual([
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      'retrying',
      'zeta',
    ]);
    expect(htmlJobs.map((match) => match[1] ?? null)).toEqual([null, 'warn', 'warn']);
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('2026-10-28T23:05:00+05:30');
    expect(html).toContain('&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script\b/i);
  });

  it('returns 404 from both endpoints when the night file is missing', async () => {
    const app = createApp(configFor(runsDir({})));
    const [page, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(page.status).toBe(404);
    expect(await page.text()).toBe('night not found');
    expect(json.status).toBe(404);
    expect(await json.json()).toEqual({ error: 'night not found' });
  });

  it('renders an empty file as nothing ran and returns an empty JSON digest', async () => {
    const app = createApp(configFor(runsDir({ '2026-10-28.jsonl': '' })));
    const [page, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night: '2026-10-28',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps a malformed line visible in the digest while returning 200', async () => {
    const dir = runsDir({
      '2026-10-28.jsonl': [
        JSON.stringify({ at: '2026-10-28T23:00:00-07:00', job: 'kept', owner: 'rook', status: 'ok' }),
        '{not json',
      ].join('\n'),
    });
    const app = createApp(configFor(dir));
    const [page, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('malformed lines: 1');
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ badLines: 1, rows: [{ job: 'kept' }] });
  });
});
