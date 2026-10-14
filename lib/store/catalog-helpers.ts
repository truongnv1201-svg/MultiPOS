// Helper thuần cho slice Catalog — tách verbatim từ lib/store/catalog.tsx, không dính React state.
// Mục đích: thu gọn file provider (~45KB) để dễ rà soát; mọi hành vi giữ nguyên.
import { db, type PendingMasterData } from '../db';

// PostgREST mặc định chỉ trả 1000 dòng -> kéo phân trang cho đủ (danh mục
// đã vượt 5000 món mà chỉ hiện 1000).
export async function fetchAllProducts(
  supa: any,
  table: string,
  orderCol: string,
  cols = '*'
): Promise<{ data: any[] | null; error: any }> {
  const all: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa.from(table).select(cols).order(orderCol).range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}

// P1 Sửa/Xóa: id uuid server (= đã đồng bộ), id local còn lại (= chưa lên server).
export const IS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 0009: map id KH local -> uuid server, persist localStorage (sống qua reload)
export const CUSTOMER_MAP_KEY = 'multipos_customer_map_v1';

export async function remapPendingCatalogReferences(
  entity: PendingMasterData['entity'],
  localId: string,
  mappedId: string,
  row: Record<string, unknown>,
) {
  const ops = await db.pendingOps.toArray();
  for (const op of ops) {
    const payload = { ...op.payload };
    let changed = false;
    if (entity === 'product' && op.kind === 'import' && Array.isArray(payload.lines)) {
      payload.lines = (payload.lines as Record<string, unknown>[]).map((line) => {
        if (line.productId !== localId) return line;
        changed = true;
        return { ...line, productId: mappedId, sku: typeof row.sku === 'string' ? row.sku : line.sku };
      });
    }
    if (entity === 'supplier' && (op.kind === 'import' || op.kind === 'supplier_payment')) {
      if (payload.supplierId === localId) {
        payload.supplierId = mappedId;
        payload.supplierName = row.name ?? payload.supplierName;
        changed = true;
      }
    }
    if (changed) await db.pendingOps.update(op.id, { payload });
  }
  if (entity === 'supplier') {
    await db.purchaseOrders.where('supplier_id').equals(localId).modify({ supplier_id: mappedId }).catch(() => {});
  }
}
