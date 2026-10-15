import { describe, expect, it } from 'vitest';
import { redirectHttpResponse } from './http';
import {
  collapseTarget,
  isSystemPath,
  normalizeInternalPath,
  omitRedirectedPaths,
  redirectOutcome,
  skipsRedirectLookup,
  type RedirectEdge,
} from './rules';

const edge = (fromPath: string, toPath: string, statusCode = 301, enabled = 1): RedirectEdge => ({ fromPath, toPath, statusCode, enabled });

describe('chuẩn hóa đường dẫn', () => {
  it('chỉ nhận đường nội bộ đã chuẩn hóa', () => {
    expect(normalizeInternalPath(' /Kien-Thuc/Bai-Moi/ ')).toBe('/kien-thuc/bai-moi');
    expect(normalizeInternalPath('kien-thuc/bai-moi')).toBe('/kien-thuc/bai-moi');
    expect(normalizeInternalPath('/kien-thuc/bai-moi/')).toBe('/kien-thuc/bai-moi');
    expect(normalizeInternalPath('/')).toBe('/');
    expect(normalizeInternalPath('https://evil.example/kien-thuc/a')).toBeNull();
    expect(normalizeInternalPath('//evil.example')).toBeNull();
    expect(normalizeInternalPath('/kien-thuc/../admin')).toBeNull();
    expect(normalizeInternalPath('/kien-thuc/%2e%2e/admin')).toBeNull();
    expect(normalizeInternalPath('/kien-thuc/a?next=https://evil.example')).toBeNull();
    expect(normalizeInternalPath('/file.png')).toBeNull();
    expect(isSystemPath('/admin/posts')).toBe(true);
    expect(isSystemPath('/media/a.jpg')).toBe(true);
    expect(isSystemPath('/sitemap.xml')).toBe(true);
    expect(isSystemPath('/kien-thuc/bai')).toBe(false);
  });

  it('không hỏi database cho tài nguyên tĩnh', () => {
    expect(skipsRedirectLookup('/favicon.svg')).toBe(true);
    expect(skipsRedirectLookup('/_astro/app.css')).toBe(true);
    expect(skipsRedirectLookup('/media/anh.webp')).toBe(true);
    expect(skipsRedirectLookup('/kien-thuc/bai-cu')).toBe(false);
    expect(skipsRedirectLookup('/trang-cu')).toBe(false);
  });
});

describe('chuỗi và vòng lặp', () => {
  it('trỏ thẳng tới đích cuối, không giữ chuỗi', () => {
    const edges = [edge('/a', '/b'), edge('/b', '/c')];
    expect(collapseTarget('/a', '/b', edges)).toEqual({ ok: true, toPath: '/c' });
    expect(collapseTarget('/moi', '/b', edges)).toEqual({ ok: true, toPath: '/c' });
  });

  it('từ chối vòng lặp và nguồn trùng đích', () => {
    expect(collapseTarget('/a', '/b', [edge('/b', '/a')])).toEqual({ ok: false, error: 'Đường dẫn này tạo vòng lặp chuyển hướng.' });
    expect(collapseTarget('/a', '/a', [])).toEqual({ ok: false, error: 'URL nguồn và URL đích trùng nhau.' });
    expect(collapseTarget('/a', '/b', [edge('/a', '/cu', 301, 0)])).toEqual({ ok: true, toPath: '/b' });
  });
});

describe('quyết định lúc truy cập', () => {
  it('301 và 302 chỉ khi đích đang công khai', () => {
    expect(redirectOutcome({ toPath: '/kien-thuc/moi', statusCode: 301, enabled: 1 }, '/kien-thuc/cu', true)).toEqual({
      type: 'redirect',
      location: '/kien-thuc/moi',
      status: 301,
    });
    const temporary = redirectOutcome({ toPath: '/kien-thuc/moi', statusCode: 302, enabled: 1 }, '/kien-thuc/cu', true);
    expect(temporary?.type === 'redirect' && temporary.status).toBe(302);
    expect(redirectOutcome({ toPath: '/kien-thuc/nhap', statusCode: 301, enabled: 1 }, '/kien-thuc/cu', false)).toBeNull();
    expect(redirectOutcome({ toPath: '/kien-thuc/moi', statusCode: 301, enabled: 0 }, '/kien-thuc/cu', true)).toBeNull();
    expect(redirectOutcome({ toPath: 'https://evil.example', statusCode: 301, enabled: 1 }, '/kien-thuc/cu', true)).toBeNull();
    expect(redirectOutcome({ toPath: '', statusCode: 410, enabled: 1 }, '/kien-thuc/cu', false)).toEqual({ type: 'gone' });
  });

  it('response có status, Location và không cache công khai', () => {
    const moved = redirectHttpResponse({ type: 'redirect', location: '/kien-thuc/moi', status: 301 });
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/kien-thuc/moi');
    expect(moved.headers.get('cache-control')).toBe('private, no-cache');
    const temporary = redirectHttpResponse({ type: 'redirect', location: '/kien-thuc/moi', status: 302 });
    expect(temporary.status).toBe(302);
    const gone = redirectHttpResponse({ type: 'gone' });
    expect(gone.status).toBe(410);
    expect(gone.headers.get('location')).toBeNull();
    expect(gone.headers.get('x-robots-tag')).toBe('noindex');
    expect(gone.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('sitemap bỏ URL nguồn của redirect', () => {
    expect(omitRedirectedPaths(['/kien-thuc/moi', '/kien-thuc/cu'], ['/kien-thuc/cu'])).toEqual(['/kien-thuc/moi']);
  });
});
