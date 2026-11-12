import type { PublicSite } from '../settings/settings';
import { EMPTY_TRACKING } from '../tracking/tracking';

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
  ogImageAlt: '',
  ogImageWidth: null,
  ogImageHeight: null,
  defaultSeoTitle: 'Vòng Dâu Tằm',
  defaultSeoDescription: 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.',
  tracking: EMPTY_TRACKING,
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
] as const;

export type PolicySlug = (typeof POLICIES)[number]['slug'];

export function getPolicy(slug: string) {
  return POLICIES.find((policy) => policy.slug === slug) ?? null;
}
