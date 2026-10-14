export type MediaItem = {
  id: number;
  url: string;
  alt: string;
  filename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  createdAt: number;
};

export type MediaUse = {
  href: string;
  label: string;
};
