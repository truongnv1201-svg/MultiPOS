'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Product } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
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
import { TabSwitcher } from '@/components/ui/TabSwitcher';
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
import { StockAdjustTable } from '@/components/inventory/StockAdjustTable';
import { STOCK_ADJUST_REASON_LABEL, type StockMovement } from '@/lib/types';

export function InventoryView() {
  const { products, stockMovements, stockAdjustments, setCurrentScreen, setPosFlow, assignAdjustProject, refreshServerStockAdjustments, profile } = useStore();
  const [activeTab, setActiveTab] = useState<'stocks' | 'movements' | 'adjustments'>('stocks');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const canAdjust = !profile || profile.role === 'admin' || profile.role === 'manager';

  // 0064: khoản hao hụt ghi "chưa gán công trình" — nhắc để không bỏ sót phần chi phí
  // của công trình (gán sau được, không trừ tồn thêm).
  const unassignedLosses = stockAdjustments.filter((a) => a.delta < 0 && !a.project_id);

  // Stocks filter & pagination state
  const [stockSearch, setStockSearch] = useState('');
  const [stockStatusFilter, setStockStatusFilter] = useState<string>('all');
  const [stockPage, setStockPage] = useState<number>(1);
  const [stockPageSize, setStockPageSize] = useState<number>(25);

  // Movements filter & pagination state
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFilter, setMovementDateFilter] = useState<DateFilterState>({ preset: 'today' });
  const [movementPage, setMovementPage] = useState<number>(1);
  const [movementPageSize, setMovementPageSize] = useState<number>(25);
  // Sắp xếp 2 bảng: bấm header để đảo chiều; đổi sort -> về trang 1.
  // Mặc định mới nhất lên trên (khớp thứ tự server) để không nháy khi dữ liệu về.
  const { sortKey: stockSortKey, sortDir: stockSortDir, toggleSort: toggleStockSort } = useSortState('sku', 'desc');
  const { sortKey: movSortKey, sortDir: movSortDir, toggleSort: toggleMovSort } = useSortState('created_at', 'desc');
  const handleStockSort = (key: string) => {
    toggleStockSort(key);
    setStockPage(1);
  };
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

  // Badge phân loại dùng chung bảng dòng + bảng gộp phiếu (1 map duy nhất).
  const movementBadge = (type: string): { tone: 'emerald' | 'blue' | 'amber' | 'purple'; label: string } => {
    if (type === 'import') return { tone: 'emerald', label: 'Nhập kho' };
    if (type === 'export_sales') return { tone: 'blue', label: 'Xuất bán POS' };
    if (type === 'export_project') return { tone: 'amber', label: 'Vật tư công trình' };
    return { tone: 'purple', label: 'Nhập lại / Trả hàng' };
  };

  // Gộp bút toán theo mã phiếu để theo dõi theo phiếu (mặc định) thay vì từng dòng.
  // NCC lấy từ dòng diễn giải phiếu nhập; nhóm xếp theo phát sinh mới nhất.
  const parseVoucherSupplier = (note: string): string => {
    const m = /^Nhập kho \(([^)]*)\)/.exec(note || '');
    return m ? m[1] : '';
  };

  const handleExportStocks = () => {
    if (sortedProducts.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('ton-kho', [
      {
        name: 'TonKho',
        rows: sortedProducts.map((p) => ({
          'Mã SKU': p.sku,
          'Tên hàng': p.name,
          'ĐVT': p.unit,
          'Tồn kho': p.stock_quantity,
          'Giá vốn BQ': Math.round(p.avg_cost),
          'Nhập gần nhất': Math.round(p.import_price),
          'Giá trị tồn': Math.round(p.stock_quantity * p.avg_cost),
          'Tồn tối thiểu': p.min_stock ?? '',
        })),
      },
    ]);
  };

  const handlePrintStocks = () => {
    if (sortedProducts.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Báo cáo tồn kho',
      meta: [`${sortedProducts.length} mặt hàng`, `Tổng giá trị tồn: ${formatVND(totalInventoryValue)}`],
      columns: [
        { header: 'Mã SKU' },
        { header: 'Tên hàng' },
        { header: 'ĐVT', align: 'center' },
        { header: 'Tồn kho', align: 'right' },
        { header: 'Giá vốn BQ', align: 'right' },
        { header: 'Nhập gần nhất', align: 'right' },
        { header: 'Giá trị tồn', align: 'right' },
      ],
      rows: sortedProducts.slice(0, 1000).map((p) => [
        p.sku,
        p.name,
        p.unit,
        String(p.stock_quantity),
        Math.round(p.avg_cost).toLocaleString('vi-VN'),
        Math.round(p.import_price).toLocaleString('vi-VN'),
        Math.round(p.stock_quantity * p.avg_cost).toLocaleString('vi-VN'),
      ]),
      footer: ['Tổng', '', '', '', '', '', Math.round(totalInventoryValue).toLocaleString('vi-VN')],
    });
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

  // ---- In ấn / Xuất Excel: sổ điều chỉnh tồn (0064) ----
  // Sổ này là bằng chứng đối chiếu tồn thực với hệ thống và cơ sở tính giá trị hao hụt,
  // nên anh cần mang đi đối chiếu / lưu hồ sơ chứ không chỉ xem trên màn hình.
  const totalLossValue = stockAdjustments.reduce((s, a) => s + (a.loss_amount || 0), 0);

  const handleExportAdjustments = () => {
    if (stockAdjustments.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('so-dieu-chinh-ton', [
      {
        name: 'DieuChinhTon',
        rows: stockAdjustments.map((a) => ({
          'Mã phiếu': a.code,
          'Thời gian': new Date(a.created_at).toLocaleString('vi-VN'),
          'Mã SKU': a.sku,
          'Mặt hàng': a.product_name,
          'Tồn trước': a.previous_stock,
          'Tồn thực tế': a.counted_stock ?? '',
          'Chênh lệch': a.delta,
          'Tồn sau': a.previous_stock + a.delta,
          'Lý do': STOCK_ADJUST_REASON_LABEL[a.reason] || a.reason,
          'Ghi chú': a.note,
          'Gắn công trình': a.project_code ? `${a.project_code} ${a.project_name}` : 'Chưa gán CT',
          'Giá trị hao hụt': a.loss_amount,
          'Người điều chỉnh': a.adjusted_by_name,
        })),
      },
    ]);
  };

  const handlePrintAdjustments = () => {
    if (stockAdjustments.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Sổ điều chỉnh tồn kho (hao hụt / đếm thừa)',
      meta: [
        `${stockAdjustments.length} phiếu dòng`,
        `Tổng giá trị hao hụt: ${formatVND(totalLossValue)}`,
        `Còn chưa gán công trình: ${unassignedLosses.length} mục`,
      ],
      columns: [
        { header: 'Mã phiếu' },
        { header: 'Thời gian' },
        { header: 'Mặt hàng' },
        { header: 'Tồn trước', align: 'right' },
        { header: 'Chênh lệch', align: 'right' },
        { header: 'Tồn sau', align: 'right' },
        { header: 'Lý do' },
        { header: 'Công trình' },
        { header: 'Giá trị hao hụt', align: 'right' },
        { header: 'Người làm' },
      ],
      rows: stockAdjustments.slice(0, 1000).map((a) => [
        a.code,
        new Date(a.created_at).toLocaleString('vi-VN'),
        `${a.product_name} (${a.sku})`,
        String(a.previous_stock),
        String(a.delta),
        String(a.previous_stock + a.delta),
        STOCK_ADJUST_REASON_LABEL[a.reason] || a.reason,
        a.project_code || 'Chưa gán CT',
        a.loss_amount > 0 ? Math.round(a.loss_amount).toLocaleString('vi-VN') : '—',
        a.adjusted_by_name || '—',
      ]),
      footer: [
        'Tổng giá trị hao hụt',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        Math.round(totalLossValue).toLocaleString('vi-VN'),
        '',
      ],
    });
  };

  // Filtered products
  const filteredProducts = products.filter((p) => {
    if (p.product_type === 'service') return false;
    const matchesSearch =
      p.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(stockSearch.toLowerCase());
    let matchesStatus = true;
    if (stockStatusFilter === 'low') matchesStatus = isLowStock(p);
    else if (stockStatusFilter === 'out') matchesStatus = isOutOfStock(p);
    else if (stockStatusFilter === 'in_stock') matchesStatus = stockStatus(p) === 'ok';

    return matchesSearch && matchesStatus;
  });

  // Sorted products
  const sortedProducts = (() => {
    if (!stockSortKey) return filteredProducts;
    const statusRank = (p: Product) => (isOutOfStock(p) ? 0 : isLowStock(p) ? 1 : 2);
    const getters: Record<string, (p: Product) => unknown> = {
      sku: (p) => p.sku,
      name: (p) => p.name,
      unit: (p) => p.unit,
      stock_quantity: (p) => p.stock_quantity,
      avg_cost: (p) => p.avg_cost,
      import_price: (p) => p.import_price,
      stock_value: (p) => p.stock_quantity * p.avg_cost,
      status: (p) => statusRank(p),
    };
    const get = getters[stockSortKey];
    if (!get) return filteredProducts;
    return sortRows(filteredProducts, get, stockSortDir);
  })();

  // Paginated products
  const paginatedProducts = (() => {
    const start = (stockPage - 1) * stockPageSize;
    return sortedProducts.slice(start, start + stockPageSize);
  })();

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

  // Chế độ xem thẻ kho: gộp theo phiếu (mặc định, dễ theo dõi) hoặc từng dòng.
  const [movementView, setMovementView] = useState<'voucher' | 'lines'>('voucher');
  const [expandedVouchers, setExpandedVouchers] = useState<Record<string, boolean>>({});
  const toggleVoucher = (code: string) =>
    setExpandedVouchers((prev) => ({ ...prev, [code]: !prev[code] }));

  interface VoucherGroup {
    code: string;
    latestAt: string;
    type: string;
    supplier: string;
    count: number;
    totalQty: number;
    lines: typeof filteredMovements;
  }

  const voucherGroups = React.useMemo<VoucherGroup[]>(() => {
    const map = new Map<string, VoucherGroup>();
    for (const m of filteredMovements) {
      const g = map.get(m.reference_code);
      if (!g) {
        map.set(m.reference_code, {
          code: m.reference_code,
          latestAt: m.created_at,
          type: m.movement_type,
          supplier: parseVoucherSupplier(m.note || ''),
          count: 1,
          totalQty: m.quantity,
          lines: [m],
        });
      } else {
        g.lines.push(m);
        g.count += 1;
        g.totalQty += m.quantity;
        if (m.created_at > g.latestAt) {
          g.latestAt = m.created_at;
          g.type = m.movement_type;
          const s = parseVoucherSupplier(m.note || '');
          if (s) g.supplier = s;
        }
      }
    }
    return [...map.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [filteredMovements]);

  const paginatedVouchers = (() => {
    const start = (movementPage - 1) * movementPageSize;
    return voucherGroups.slice(start, start + movementPageSize);
  })();

  // Aggregate inventory values
  const totalInventoryValue = products.reduce((sum, p) => sum + (p.stock_quantity > 0 ? p.stock_quantity * p.avg_cost : 0), 0);

  return (
    <div id="inventory-view" className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 overflow-hidden">
      <PageHeader
        icon={<Boxes className="w-5 h-5 text-blue-600" />}
        title="Kho Hàng & Nhập Kho Vật Tư (Giá Vốn Bình Quân MAC)"
        shortTitle="Kho Hàng"
        shortBreakpoint="md"
        actions={
          <>
            {/* Tab Switcher */}
            <TabSwitcher<'stocks' | 'movements' | 'adjustments'>
              active={activeTab}
              onChange={(key) => {
                setActiveTab(key);
                if (key === 'adjustments') void refreshServerStockAdjustments(true);
              }}
              options={[
                { key: 'stocks', label: 'Tồn kho thực tế' },
                { key: 'movements', label: 'Nhật ký Thẻ kho' },
                {
                  key: 'adjustments',
                  label: 'Điều chỉnh tồn',
                  id: 'btn-inventory-tab-adjustments',
                  title: 'Phiếu điều chỉnh tồn: hao hụt, đếm thừa, ai điều chỉnh lúc nào',
                },
              ]}
            />
              {/* Nút phụ (Excel/In) trước, 2 nút hành động sau — cụm dồn về mép phải.
                  Kho có 2 nút chính (Điều chỉnh tồn / Tạo phiếu nhập) nên giữ thứ tự này. */}
              {activeTab === 'stocks' && <TableTools onExportExcel={handleExportStocks} onPrint={handlePrintStocks} />}
              {activeTab === 'movements' && <TableTools onExportExcel={handleExportMovements} onPrint={handlePrintMovements} />}
              {activeTab === 'adjustments' && <TableTools onExportExcel={handleExportAdjustments} onPrint={handlePrintAdjustments} />}
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

      {/* Main content body — khung cố định, chân bảng sát lề dưới (chuẩn các trang khác) */}
      <div className="flex-1 p-4 overflow-hidden min-h-0">
        {activeTab === 'stocks' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full">
            {/* Filter Bar */}
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <SearchInput
                value={stockSearch}
                onChange={(val) => {
                  setStockSearch(val);
                  setStockPage(1);
                }}
                placeholder="Tìm kiếm vật tư theo tên, mã SKU..."
                minWidthClass="min-w-[200px]"
              />

              <FilterSelect
                value={stockStatusFilter}
                onChange={(val) => {
                  setStockStatusFilter(val);
                  setStockPage(1);
                }}
                options={[
                  { value: 'all', label: 'Tất cả trạng thái kho' },
                  { value: 'low', label: 'Cảnh báo tồn ít (≤ tồn tối thiểu)' },
                  { value: 'out', label: 'Đã hết hàng (= 0)' },
                  { value: 'in_stock', label: 'Còn nhiều hàng (trên tồn tối thiểu)' },
                ]}
              />
            </div>

            {/* Summary metrics strip */}
            <SummaryStrip>
              <span>
                Tìm thấy <strong className="text-slate-900 font-mono">{filteredProducts.length}</strong> mặt hàng
              </span>
              <span>
                Tổng giá trị tồn kho:{' '}
                <strong className="font-mono text-blue-700 font-bold">{formatVND(totalInventoryValue)}</strong>
              </span>
            </SummaryStrip>

            {/* Mobile record list — bảng ngang chỉ dành cho desktop */}
            <div id="stock-record-list" className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {paginatedProducts.length === 0 ? (
                <ListEmpty>Không tìm thấy vật tư nào phù hợp với bộ lọc.</ListEmpty>
              ) : (
                paginatedProducts.map((p) => {
                  const isLow = isLowStock(p);
                  const isOut = isOutOfStock(p);
                  const stockValue = p.stock_quantity * p.avg_cost;
                  return (
                    <div key={p.id} className="px-3 py-2.5 active:bg-slate-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 leading-snug">{p.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{p.sku} · {p.unit}</p>
                        </div>
                        {isOut ? (
                          <StatusBadge tone="rose" className="shrink-0">Hết hàng</StatusBadge>
                        ) : isLow ? (
                          <StatusBadge tone="amber" className="shrink-0">Sắp hết</StatusBadge>
                        ) : (
                          <StatusBadge tone="emerald" weight="semibold" className="shrink-0">Đủ hàng</StatusBadge>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-end justify-between gap-2">
                        <div className="text-[11px] text-slate-500 font-mono">
                          <span className={isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}>
                            Tồn {formatQty(p.stock_quantity, p.product_type === 'area' || p.allow_decimal === true)}
                          </span>
                          {' · '}vốn BQ {formatVND(p.avg_cost)}
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-900">{formatVND(stockValue)}</span>
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
                  <SortableTh className="py-2.5 px-3" label="Mã SKU" sortKey="sku" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3" label="Tên hàng / Quy cách" sortKey="name" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="ĐVT" sortKey="unit" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Số lượng tồn" sortKey="stock_quantity" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Giá vốn MAC" sortKey="avg_cost" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Nhập gần nhất" sortKey="import_price" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Giá trị tồn kho" sortKey="stock_value" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="Tình trạng" sortKey="status" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedProducts.length === 0 ? (
                  <TableEmpty colSpan={8}>Không tìm thấy vật tư nào phù hợp với bộ lọc.</TableEmpty>
                ) : (
                  paginatedProducts.map((p) => {
                    const isLow = isLowStock(p);
                    const isOut = isOutOfStock(p);
                    const stockValue = p.stock_quantity * p.avg_cost;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{p.sku}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{p.name}</td>
                        <td className="py-2.5 px-3 text-center font-mono">{p.unit}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-sm">
                          <span
                            className={
                              isOut
                                ? 'text-rose-600 font-extrabold'
                                : isLow
                                ? 'text-amber-600 font-bold'
                                : 'text-slate-900'
                            }
                          >
                            {p.stock_quantity}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {formatVND(p.avg_cost)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono" title="Giá nhập kho lần gần nhất — so với vốn bình quân">
                          {p.import_price > 0 ? (
                            <>
                              <div className="font-bold text-slate-800">{formatVND(p.import_price)}</div>
                              {p.avg_cost > 0 && p.import_price !== p.avg_cost && (
                                <div className={`text-[10px] font-bold ${p.import_price > p.avg_cost ? 'text-rose-600' : 'text-emerald-600'}`}>
                                  {p.import_price > p.avg_cost ? '▲' : '▼'}{' '}
                                  {Math.abs(Math.round(((p.import_price - p.avg_cost) / p.avg_cost) * 100))}% vs vốn BQ
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatVND(stockValue)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isOut ? (
                            <StatusBadge tone="rose" icon={<AlertTriangle className="w-3 h-3" />}>
                              Hết hàng
                            </StatusBadge>
                          ) : isLow ? (
                            <StatusBadge tone="amber" icon={<AlertTriangle className="w-3 h-3" />}>
                              Sắp hết (≤{minStockOf(p)})
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="emerald" weight="semibold">
                              Đủ hàng
                            </StatusBadge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>

            {/* Pagination */}
            <PaginationBar
              currentPage={stockPage}
              totalItems={filteredProducts.length}
              pageSize={stockPageSize}
              onPageChange={setStockPage}
              onPageSizeChange={setStockPageSize}
              itemName="vật tư"
            />
          </div>
        )}

          {/* Tab 2: Create Purchase Import Order */}
          {/* Tab 3: Movements Audit Log (Thẻ kho) */}
          {activeTab === 'adjustments' && <StockAdjustTable />}
          {activeTab === 'movements' && (
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

              <TabSwitcher<'voucher' | 'lines'>
                active={movementView}
                onChange={(v) => {
                  setMovementView(v);
                  setMovementPage(1);
                }}
                options={[
                  { key: 'voucher', label: 'Theo phiếu' },
                  { key: 'lines', label: 'Theo dòng' },
                ]}
              />
              </div>

              {/* Dòng tổng hợp riêng — số bút toán chuyển từ nhãn tab xuống đây.
                  Giữ cả 2 số: đã lọc (theo ngày/loại) và tổng đã tải (như nhãn tab cũ). */}
              <SummaryStrip>
                <span>
                  {movementView === 'voucher' ? (
                    <>
                      Tìm thấy <strong className="text-slate-900 font-mono">{voucherGroups.length}</strong> phiếu
                      (<strong className="text-slate-900 font-mono">{sortedMovements.length}</strong> bút toán thẻ kho)
                    </>
                  ) : (
                    <>
                      Tìm thấy <strong className="text-slate-900 font-mono">{sortedMovements.length}</strong> bút toán thẻ kho
                    </>
                  )}
                </span>
                <span>
                  Tổng nhật ký: <strong className="text-slate-900 font-mono">{movements.length}</strong> bút toán
                </span>
              </SummaryStrip>

            {/* Mobile record list — bảng ngang chỉ dành cho desktop */}
            <div id="movement-record-list" className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
              {movementView === 'voucher' ? (
                paginatedVouchers.length === 0 ? (
                  <ListEmpty>Không tìm thấy phiếu kho nào phù hợp với bộ lọc.</ListEmpty>
                ) : (
                  paginatedVouchers.map((g) => {
                    const badge = movementBadge(g.type);
                    const open = !!expandedVouchers[g.code];
                    return (
                      <div key={g.code} className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleVoucher(g.code)}
                          className="w-full flex items-start justify-between gap-2 text-left"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold font-mono text-blue-700 leading-snug truncate">{g.code}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {new Date(g.latestAt).toLocaleString('vi-VN')}
                              {g.supplier ? ` · ${g.supplier}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                            <p className="mt-1 text-[11px] font-mono font-bold text-slate-700">
                              {g.count} dòng · {g.totalQty > 0 ? `+${g.totalQty}` : g.totalQty}
                            </p>
                          </div>
                        </button>
                        {open && (
                          <div className="mt-2 ml-1 pl-2 border-l-2 border-slate-200 space-y-1.5">
                            {g.lines.map((m) => (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="min-w-0 truncate text-slate-700 font-medium">{m.product_name}</span>
                                <span className={`shrink-0 font-mono font-bold ${m.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              ) : (
              paginatedMovements.length === 0 ? (
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
              ))}
            </div>

            <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            {movementView === 'voucher' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <th className="py-2.5 px-3">Mã phiếu</th>
                  <th className="py-2.5 px-3">Thời gian</th>
                  <th className="py-2.5 px-3">Nhà cung cấp</th>
                  <th className="py-2.5 px-3">Phân loại</th>
                  <th className="py-2.5 px-3 text-center">Số dòng</th>
                  <th className="py-2.5 px-3 text-right">Tổng SL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedVouchers.length === 0 ? (
                  <TableEmpty colSpan={6}>Không tìm thấy phiếu kho nào phù hợp với bộ lọc.</TableEmpty>
                ) : (
                  paginatedVouchers.map((g) => {
                    const badge = movementBadge(g.type);
                    const open = !!expandedVouchers[g.code];
                    const positive = g.totalQty > 0;
                    return (
                      <React.Fragment key={g.code}>
                        <tr
                          onClick={() => toggleVoucher(g.code)}
                          className="cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                            {open ? '▾' : '▸'} {g.code}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                            {new Date(g.latestAt).toLocaleString('vi-VN')}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {g.supplier || <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone={badge.tone} pill={false}>
                              {badge.label}
                            </StatusBadge>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-700">{g.count}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <span className={positive ? 'text-emerald-700' : 'text-rose-700'}>
                              {positive ? `+${g.totalQty}` : g.totalQty}
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={6} className="py-1.5 pl-8 pr-3">
                              <div className="space-y-1">
                                {g.lines.map((m) => (
                                  <div key={m.id} className="flex items-center justify-between gap-3 text-[11px] py-1 border-b border-slate-100 last:border-0">
                                    <span className="min-w-0 truncate text-slate-700 font-medium">
                                      {m.product_name}
                                      <span className="text-slate-400 font-mono"> · {m.previous_stock} → {m.new_stock}</span>
                                    </span>
                                    <span className={`shrink-0 font-mono font-bold ${m.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
            ) : (
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
            )}
            </div>

            {/* Pagination */}
            <PaginationBar
              currentPage={movementPage}
              totalItems={movementView === 'voucher' ? voucherGroups.length : filteredMovements.length}
              pageSize={movementPageSize}
              onPageChange={setMovementPage}
              onPageSizeChange={setMovementPageSize}
              itemName={movementView === 'voucher' ? 'phiếu kho' : 'bút toán thẻ kho'}
            />
          </div>
        )}
      </div>
      <StockAdjustModal open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </div>
  );
}
