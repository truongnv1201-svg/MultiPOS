// P3-tx: hằng số + helpers dùng chung của tầng Transactions (không hook).
// Tách verbatim từ lib/store/transactions.tsx để composer + sub-hooks dùng chung.
import { db } from '../../db';
import type { PendingOp } from '../../db';
import type { Shift } from '../../types';

// P0: nhận diện uuid server (dùng chung cho project/NCC/vật tư khi đồng bộ).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asUuidOrNull = (v?: string | null) => (v && UUID_RE.test(v) ? v : null);

// P0: xếp hàng đợi đẩy kho/quỹ/NCC (dedupe server bằng client_ref nên replay an toàn)
export async function enqueueOp(kind: PendingOp['kind'], payload: Record<string, unknown>) {
  await db.pendingOps
    .add({
      id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      kind,
      payload,
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    })
    .catch(console.warn);
}

// P0-scale: cửa sổ + phân trang pull đơn server (trần ~1000 dòng/request của
// PostgREST; lô .in() 200 id để khỏi vỡ URL). Đơn ngoài cửa sổ vẫn tra được
// trong Dexie cache của máy.
export const SERVER_ORDERS_WINDOW_DAYS = 90;
export const SERVER_ORDERS_PAGE_SIZE = 1000;
export const SERVER_ORDERS_MAX_PAGES = 60;
export const SERVER_ITEMS_BATCH_SIZE = 200;

export const EMPTY_SHIFT: Shift = {
  id: 'shift-empty',
  cashier_name: 'Chưa mở ca',
  opened_at: '',
  starting_cash: 0,
  status: 'closed',
  cash_sales: 0,
  transfer_sales: 0,
  deposit_collected: 0,
  cash_payouts: 0,
  expected_cash: 0,
  order_count: 0,
};
