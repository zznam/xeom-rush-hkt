import { expect, it } from 'vitest';
import { TickMetrics } from './tick-metrics';
it('reports bounded quantiles conservatively, including unusually slow ticks', () => {
  const metrics = new TickMetrics();
  for (let i = 0; i < 94; i++) metrics.record(1.01);
  for (let i = 0; i < 6; i++) metrics.record(150);
  metrics.record(Number.NaN);
  expect(metrics.snapshot()).toMatchObject({ ticks: 100, p95Ms: 150, maxMs: 150 });
});
