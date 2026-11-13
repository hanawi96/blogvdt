import { routes } from '../../lib/routes';

export const FEEDBACK_PAGE_SIZE = 12;
export const FEEDBACK_HOME_LIMIT = 10;
/** Số ảnh feedback được ghim tối đa (hiện đầu trang công khai). */
export const FEEDBACK_PIN_MAX = 9;

export function readFeedbackPage(raw: string | null | undefined): number {
  const page = Number(raw ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function feedbackPath(page = 1): string {
  return page > 1 ? `${routes.feedback}?page=${page}` : routes.feedback;
}
