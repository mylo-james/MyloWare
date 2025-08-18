import { HealthController } from '../src/controllers/health.controller';

describe('HealthController', () => {
  it('returns basic health', () => {
    const c = new HealthController();
    const h = c.getHealth();
    expect(h.status).toBe('healthy');
  });

  it('returns detailed health', () => {
    const c = new HealthController();
    const d = c.getDetailedHealth();
    expect(d.dependencies.redis.status).toBe('healthy');
  });

  it('returns readiness and liveness', () => {
    const c = new HealthController();
    expect(c.getReadiness().ready).toBe(true);
    expect(c.getLiveness().alive).toBe(true);
  });
});
