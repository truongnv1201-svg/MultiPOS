// Chuẩn hóa mọi thông báo lỗi hiển thị cho người dùng sang tiếng Việt.
// Cách dùng: vietnamizeError(err) thay cho err?.message khi alert/toast/hiện lỗi.
// Chi tiết kỹ thuật gốc được giữ trong console để dev debug.

function rawText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof anyErr.message === 'string') parts.push(anyErr.message);
    // Supabase/Postgrest đôi khi để chi tiết ở details/hint/code
    if (typeof anyErr.details === 'string') parts.push(anyErr.details);
    if (typeof anyErr.hint === 'string') parts.push(anyErr.hint);
    if (typeof anyErr.code === 'string') parts.push(`code=${anyErr.code}`);
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err ?? '');
}

export function vietnamizeError(err: unknown): string {
  const raw = rawText(err);
  const msg = raw.toLowerCase();

  // Hết tồn kho (check constraint kho âm) — lỗi hay gặp nhất khi thanh toán
  if (msg.includes('products_stock_quantity_check') || msg.includes('stock_quantity_check')) {
    return 'Tồn kho không đủ để trừ (kho trên server đã hết hoặc thấp hơn số bán). Vui lòng tải lại danh mục, giảm số lượng rồi thanh toán lại.';
  }
  // Các check constraint khác
  if (msg.includes('violates check constraint')) {
    return 'Dữ liệu không hợp lệ, vi phạm ràng buộc hệ thống. Vui lòng kiểm tra lại số liệu rồi thử lại.';
  }
  // Trùng khóa chính / trùng mã
  if (
    msg.includes('duplicate key') ||
    msg.includes('already exists') ||
    msg.includes('unique constraint') ||
    msg.includes('violates unique')
  ) {
    return 'Dữ liệu đã tồn tại (trùng mã). Vui lòng kiểm tra lại, không cần nhập trùng.';
  }
  // Khóa ngoại — dữ liệu liên quan không còn
  if (msg.includes('foreign key') || msg.includes('violates foreign')) {
    return 'Dữ liệu liên quan không còn tồn tại (có thể vừa bị xóa ở máy khác). Vui lòng tải lại trang rồi thử lại.';
  }
  // Phân quyền RLS / không có quyền
  if (
    msg.includes('row-level security') ||
    msg.includes('row level security') ||
    msg.includes('permission denied') ||
    msg.includes('not authorized') ||
    msg.includes('unauthorized') ||
    msg.includes('policy') && msg.includes('violates')
  ) {
    return 'Tài khoản không có quyền thực hiện thao tác này. Vui lòng đăng nhập đúng vai trò hoặc liên hệ Admin.';
  }
  // Chưa đăng nhập / phiên hết hạn
  if (
    msg.includes('jwt') ||
    msg.includes('token') && (msg.includes('expired') || msg.includes('invalid')) ||
    msg.includes('not authenticated') ||
    msg.includes('session')
  ) {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  }
  // Mất mạng
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('offline')
  ) {
    return 'Mất kết nối máy chủ. Dữ liệu đã lưu offline trên máy, sẽ tự đồng bộ khi có mạng.';
  }
  // Timeout
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Máy chủ phản hồi quá lâu. Vui lòng thử lại sau ít phút.';
  }
  // Đăng nhập sai
  if (msg.includes('invalid login credentials')) {
    return 'Sai email hoặc mật khẩu (phân biệt HOA/thường).';
  }
  if (msg.includes('email not confirmed')) {
    return 'Email chưa xác thực — liên hệ quản trị.';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'Thử quá nhiều lần — đợi 1 phút rồi thử lại.';
  }
  // Không tìm thấy
  if (msg.includes('not found') || msg.includes('no rows') || msg.includes('pgrst')) {
    return 'Không tìm thấy dữ liệu. Có thể vừa bị xóa hoặc chưa đồng bộ — vui lòng tải lại.';
  }

  // Không khớp mẫu nào: thông báo chung tiếng Việt, chi tiết gốc chỉ log console.
  if (typeof window !== 'undefined' && raw) {
    console.error('[Lỗi gốc]', raw);
  }
  return 'Đã xảy ra lỗi, vui lòng thử lại. Nếu lỗi lặp lại, liên hệ quản trị.';
}
