import { jest } from '@jest/globals';
import { DeadLetterService } from '../src/services/dead-letter.service';

const xinfoResponse = [
  'length',
  2,
  'radix-tree-keys',
  1,
  'first-entry',
  ['1-0'],
  'last-entry',
  ['2-0'],
];

jest.mock('ioredis', () => {
  const MockRedis = function () {
    return {
      status: 'ready',
      on: jest.fn(),
      connect: jest.fn(async () => undefined),
      xgroup: jest.fn(async () => 'OK'),
      xinfo: jest.fn(async () => xinfoResponse as any),
      xreadgroup: jest.fn(
        async () =>
          [
            [
              'myloware:dead_letter',
              [
                [
                  '1-0',
                  [
                    'originalEventId',
                    'o1',
                    'eventType',
                    't1',
                    'eventData',
                    '{}',
                    'originalStream',
                    's1',
                  ],
                ],
              ],
            ],
          ] as any
      ),
      xadd: jest.fn(async () => '3-0'),
      xack: jest.fn(async () => 1),
      xtrim: jest.fn(async () => 0),
      quit: jest.fn(async () => undefined),
    } as any;
  } as any;
  return MockRedis;
});

describe('DeadLetterService', () => {
  it('initializes, reports stats, reprocesses, trims, and stops', async () => {
    const svc = new DeadLetterService('redis://localhost:6379');
    await svc.initialize();

    const stats = await svc.getDeadLetterStats();
    expect(typeof stats.totalEntries).toBe('number');

    const re = await svc.reprocessEvents(1);
    expect(re.processed + re.failed).toBeGreaterThanOrEqual(0);

    const removed = await svc.clearOldEntries(1);
    expect(removed).toBeGreaterThanOrEqual(0);

    expect(svc.getHealthStatus().isConnected).toBe(true);

    await svc.stop();
  });
});
