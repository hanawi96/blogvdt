/** Quy trình làm vòng — dùng chung trang chủ và trang chi tiết sản phẩm. */
export const BRACELET_PROCESS_STEPS = [
  {
    title: 'Chọn nguyên liệu',
    text: 'Chọn cành dâu tằm phù hợp trước khi tách và làm sạch.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_1.webp',
  },
  {
    title: 'Bóc dâu tằm',
    text: 'Tách phần gỗ dùng làm hạt, giữ vẻ mộc tự nhiên.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_2.webp',
  },
  {
    title: 'Phơi khô',
    text: 'Phơi đều để hạt khô, ổn định trước khi mài.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_3.webp',
  },
  {
    title: 'Mài nhỏ cành dâu',
    text: 'Tạo hình hạt vừa tay bé, đều từng viên.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_4.webp',
  },
  {
    title: 'Mài mịn viền hạt',
    text: 'Mài tay cho nhẵn, hạn chế cạnh sắc.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_5.webp',
  },
  {
    title: 'Xỏ vòng',
    text: 'Xỏ dây, chỉnh size theo bé và hoàn thiện.',
    img: '/Images/quy-trinh/quy-trinh-lam-vong_6.webp',
  },
] as const;

/** YouTube Short id — facade play trên trang chủ / PDP. */
export const BRACELET_PROCESS_VIDEO_ID = '15TVzfA-Jys';
