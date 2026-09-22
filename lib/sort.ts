// Helpers sắp xếp dùng chung cho các bảng quản lý (bấm header để đảo chiều).
// Quy ước: null/undefined luôn xếp cuối bất kể chiều; chuỗi so theo locale vi; số so số học.

export type SortDir = 'asc' | 'desc';

export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  // ISO date string so sánh chuỗi vẫn đúng thứ tự thời gian
  return String(a).localeCompare(String(b), 'vi', { numeric: true });
}

export function sortRows<T>(rows: readonly T[], getValue: (row: T) => unknown, dir: SortDir): T[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => compareValues(getValue(x), getValue(y)) * m);
}
