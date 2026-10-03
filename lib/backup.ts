import { db } from './db';

const BACKUP_FORMAT = 'multipos-local-backup';
const BACKUP_VERSION = 1;

type BackupTable =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'orders'
  | 'projects'
  | 'cashbook'
  | 'shifts'
  | 'purchaseOrders'
  | 'pendingOrders'
  | 'employees'
  | 'attendanceDays'
  | 'pendingMasterData'
  | 'pendingOps';

export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  created_at: string;
  tables: Partial<Record<BackupTable, unknown[]>>;
}

const TABLES: BackupTable[] = [
  'products',
  'customers',
  'suppliers',
  'orders',
  'projects',
  'cashbook',
  'shifts',
  'purchaseOrders',
  'pendingOrders',
  'employees',
  'attendanceDays',
  'pendingMasterData',
  'pendingOps',
];

export async function createLocalBackup(): Promise<LocalBackup> {
  const tables: Partial<Record<BackupTable, unknown[]>> = {};
  for (const table of TABLES) {
    tables[table] = await db.table(table).toArray();
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    tables,
  };
}

export function downloadLocalBackup(backup: LocalBackup): void {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `multipos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseLocalBackup(raw: unknown): LocalBackup {
  if (!raw || typeof raw !== 'object') throw new Error('Tệp sao lưu không hợp lệ.');
  const value = raw as Partial<LocalBackup>;
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !value.tables) {
    throw new Error('Tệp không phải sao lưu MultiPOS hoặc đã quá cũ.');
  }
  for (const table of TABLES) {
    if (!Array.isArray(value.tables[table])) {
      throw new Error(`Tệp sao lưu thiếu dữ liệu bảng ${table}.`);
    }
  }
  for (const table of Object.keys(value.tables)) {
    if (!TABLES.includes(table as BackupTable) || !Array.isArray(value.tables[table as BackupTable])) {
      throw new Error(`Dữ liệu bảng ${table} trong tệp sao lưu không hợp lệ.`);
    }
  }
  return value as LocalBackup;
}

export async function restoreLocalBackup(backup: LocalBackup): Promise<void> {
  const tables = Object.entries(backup.tables) as [BackupTable, unknown[]][];
  await db.transaction('rw', TABLES, async () => {
    for (const [name, rows] of tables) {
      const table = db.table(name);
      await table.clear();
      if (rows.length > 0) await table.bulkAdd(rows);
    }
  });
}

// ---- Theo dõi lần sao lưu local cuối (free tier: nhắc user tải tay định kỳ) ----
const LAST_BACKUP_AT_KEY = 'multipos_last_backup_at';

/** ISO string lần tải backup local cuối, hoặc null nếu chưa từng sao lưu trên máy này. */
export function getLastBackupAt(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(LAST_BACKUP_AT_KEY);
  } catch {
    return null;
  }
}

/** Ghi nhận vừa tải backup xong — gọi sau downloadLocalBackup thành công. */
export function markBackupDone(at: string = new Date().toISOString()): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_BACKUP_AT_KEY, at);
  } catch {
    /* best-effort */
  }
}

/** true khi đã quá `maxDays` ngày chưa sao lưu local (mặc định 7). */
export function isBackupStale(maxDays = 7): boolean {
  const last = getLastBackupAt();
  if (!last) return true;
  const elapsed = Date.now() - new Date(last).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return true;
  return elapsed > maxDays * 24 * 60 * 60 * 1000;
}
