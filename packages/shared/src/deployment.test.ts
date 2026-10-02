import { describe, expect, it } from 'vitest';
import { resolveDeploymentTarget, resolveRegions } from './deployment';

describe('deployment isolation', () => {
  const region = { id: 'ap-southeast-1', label: 'Singapore', apiUrl: 'https://sg.example.com' };
  it('defaults to legacy and ignores even malformed AWS settings', () => {
    expect(resolveDeploymentTarget()).toBe('legacy');
    expect(resolveRegions(resolveDeploymentTarget(), 'not valid JSON')).toEqual([]);
    expect(resolveRegions('legacy', JSON.stringify([region]))).toEqual([]);
  });
  it('requires an explicit regional target and complete configuration', () => {
    expect(resolveDeploymentTarget('regional-production')).toBe('regional-production');
    expect(resolveRegions('regional-production', JSON.stringify([region]))).toEqual([region]);
    expect(() => resolveDeploymentTarget('regional')).toThrow('Deployment target');
    expect(() => resolveRegions('regional-production')).toThrow('requires a region directory');
    expect(() => resolveRegions('regional-production', JSON.stringify([region, region]))).toThrow('duplicate');
  });
  it('rejects insecure production endpoints while allowing local regional tests', () => {
    const local = JSON.stringify([{ ...region, apiUrl: 'http://localhost:3002' }]);
    expect(() => resolveRegions('regional-production', local)).toThrow('HTTPS');
    expect(resolveRegions('regional-production', local, false)[0].apiUrl).toBe('http://localhost:3002');
    for (const apiUrl of [
      'https://user:password@sg.example.com',
      'https://sg.example.com/rooms/a',
      'https://sg.example.com?key=value',
    ])
      expect(() => resolveRegions('regional-production', JSON.stringify([{ ...region, apiUrl }]))).toThrow('origin');
  });
});
