import { describe, expect, it } from 'vitest';
import { catalogFiltered, catalogNeedsRedirect, catalogPath, readCatalogQuery, visibleComparePrice } from './catalog';

describe('giá gốc trên trang mẫu vòng', () => {
  it('chỉ hiện giá gốc khi lớn hơn giá bán', () => {
    expect(visibleComparePrice(150000, 180000)).toBe(180000);
    expect(visibleComparePrice(150000, 150000)).toBeNull();
    expect(visibleComparePrice(150000, null)).toBeNull();
  });
});

describe('truy vấn trang mẫu vòng', () => {
  it('bỏ tham số rỗng, sai và trang 1, làm sạch từ khóa tìm', () => {
    const empty = readCatalogQuery(new URLSearchParams('sap-xep=mac-dinh&page=1&danh-muc=Không Hợp Lệ'));
    expect(empty.category).toBe('');
    expect(empty.sort).toBe('mac-dinh');
    expect(catalogPath(empty)).toBe('/mau-vong-dau-tam');
    expect(catalogFiltered(empty)).toBe(false);
    const searched = readCatalogQuery(new URLSearchParams('q=%20vòng_%20'));
    expect(searched.q).toBe('vòng');
    expect(catalogPath(searched)).toBe('/mau-vong-dau-tam?q=v%C3%B2ng');
    expect(catalogFiltered(searched)).toBe(true);
  });

  it('giữ từ khóa, danh mục và sắp xếp bán chạy, bỏ các tham số lọc cũ', () => {
    const query = readCatalogQuery(new URLSearchParams('q=vong&day=rut&tu=1&den=2&danh-muc=vong-charm&sap-xep=ban-chay&page=2'));
    expect(query.q).toBe('vong');
    expect(query.category).toBe('vong-charm');
    expect(query.sort).toBe('ban-chay');
    expect(catalogPath(query)).toBe('/mau-vong-dau-tam?q=vong&danh-muc=vong-charm&sap-xep=ban-chay&page=2');
    expect(catalogFiltered(query)).toBe(true);
    expect(readCatalogQuery(new URLSearchParams('sap-xep=gia-tang')).sort).toBe('mac-dinh');
  });

  it('coi URL sạch là không cần chuyển hướng, URL có tham số cũ thì chuyển', () => {
    const url = new URL('http://localhost:4321/mau-vong-dau-tam');
    const query = readCatalogQuery(url.searchParams);
    expect(catalogFiltered(query)).toBe(false);
    expect(catalogNeedsRedirect(url, query)).toBe(false);
    expect(catalogNeedsRedirect(new URL('http://localhost:4321/mau-vong-dau-tam?page=1'), query)).toBe(true);
    expect(catalogNeedsRedirect(new URL('http://localhost:4321/mau-vong-dau-tam?day=rut'), query)).toBe(true);
  });
});
