import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { bestOfMs } from './_helpers.ts';

describe('bestOfMs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the fastest of the runs, so one descheduled sample does not decide', () => {
    // Clock readings in pairs (start, end): 700 ms, 120 ms, 130 ms.
    const readings = [0, 700, 1000, 1120, 2000, 2130];
    vi.spyOn(performance, 'now').mockImplementation(() => readings.shift()!);
    let calls = 0;
    const best = bestOfMs(() => {
      calls++;
    });
    expect(calls).toBe(3);
    expect(best).toBe(120);
  });

  it('still reports a consistently slow implementation as slow', () => {
    const readings = [0, 600, 1000, 1650, 2000, 2610];
    vi.spyOn(performance, 'now').mockImplementation(() => readings.shift()!);
    expect(bestOfMs(() => {})).toBe(600);
  });

  it('honours the run count and propagates a throw from fn', () => {
    let calls = 0;
    bestOfMs(() => {
      calls++;
    }, 5);
    expect(calls).toBe(5);
    expect(() =>
      bestOfMs(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});
