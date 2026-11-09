import { describe, expect, it } from 'vitest';
import { customerAdminQuery, customerSort, customerTierOf } from './customers';

describe('danh sách khách hàng', () => {
  it('chỉ nhận cách sắp xếp hợp lệ', () => {
    expect(customerSort('spent')).toBe('spent');
    expect(customerSort('orders')).toBe('orders');
    expect(customerSort('drop table')).toBe('recent');
    expect(customerSort(null)).toBe('recent');
  });

  it('phân loại khách theo số đơn chưa hủy', () => {
    expect(customerTierOf(0)).toBe('new');
    expect(customerTierOf(1)).toBe('new');
    expect(customerTierOf(2)).toBe('regular');
    expect(customerTierOf(3)).toBe('vip');
    expect(customerTierOf(9)).toBe('vip');
  });

  it('tạo URL gọn, bỏ tham số mặc định và ký tự LIKE', () => {
    expect(customerAdminQuery({})).toBe('/admin/customers');
    expect(customerAdminQuery({ sort: 'recent', page: 1 })).toBe('/admin/customers');
    expect(customerAdminQuery({ query: ' Lan%_ ', sort: 'spent', page: 3 })).toBe('/admin/customers?q=Lan&sort=spent&page=3');
    expect(customerAdminQuery({ page: 2.5 })).toBe('/admin/customers');
  });
});
