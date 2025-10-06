import { describe, it, expect } from 'vitest';
import { joinUrl } from './url';

describe('joinUrl', () => {
  it('joins base and path with single slash', () => {
    expect(joinUrl('http://example.com', '/foo')).toBe('http://example.com/foo');
  });

  it('handles multiple parts and trims extra slashes', () => {
    expect(joinUrl('http://example.com/', '/foo/', '/bar')).toBe('http://example.com/foo/bar');
  });

  it('collapses duplicate slashes without affecting protocol', () => {
    expect(joinUrl('http://example.com//', '//foo//bar')).toBe('http://example.com/foo/bar');
  });

  it('joins relative base paths', () => {
    expect(joinUrl('/api', 'v1', '/users')).toBe('/api/v1/users');
  });
});
