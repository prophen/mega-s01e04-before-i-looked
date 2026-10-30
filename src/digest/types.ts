/** Shared contract for the digest reader, HTML page, JSON route and status board. */
export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner of the latest event; null is displayed as an em dash. */
  owner: string | null;
  /** Number of valid events for this job, including retries and failures. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent error observed, even if a later successful event has no error. */
  lastError: string | null;
  /** Earliest/latest event instants, retaining their original timestamp offsets. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** Sorted by job using code-point order. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log events, rather than counts of final job states. */
  counts: Record<RunStatus, number>;
};

/**
 * Implemented/exported by ./reader.ts as readNight(runsDir, night).
 * Returns null for an invalid YYYY-MM-DD or missing file; an empty file returns
 * an empty digest. Invalid JSON or invalid event shapes increment badLines.
 * Filesystem errors other than a missing file are allowed to propagate.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
