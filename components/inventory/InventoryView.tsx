'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Product } from '@/lib/types';
import { formatQty } from '@/lib/quantity';
import { isLowStock, isOutOfStock, minStockOf, stockStatus } from '@/lib/stock';
import {
  Boxes,
  Plus,
  ArrowDownToLine,
  TrendingDown,
  History,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Scale,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SearchInput, FilterSelect } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty, ListEmpty } from '@/components/ui/ListStates';
import { AppButton } from '@/components/ui/AppButton';
import { PaginationBar } from '@/components/common/PaginationBar';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { notify } from '@/components/common/Toast';
import { sortRows } from '@/lib/sort';
import { StockAdjustModal } from '@/components/inventory/StockAdjustModal';
import { type StockMovement } from '@/lib/types';

export function InventoryView({ bare = false, adjustOpen: controlledAdjustOpen, onAdjustOpenChange }: { bare?: boolean; adjustOpen?: boolean; onAdjustOpenChange?: (open: boolean) => void } = {}) {
  const { products, stockMovements, setCurrentScreen, setPosFlow, profile } = useStore();
  // Modal điều chỉnh mở từ shell trang Hàng hóa khi bare (không thì nội bộ như cũ).
  const [internalAdjustOpen, setInternalAdjustOpen] = useState(false);
  const adjustOpen = controlledAdjustOpen ?? internalAdjustOpen;
  const setAdjustOpen = (next: boolean) => {
    onAdjustOpenChange?.(next);
    setInternalAdjustOpen(next);
  };
  const canAdjust = !profile || profile.role === 'admin' || profile.role === 'manager';

  // Movements filter & pagination state
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFilter, setMovementDateFilter] = useState<DateFilterState>({ preset: '7days' });
  const [movementPage, setMovementPage] = useState<number>(1);
  const [movementPageSize, setMovementPageSize] = useState<number>(25);
  // Sắp xếp bảng thẻ kho: bấm header để đảo chiều; đổi sort -> về trang 1.
  // Mặc định mới nhất lên trên (khớp thứ tự server) để không nháy khi dữ liệu về.
  const { sortKey: movSortKey, sortDir: movSortDir, toggleSort: toggleMovSort } = useSortState('created_at', 'desc');
  const handleMovSort = (key: string) => {
    toggleMovSort(key);
    setMovementPage(1);
  };

  // ---- Xuất Excel / In bảng ----
  const MOVEMENT_LABEL: Record<string, string> = {
    import: 'Nhập kho',
    export_sales: 'Xuất bán POS',
    export_project: 'Vật tư công trình',
    return: 'Nhập lại / Trả hàng',
    // 0064: điều chỉnh tồn có thật trên server (trước đây phải đoán bằng regex trên note)
    adjust_loss: 'Hao hụt / Giảm tồn',
    adjust_gain: 'Đếm thừa / Tăng tồn',
  };

  // Badge phân loại dùng chung cho bảng thẻ kho (1 map duy nhất).
  const movementBadge = (type: string): { tone: 'emerald' | 'blue' | 'amber' | 'purple'; label: string } => {
    if (type === 'import') return { tone: 'emerald', label: 'Nhập kho' };
    if (type === 'export_sales') return { tone: 'blue', label: 'Xuất bán POS' };
    if (type === 'export_project') return { tone: 'amber', label: 'Vật tư công trình' };
    return { tone: 'purple', label: 'Nhập lại / Trả hàng' };
  };

  const handleExportMovements = () => {
    if (sortedMovements.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('the-kho', [
      {
        name: 'TheKho',
        rows: sortedMovements.map((m) => ({
          'Mã phiếu': m.reference_code,
          'Thời gian': new Date(m.created_at).toLocaleString('vi-VN'),
          'Sản phẩm': m.product_name,
          'Nghiệp vụ': MOVEMENT_LABEL[m.movement_type] || m.movement_type,
          'Số lượng': m.quantity,
          'Tồn trước': m.previous_stock,
          'Tồn sau': m.new_stock,
          'Nội dung': m.note,
        })),
      },
    ]);
  };

  const handlePrintMovements = () => {
    if (sortedMovements.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Nhật ký thẻ kho',
      meta: [`${sortedMovements.length} bút toán`],
      columns: [
        { header: 'Mã phiếu' },
        { header: 'Sản phẩm' },
        { header: 'Nghiệp vụ' },
        { header: 'Số lượng', align: 'right' },
        { header: 'Tồn trước', align: 'right' },
        { header: 'Tồn sau', align: 'right' },
        { header: 'Nội dung' },
      ],
      rows: sortedMovements.slice(0, 1000).map((m) => [
        m.reference_code,
        m.product_name,
        MOVEMENT_LABEL[m.movement_type] || m.movement_type,
        String(m.quantity),
        String(m.previous_stock),
        String(m.new_stock),
        m.note,
      ]),
    });
  };

  // Biến động kho từ server chỉ có product_id (bỏ JOIN products(name) để giảm payload),
  // nên tên sản phẩm tra ở đây từ catalog đang có trong bộ nhớ. Ưu tiên tên catalog để
  // luôn khớp với danh mục hiện tại; mục đã xoá mới rơi về nhãn dự phòng.
  const movements = React.useMemo(() => {
    if (stockMovements.length === 0) return stockMovements;
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    return stockMovements.map((m) => ({
      ...m,
      product_name: nameById.get(m.product_id) || m.product_name || 'Sản phẩm đã xóa',
    }));
  }, [stockMovements, products]);

  // Filtered movements
  const filteredMovements = movements.filter((m) => {
    const matchesSearch =
      m.reference_code.toLowerCase().includes(movementSearch.toLowerCase()) ||
      m.product_name.toLowerCase().includes(movementSearch.toLowerCase()) ||
      (m.note && m.note.toLowerCase().includes(movementSearch.toLowerCase()));
    const matchesType = movementTypeFilter === 'all' || m.movement_type === movementTypeFilter;
    const matchesDate = matchesDateFilter(m.created_at, movementDateFilter);
    return matchesSearch && matchesType && matchesDate;
  });

  // Sorted movements
  const sortedMovements = (() => {
    if (!movSortKey) return filteredMovements;
    const getters: Record<string, (m: StockMovement) => unknown> = {
      reference_code: (m) => m.reference_code,
      created_at: (m) => m.created_at,
      product_name: (m) => m.product_name,
      movement_type: (m) => m.movement_type,
      quantity: (m) => m.quantity,
      previous_stock: (m) => m.previous_stock,
      new_stock: (m) => m.new_stock,
      note: (m) => m.note,
    };
    const get = getters[movSortKey];
    if (!get) return filteredMovements;
    return sortRows(filteredMovements, get, movSortDir);
  })();

  // Paginated movements
  const paginatedMovements = (() => {
    const start = (movementPage - 1) * movementPageSize;
    return sortedMovements.slice(start, start + movementPageSize);
  })();

  return (
    <div id="inventory-view" className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 overflow-hidden">
      {!bare && (
      <PageHeader
        icon={<Boxes className="w-5 h-5 text-blue-600" />}
        title="Thẻ kho"
        shortTitle="Thẻ kho"
        shortBreakpoint="md"
        actions={
          <>
              {/* Nút phụ (Excel/In) trước, 2 nút hành động sau — cụm dồn về mép phải.
                  Kho có 2 nút chính (Điều chỉnh tồn / Tạo phiếu nhập) nên giữ thứ tự này. */}
              <TableTools onExportExcel={handleExportMovements} onPrint={handlePrintMovements} />
              <AppButton
                id="btn-stock-adjust-open"
                tone="amber"
                onClick={() => setAdjustOpen(true)}
                disabled={!canAdjust}
                title={
                  canAdjust
                    ? 'Điều chỉnh tồn kho khi hao hụt, hết hạn, thất lạc hoặc đếm sai (có ghi thẻ kho + lý do)'
                    : 'Chỉ Admin/Quản lý được điều chỉnh tồn kho'
                }
              >
                <Scale className="w-4 h-4" />
                <span>Điều chỉnh tồn</span>
              </AppButton>
              <AppButton
                onClick={() => {
                  setPosFlow('import');
                  setCurrentScreen('pos');
                }}
                title="Sang màn bán hàng ở chế độ nhập kho"
              >
                <Plus className="w-4 h-4" />
                <span>Tạo Phiếu Nhập Kho (PN)</span>
              </AppButton>
          </>
        }
      />
      )}

      {/* Main content body — khung cố định, chân bảng sát lề dưới (chuẩn các trang khác) */}
      <div className="flex-1 p-4 overflow-hidden min-h-0">
          {/* Nhật ký thẻ kho */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full">
              {/* Filter Bar */}
              <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <SearchInput
                value={movementSearch}
                onChange={(val) => {
                  setMovementSearch(val);
                  setMovementPage(1);
                }}
                placeholder="Mã phiếu, sản phẩm, nội dung..."
                minWidthClass="min-w-[200px]"
              />

              {/* Date Filter */}
              <DateFilter
                value={movementDateFilter}
                onChange={(val) => {
                  setMovementDateFilter(val);
                  setMovementPage(1);
                }}
              />

              <FilterSelect
                value={movementTypeFilter}
                onChange={(val) => {
                  setMovementTypeFilter(val);
                  setMovementPage(1);
                }}
                options={[
                  { value: 'all', label: 'Tất cả nghiệp vụ' },
                  { value: 'import', label: 'Nhập kho (PN)' },
                  { value: 'export_sales', label: 'Xuất bán POS' },
                  { value: 'export_project', label: 'Vật tư công trình' },
                  { value: 'return', label: 'Nhập lại / Trả hàng' },
                  { value: 'adjust_loss', label: 'Hao hụt / Điều chỉnh giảm' },
                  { value: 'adjust_gain', label: 'Đếm thừa / Điều chỉnh tăng' },
                ]}
              />
              {bare && <TableTools onExportExcel={handleExportMovements} onPrint={handlePrintMovements} />}
              </div>

              {/* Dòng tổng hợp riêng — số bút toán chuyển từ nhãn tab xuống đây.
                  Giữ cả 2 số: đã lọc (theo ngày/loại) và tổng đã tải (như nhãn tab cũ). */}
              <SummaryStrip>
                <span>
                  Tìm thấy <strong className="text-slate-900 font-mono">{sortedMovements.length}</strong> bút toán thẻ kho
                </span>
                <span>
                  Tổng nhật ký: <strong className="text-slate-900 font-mono">{movements.length}</strong> bút toán
                </span>
              </SummaryStrip>

            {/* Mobile record list — bảng ngang chỉ dành cho desktop */}
            <div id="movement-record-list" className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {paginatedMovements.length === 0 ? (
                <ListEmpty>Không tìm thấy bút toán thẻ kho nào phù hợp với bộ lọc.</ListEmpty>
              ) : (
                paginatedMovements.map((m) => {
                  const isPositive = m.quantity > 0;
                  return (
                    <div key={m.id} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 leading-snug truncate">{m.product_name}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{m.reference_code}</p>
                        </div>
                        <span className={`shrink-0 text-xs font-mono font-bold ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isPositive ? `+${m.quantity}` : m.quantity}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                        <span>{new Date(m.created_at).toLocaleString('vi-VN')}</span>
                        <span>
                          {m.previous_stock} → {m.new_stock}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <SortableTh className="py-2.5 px-3" label="Mã phiếu" sortKey="reference_code" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3" label="Thời gian" sortKey="created_at" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3" label="Sản phẩm" sortKey="product_name" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3" label="Phân loại" sortKey="movement_type" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="Số lượng" sortKey="quantity" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tồn trước" sortKey="previous_stock" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tồn sau" sortKey="new_stock" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                  <SortableTh className="py-2.5 px-3" label="Nội dung" sortKey="note" activeKey={movSortKey} dir={movSortDir} onSort={handleMovSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedMovements.length === 0 ? (
                  <TableEmpty colSpan={8}>Không tìm thấy bút toán thẻ kho nào phù hợp với bộ lọc.</TableEmpty>
                ) : (
                  paginatedMovements.map((m) => {
                    const isPositive = m.quantity > 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                          {m.reference_code}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                          {new Date(m.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{m.product_name}</td>
                        <td className="py-2.5 px-3">
                          {(() => {
                            const badge = movementBadge(m.movement_type);
                            return (
                              <StatusBadge tone={badge.tone} pill={false}>
                                {badge.label}
                              </StatusBadge>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-bold">
                          <span className={isPositive ? 'text-emerald-700' : 'text-rose-700'}>
                            {isPositive ? `+${m.quantity}` : m.quantity}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                          {m.previous_stock}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {m.new_stock}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 truncate max-w-xs">{m.note}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>

            {/* Pagination */}
            <PaginationBar
              currentPage={movementPage}
              totalItems={filteredMovements.length}
              pageSize={movementPageSize}
              onPageChange={setMovementPage}
              onPageSizeChange={setMovementPageSize}
              itemName="bút toán thẻ kho"
            />
          </div>
      </div>
      <StockAdjustModal open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </div>
  );
}
