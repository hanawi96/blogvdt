/** Thống kê độ dài bài cho thanh soạn thảo — hàm thuần, không I/O. */

/** ~200 từ/phút: tốc độ đọc tiếng Việt thường gặp, làm tròn lên tối thiểu 1 phút. */
const WORDS_PER_MINUTE = 200;

export type ReadingStats = { words: number; minutes: number };

/** Đếm số từ theo cụm ký tự cách nhau bởi khoảng trắng; bỏ qua khoảng trắng thừa. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function readingStats(text: string): ReadingStats {
  const words = countWords(text);
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, minutes };
}

/** Nhãn hiển thị: "0 từ" khi rỗng, ngược lại "N từ · ~M phút đọc". */
export function readingStatsLabel(text: string): string {
  const { words, minutes } = readingStats(text);
  if (words === 0) return '0 từ';
  return `${words.toLocaleString('vi-VN')} từ · ~${minutes} phút đọc`;
}
