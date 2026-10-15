import { describe, expect, it } from 'vitest';
import { CORD_TYPES } from './form';
import { CATALOG_CORDS, catalogFiltered, catalogNeedsRedirect, catalogPath, readCatalogQuery, visibleComparePrice } from './catalog';

describe('giá gốc trên trang mẫu vòng', () => {
  it('chỉ hiện giá gốc khi lớn hơn giá bán', () => {
    expect(visibleComparePrice(150000, 180000)).toBe(180000);
    expect(visibleComparePrice(150000, 150000)).toBeNull();
    expect(visibleComparePrice(150000, null)).toBeNull();
  });
});

describe('truy vấn trang mẫu vòng', () => {
  it('bỏ tham số rỗng và trang 1', () => {
    const query = readCatalogQuery(new URLSearchParams('q=%20vòng_%20&sap-xep=mac-dinh&page=1&day=khac'));
    expect(query.q).toBe('vòng');
    expect(query.cord).toBe('');
    expect(query.sort).toBe('mac-dinh');
    expect(catalogPath(query)).toBe('/mau-vong-dau-tam?q=v%C3%B2ng');
    expect(catalogFiltered(query)).toBe(true);
  });

  it('đảo khoảng giá và giữ kiểu dây, danh mục, sắp xếp', () => {
    const query = readCatalogQuery(new URLSearchParams('tu=300000&den=100000&day=rut&danh-muc=vong-charm&sap-xep=gia-tang&page=2'));
    expect(query.min).toBe(100000);
    expect(query.max).toBe(300000);
    expect(query.cord).toBe('rut');
    expect(query.category).toBe('vong-charm');
    expect(catalogPath(query)).toBe('/mau-vong-dau-tam?danh-muc=vong-charm&day=rut&tu=100000&den=300000&sap-xep=gia-tang&page=2');
    expect(CATALOG_CORDS.map((item) => item.label)).toEqual([...CORD_TYPES]);
  });

  it('coi URL sạch là không cần chuyển hướng', () => {
    const url = new URL('http://localhost:4321/mau-vong-dau-tam');
    const query = readCatalogQuery(url.searchParams);
    expect(catalogFiltered(query)).toBe(false);
    expect(catalogNeedsRedirect(url, query)).toBe(false);
    expect(catalogNeedsRedirect(new URL('http://localhost:4321/mau-vong-dau-tam?page=1'), query)).toBe(true);
  });
});
