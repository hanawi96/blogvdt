import addressSelect from '../../../public/data/address-select.json';
import { provinceCodeFromAddress, provinceNameMap, type AddressSelectRow } from './parse';

const rows = addressSelect as unknown as AddressSelectRow[];
const names = provinceNameMap(rows);

export function resolveProvinceCode(address: string): string | null {
  return provinceCodeFromAddress(rows, address);
}

export function provinceLabel(code: string | null | undefined): string {
  if (!code) return 'Không xác định';
  return names.get(code) ?? 'Không xác định';
}
