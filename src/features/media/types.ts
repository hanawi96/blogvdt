export type MediaItem = {
  id: number;
  url: string;
  /** URL card ~800px nếu có; dùng cho lưới sản phẩm. */
  cardUrl: string | null;
  /** URL thumb nhỏ nếu có; dùng cho pill/UI. */
  thumbUrl: string | null;
  alt: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  createdAt: number;
};

export type MediaUse = {
  href: string;
  label: string;
};
