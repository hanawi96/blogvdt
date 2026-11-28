/**
 * Quy ước P&L — mô hình A (giữ tiền công trong vốn đơn như hiện tại).
 *
 * - Đơn hợp lệ: status ≠ cancelled và compensation = 0.
 * - Doanh thu: tổng total_price đơn hợp lệ.
 * - Lãi gộp / vốn: chỉ đơn đã có đủ cost_goods + cost_extra (cùng dashboard).
 *   Công thức lãi gộp/đơn: total_price − cost_goods − cost_extra − shipping_cost.
 * - Tiền công ước lượng đã nằm trong cost_goods (nguyên liệu「Chi phí làm vòng」).
 *   Không trừ thêm ngân sách 15tr vào lãi ròng (tránh double-count).
 * - Ngân sách tiền công tháng: chỉ đối chiếu, không phải dòng trừ.
 * - Ads: trừ sau lãi gộp (chưa nằm trong vốn đơn).
 * - Kỳ mặc định: tháng lịch VN (UTC+7). Quyền: chỉ admin.
 */

export const PNL_LABOR_MATERIAL_NAME = 'Chi phí làm vòng';

/** Gợi ý ngân sách mặc định khi chưa có ô nhập (bước 3). Không trừ vào lãi. */
export const PNL_DEFAULT_LABOR_BUDGET = 15_000_000;
