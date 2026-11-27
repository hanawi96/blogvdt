import { describe, expect, it } from 'vitest';
import {
  HEADING_ISSUE_DETAIL,
  HEALTH_ISSUE,
  HEALTH_LOAD_ERROR,
  HEALTH_PRIORITY_LIMIT,
  HEALTH_RUN_ERROR,
  HEALTH_SITE_TITLE,
  HEALTH_UI,
  META_DUPLICATE,
  healthBrokenImagesDetail,
  healthEmptyAltDetail,
  healthInboundDetail,
  healthLinkMissingDetail,
  healthLinkRedirectDetail,
  healthLinkUnpublishedDetail,
  healthNoteDone,
  healthNoteDoneEmpty,
  healthNoteInProgress,
  healthNoteNever,
  healthThinContentDetail,
} from './messages';

describe('SEO health messages catalog', () => {
  it('giữ nguyên thông báo tải/chạy, tiêu đề site và duplicate dùng chung', () => {
    expect(HEALTH_LOAD_ERROR).toBe('Không tải được kết quả kiểm tra.');
    expect(HEALTH_RUN_ERROR).toBe('Mất kết nối khi kiểm tra. Kết quả đã lưu vẫn giữ nguyên.');
    expect(HEALTH_SITE_TITLE).toBe('Toàn site');
    expect(HEALTH_PRIORITY_LIMIT).toBe(5);
    expect(HEALTH_UI.priorityHeading).toBe('Ưu tiên sửa');
    expect(HEALTH_UI.issuesHeading).toBe('Danh sách cần sửa');
    expect(HEALTH_UI.issuesEmptyDone).toMatch(/Không có lỗi/);
    expect(HEALTH_UI.issuesEmptyProgress).toMatch(/Tiếp tục/);
    expect(META_DUPLICATE.titleEqualsDescription).toMatch(/giống nhau/);
    expect(META_DUPLICATE.titleTaken).toMatch(/Tiêu đề này/);
    expect(META_DUPLICATE.descriptionTaken).toMatch(/Mô tả này/);
  });

  it('format detail động khớp chuỗi health hiện tại', () => {
    expect(healthBrokenImagesDetail(['ảnh đại diện', 'a.jpg', 'b.jpg', 'c.jpg'])).toBe(
      'Ảnh không còn dùng được: ảnh đại diện, a.jpg, b.jpg.',
    );
    expect(healthEmptyAltDetail(['ảnh đại diện', 'x.png'])).toBe(
      'ảnh đại diện, x.png đang trống ALT. Ảnh trang trí được phép; ảnh chứa thông tin cần mô tả đúng nội dung.',
    );
    expect(healthLinkMissingDetail('/a, /b')).toBe('Liên kết không có bài: /a, /b.');
    expect(healthLinkUnpublishedDetail('/draft')).toBe('Liên kết trỏ tới bài chưa xuất bản: /draft.');
    expect(healthLinkRedirectDetail('/old → /new')).toBe('Liên kết đang đi qua đường dẫn cũ: /old → /new.');
    expect(healthInboundDetail(false)).toBe(HEALTH_ISSUE.inboundBase);
    expect(healthInboundDetail(true)).toBe(`${HEALTH_ISSUE.inboundBase} ${HEALTH_ISSUE.inboundTruncatedSuffix}`);
    expect(healthThinContentDetail(20)).toBe('Bài hơi ngắn (20 từ). Nên viết thêm để đủ sâu cho SEO.');
    expect(HEALTH_ISSUE.contentEmpty).toMatch(/chưa có nội dung/i);
    expect(HEALTH_ISSUE.coverMissing).toBe('Nên thêm ảnh đại diện.');
    expect(HEADING_ISSUE_DETAIL['empty-heading']).toMatch(/tiêu đề trống/i);
    expect(HEADING_ISSUE_DETAIL['jump-before-h2']).toMatch(/Tiêu đề 3/);
    expect(HEADING_ISSUE_DETAIL['long-without-h2']).toMatch(/Bài dài/);
  });

  it('lead note hướng hành động rõ', () => {
    expect(healthNoteNever()).toMatch(/Chưa kiểm tra lần nào/);
    expect(healthNoteInProgress('1/1/2026', 2, 3)).toMatch(/Đã xác minh 2\/5 bài/);
    expect(healthNoteInProgress('1/1/2026', 2, 3)).toMatch(/Tiếp tục/);
    expect(healthNoteDoneEmpty('1/1/2026')).toMatch(/Không có bài xuất bản/);
    expect(healthNoteDone({ whenLabel: '1/1/2026', verified: 4, unchecked: 0, stale: 0 })).toMatch(
      /Ưu tiên sửa các lỗi nghiêm trọng/,
    );
  });
});
