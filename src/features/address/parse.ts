/** Dòng trong address-select.json: [mã tỉnh, tên tỉnh, [[mã xã, tên xã], ...]]. */
export type AddressSelectRow = readonly [string, string, readonly (readonly [string, string])[]];

/**
 * Tách địa chỉ đã ghép `${số nhà}, ${xã}, ${tỉnh}` về mã + số nhà.
 * Khớp từ phải (tên tỉnh/xã) để số nhà vẫn được giữ nếu có dấu phẩy.
 */
export function matchComposedAddress(
  rows: readonly AddressSelectRow[],
  composed: string,
): { provinceCode: string; wardCode: string; line: string } | null {
  const text = composed.trim();
  if (!text) return null;
  for (const [provinceCode, provinceName, wards] of rows) {
    const provinceSuffix = `, ${provinceName}`;
    if (!text.endsWith(provinceSuffix)) continue;
    const withoutProvince = text.slice(0, -provinceSuffix.length);
    for (const [wardCode, wardName] of wards) {
      const wardSuffix = `, ${wardName}`;
      if (!withoutProvince.endsWith(wardSuffix)) continue;
      const line = withoutProvince.slice(0, -wardSuffix.length).trim();
      if (!line) continue;
      return { provinceCode, wardCode, line };
    }
  }
  return null;
}
