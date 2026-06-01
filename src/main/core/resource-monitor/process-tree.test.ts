import { describe, expect, it } from 'vitest';
import { parseChildrenIndex, subtreePids } from './process-tree';

describe('parseChildrenIndex', () => {
  it('maps each ppid to its direct children from `ps -axo pid=,ppid=` output', () => {
    const stdout = ['  100     1', '  200   100', '  300   100', '  400   200'].join('\n');
    const index = parseChildrenIndex(stdout);
    expect(index.get(1)).toEqual([100]);
    expect(index.get(100)).toEqual([200, 300]);
    expect(index.get(200)).toEqual([400]);
    expect(index.get(400)).toBeUndefined();
  });

  it('ignores blank lines and malformed rows (e.g. a header)', () => {
    const stdout = ['PID  PPID', '', '  100     1', 'garbage', '  200   100'].join('\n');
    const index = parseChildrenIndex(stdout);
    expect(index.get(1)).toEqual([100]);
    expect(index.get(100)).toEqual([200]);
    expect(index.size).toBe(2);
  });
});

describe('subtreePids', () => {
  const children = new Map<number, number[]>([
    [100, [200, 300]],
    [200, [400]],
    [300, [500, 600]],
  ]);

  it('returns the root plus every descendant (inclusive)', () => {
    expect(subtreePids(100, children).sort((a, b) => a - b)).toEqual([
      100, 200, 300, 400, 500, 600,
    ]);
  });

  it('returns just the root when it has no children', () => {
    expect(subtreePids(400, children)).toEqual([400]);
  });

  it('returns a partial subtree for an intermediate node', () => {
    expect(subtreePids(300, children).sort((a, b) => a - b)).toEqual([300, 500, 600]);
  });

  it('is cycle-safe (does not loop forever on a self/back reference)', () => {
    const cyclic = new Map<number, number[]>([
      [1, [2]],
      [2, [1, 3]],
    ]);
    expect(subtreePids(1, cyclic).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
