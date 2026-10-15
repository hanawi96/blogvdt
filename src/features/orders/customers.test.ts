import { describe, expect, it } from 'vitest';
import { customerAdminQuery, customerSort } from './customers';

describe('danh sách khách hàng', () => {
  it('chỉ nhận cách sắp xếp hợp lệ', () => {
    expect(customerSort('spent')).toBe('spent');
    expect(customerSort('orders')).toBe('orders');
    expect(customerSort('drop table')).toBe('recent');
    expect(customerSort(null)).toBe('recent');
  });

  it('tạo URL gọn, bỏ tham số mặc định và ký tự LIKE', () => {
    expect(customerAdminQuery({})).toBe('/admin/customers');
    expect(customerAdminQuery({ sort: 'recent', page: 1 })).toBe('/admin/customers');
    expect(customerAdminQuery({ query: ' Lan%_ ', sort: 'spent', page: 3 })).toBe('/admin/customers?q=Lan&sort=spent&page=3');
    expect(customerAdminQuery({ page: 2.5 })).toBe('/admin/customers');
  });
});
