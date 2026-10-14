import type { PublicSite } from '../settings/settings';

export const staticChrome: PublicSite = {
  siteName: 'Vòng Dâu Tằm',
  siteDescription: 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.',
  phone: '',
  contactInfo: 'Thông tin liên hệ nằm ở trang chủ.',
  facebookUrl: '',
  zaloUrl: '',
  logoUrl: '',
  logoAlt: 'Vòng Dâu Tằm',
  faviconUrl: '',
  ogImageUrl: '',
  defaultSeoTitle: 'Vòng Dâu Tằm',
  defaultSeoDescription: 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.',
};

export const POLICIES = [
  {
    slug: 'giao-nhan',
    title: 'Giao nhận',
    description: 'Cách xưởng giao vòng tơ tằm sau khi nhận thông tin đặt.',
    paragraphs: [
      'Sau khi chốt cỡ vòng, màu chỉ và số lượng, xưởng làm từng chiếc rồi gửi hàng. Thời gian nhận phụ thuộc số vòng đang làm và địa chỉ giao.',
      'Khách cần cho biết tên người nhận, số điện thoại và địa chỉ. Những thông tin này chỉ dùng để giao hàng.',
      'Nếu cần đổi giờ nhận, hãy liên hệ trước khi hàng rời xưởng.',
    ],
  },
  {
    slug: 'doi-tra',
    title: 'Đổi trả',
    description: 'Điều kiện đổi vòng khi sản phẩm lỗi hoặc sai thông tin đã chốt.',
    paragraphs: [
      'Vòng làm theo cỡ và màu chỉ đã chốt. Nếu nhận sai so với thông tin đó, hoặc vòng bị lỗi khi giao, hãy liên hệ trong 3 ngày kèm ảnh sản phẩm.',
      'Xưởng xem lại và đổi chiếc lỗi hoặc chiếc làm sai. Vòng đã dùng, đã cắt hoặc đã đổi ý về màu không thuộc trường hợp đổi trả.',
      'Trang này nói về sản phẩm thủ công. Không có cam kết về sức khỏe.',
    ],
  },
  {
    slug: 'bao-mat',
    title: 'Bảo mật',
    description: 'Thông tin khách được lưu để giao hàng và xử lý đơn.',
    paragraphs: [
      'Đơn hàng lưu tên, số điện thoại, địa chỉ nhận và nội dung đặt. Xưởng dùng các thông tin này để làm vòng, giao hàng và liên hệ khi cần.',
      'Để chặn gửi đơn lặp, hệ thống lưu một mã băm của địa chỉ IP, không lưu địa chỉ IP gốc.',
      'Không bán dữ liệu khách. Trang quản trị không được công khai và không xuất hiện trên công cụ tìm kiếm.',
      'Nếu cần sửa thông tin giao hàng, hãy liên hệ qua số điện thoại trên website.',
    ],
  },
] as const;

export type PolicySlug = (typeof POLICIES)[number]['slug'];

export function getPolicy(slug: string) {
  return POLICIES.find((policy) => policy.slug === slug) ?? null;
}
