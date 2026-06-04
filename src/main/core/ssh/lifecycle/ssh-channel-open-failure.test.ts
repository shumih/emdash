import { describe, expect, it } from 'vitest';
import { isSshChannelOpenFailure } from './ssh-channel-open-failure';

describe('isSshChannelOpenFailure', () => {
  it('classifies explicit resource shortage as channel-open-failed', () => {
    const error = Object.assign(new Error('(SSH) Channel open failure: resource shortage'), {
      reason: 4,
    });

    expect(isSshChannelOpenFailure(error)).toBe(true);
  });

  it('classifies no more sessions messages as channel-open-failed', () => {
    expect(isSshChannelOpenFailure(new Error('No more sessions'))).toBe(true);
  });

  it('classifies administratively prohibited as channel-open-failed', () => {
    const error = Object.assign(
      new Error('(SSH) Channel open failure: administratively prohibited'),
      {
        reason: 1,
      }
    );

    expect(isSshChannelOpenFailure(error)).toBe(true);
  });

  it('ignores non-session channel-open failures (connect failed / unknown channel type)', () => {
    expect(
      isSshChannelOpenFailure(
        Object.assign(new Error('(SSH) Channel open failure: open failed'), { reason: 2 })
      )
    ).toBe(false);

    expect(
      isSshChannelOpenFailure(
        Object.assign(new Error('(SSH) Channel open failure: unknown channel type'), { reason: 3 })
      )
    ).toBe(false);
  });

  it('ignores unrelated numeric reason fields outside the SSH failure-code range', () => {
    const error = Object.assign(new Error('temporary system error'), {
      reason: 0,
    });

    expect(isSshChannelOpenFailure(error)).toBe(false);
  });

  it('ignores non-channel errors', () => {
    expect(isSshChannelOpenFailure(new Error('permission denied'))).toBe(false);
  });
});
