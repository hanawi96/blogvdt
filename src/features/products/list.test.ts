import { describe, expect, it } from 'vitest';
import { parseProductForm } from './form';
import { productAdminQuery, productListSort } from './products';
import { canFeatureProduct } from './status';

describe('danh sách sản phẩm', () => {
  it('chỉ nhận các kiểu sắp xếp đã định', () => {
    expect(productListSort('price-desc')).toBe('price-desc');
    expect(productListSort('updated')).toBe('newest');
    expect(productListSort(null)).toBe('newest');
  });

  it('giữ tham số lọc hợp lệ và bỏ giá trị lạ', () => {
    expect(productAdminQuery({ query: 'vòng%', status: 'active', sort: 'name', page: 2 })).toBe(
      '/admin/products?q=v%C3%B2ng&status=active&sort=name&page=2',
    );
    expect(productAdminQuery({ status: 'archived', sort: 'random', notice: 'feature-error' })).toBe(
      '/admin/products?error=feature',
    );
  });

  it('không cho sản phẩm ngừng bán được đánh dấu nổi bật', () => {
    expect(canFeatureProduct('inactive', true)).toBe(false);
    expect(canFeatureProduct('active', true)).toBe(true);
    const form = new FormData();
    form.set('name', 'Vòng mẫu');
    form.set('slug', 'vong-mau');
    form.set('price', '120000');
    form.set('description', 'Mô tả sản phẩm mẫu.');
    form.set('coverMediaId', '');
    form.set('options', '');
    form.set('status', 'inactive');
    form.set('sortOrder', '0');
    form.set('seoTitle', 'Tiêu đề SEO');
    form.set('metaDescription', 'Mô tả SEO');
    form.set('featured', '1');
    const parsed = parseProductForm(form);
    expect(parsed.ok && parsed.input.isFeatured).toBe(false);
    expect(parsed.ok && parsed.input.seoTitle).toBe('Tiêu đề SEO');
  });
});
