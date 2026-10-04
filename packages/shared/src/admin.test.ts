import { describe, expect, it } from 'vitest';
import { defaultCityConfig, validateCityConfig } from './admin';
describe('runtime configuration boundary', () => {
  it('retains existing standard game defaults', () => {
    expect(validateCityConfig(defaultCityConfig()).rules.speed).toBe(200);
  });
  it('requires sandbox for every nonstandard rule', () => {
    const config = defaultCityConfig();
    config.rules.speed = 250;
    expect(() => validateCityConfig(config)).toThrow('sandbox');
    config.mode = 'sandbox';
    expect(validateCityConfig(config).rules.speed).toBe(250);
  });
  it.each([NaN, Infinity, -1, 51, 1.5])('rejects invalid bot count %s', (value) => {
    const config = defaultCityConfig();
    config.bots.count = value;
    expect(() => validateCityConfig(config)).toThrow();
  });
  it('rejects unknown fields, malformed mixtures and reversed bounds', () => {
    expect(() => validateCityConfig({ ...defaultCityConfig(), surprise: true })).toThrow();
    const config = defaultCityConfig();
    config.bots.mix.easy = 5;
    expect(() => validateCityConfig(config)).toThrow('100');
    config.bots.mix.easy = 0;
    config.bots.minimum = 30;
    expect(() => validateCityConfig(config)).toThrow('minimum');
  });
});
