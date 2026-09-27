// Ghi bản chụp server xuống cache Dexie mà KHÔNG xoá những gì vừa được ghi cục bộ.
//
// Vì sao: các hàm pull server trước đây làm `clear()` rồi `bulkAdd(snapshot)`. Nếu người
// dùng lưu một mặt hàng / phiếu / chấm công NGAY LÚC server đang trả về, bản ghi đó không
// có trong snapshot nên bị xoá khỏi cache. Với bản ghi đã lên server thì lần pull sau
// chữa lại được, nhưng với bản ghi CHƯA lên server (ghi offline, đang trong hàng đợi) thì
// mất hẳn: tải lại app là không còn ở cache lẫn không có ở server.
//
// Cách đúng: chụp danh sách khoá đang có trong cache TRƯỚC khi gọi server, rồi upsert
// bản chụp mới và chỉ dọn đúng các khoá vốn có từ trước mà không còn trong bản chụp
// (tức là server đã xoá). Khoá phát sinh trong lúc đang gọi là ghi cục bộ -> giữ lại.
import type { Table } from 'dexie';

/** Khoá (primary key) hiện có trong cache. Gọi TRƯỚC khi gọi server. */
export async function cacheKeys<T>(table: Table<T, string>): Promise<string[]> {
  return ((await table.toCollection().primaryKeys()) as string[]) ?? [];
}

/**
 * Upsert `next` vào `table`, chỉ xoá các khoá nằm trong `staleIds` mà không có trong `next`.
 * Phải nằm trong transaction của caller nếu caller muốn ghi nhiều bảng cùng lúc.
 */
export async function mirrorUpsert<T extends { id: string }>(
  table: Table<T, string>,
  next: T[],
  staleIds: string[],
): Promise<void> {
  const nextIds = new Set(next.map((row) => row.id));
  const removed = staleIds.filter((id) => !nextIds.has(id));
  if (next.length > 0) await table.bulkPut(next);
  if (removed.length > 0) await table.bulkDelete(removed);
}
