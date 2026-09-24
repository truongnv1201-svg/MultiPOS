// P3-loop fix: các hàm pull server (catalog/đơn/kho/sổ quỹ/dự án/ca) map ra mảng/
// object MỚI mỗi lần gọi. setState vô điều kiện làm identity state đổi liên tục ->
// useCallback phụ thuộc chúng tạo identity mới -> effect đồng bộ chạy lại -> pull
// tiếp -> vòng lặp vô hạn (~85 req/s đo được), UI nhấp nháy, realtime resubscribe
// liên tục. Guard này giữ nguyên identity khi nội dung không đổi để cắt vòng lặp.
export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function stableNext<T>(prev: T, next: T): T {
  return sameJson(prev, next) ? prev : next;
}
