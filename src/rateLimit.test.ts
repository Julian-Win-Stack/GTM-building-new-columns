import { describe, it, expect } from 'vitest';
import Bottleneck from 'bottleneck';

describe('bottleneck rate limiter at our configured shape', () => {
  it('releases no more than N tasks per 1s window', async () => {
    const qps = 5;
    const limiter = new Bottleneck({
      reservoir: qps,
      reservoirRefreshAmount: qps,
      reservoirRefreshInterval: 1000,
      minTime: Math.floor(1000 / qps),
    });

    const start = Date.now();
    const starts: number[] = [];
    const tasks = Array.from({ length: qps * 2 }, () =>
      limiter.schedule(async () => {
        starts.push(Date.now() - start);
        await new Promise((r) => setTimeout(r, 10));
      })
    );
    await Promise.all(tasks);

    const firstWindow = starts.filter((t) => t < 1000).length;
    expect(firstWindow).toBeLessThanOrEqual(qps);
  });

  it('does not block other scheduled calls when one call is slow', async () => {
    const limiter = new Bottleneck({
      reservoir: 5,
      reservoirRefreshAmount: 5,
      reservoirRefreshInterval: 1000,
      minTime: 10,
    });

    const order: string[] = [];
    const slow = limiter.schedule(async () => {
      await new Promise((r) => setTimeout(r, 80));
      order.push('slow');
    });
    const fast = limiter.schedule(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('fast');
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(['fast', 'slow']);
  });
});
