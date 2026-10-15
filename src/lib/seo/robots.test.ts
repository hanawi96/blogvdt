import { describe, expect, it } from 'vitest';
import { indexingAllowed, robotsTxt } from './robots';

describe('robots.txt', () => {
  it('cho phép toàn site và khai báo sitemap, không chặn URL noindex', () => {
    const body = robotsTxt('https://vongdautam.vn/');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://vongdautam.vn/sitemap.xml');
    expect(body).not.toContain('Disallow:');
  });
});

describe('môi trường được index', () => {
  it('localhost, staging và host lệch domain production thì không index', () => {
    expect(indexingAllowed({ requestOrigin: 'http://localhost:4321', environment: 'development' })).toBe(false);
    expect(indexingAllowed({ requestOrigin: 'https://blog.workers.dev', environment: 'production' })).toBe(false);
    expect(indexingAllowed({ requestOrigin: 'https://preview.example', siteUrl: 'https://vongdautam.vn', environment: 'production' })).toBe(false);
  });

  it('đúng host production thì được index', () => {
    expect(indexingAllowed({ requestOrigin: 'http://vongdautam.vn', siteUrl: 'https://VongDauTam.vn/', environment: 'production' })).toBe(true);
    expect(indexingAllowed({ requestOrigin: 'https://vongdautam.vn', environment: '' })).toBe(true);
  });
});
