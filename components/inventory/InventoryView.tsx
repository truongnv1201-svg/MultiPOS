'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { toast } from '@/lib/notify';
import { Product } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Boxes,
  Plus,
  ArrowDownToLine,
  TrendingDown,
  History,
  AlertTriangle,
  Search,
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  X,
} from 'lucide-react';
import { PaginationBar } from '@/components/common/PaginationBar';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import type { StockMovement } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export function InventoryView() {
  const { products, stockMovements, setCurrentScreen, setPosFlow } = useStore();
  const [activeTab, setActiveTab] = useState<'stocks' | 'movements'>('stocks');

  // Stocks filter & pagination state
  const [stockSearch, setStockSearch] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<string>('all');
  const [stockPage, setStockPage] = useState<number>(1);
  const [stockPageSize, setStockPageSize] = useState<number>(25);

  // Movements filter & pagination state
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFilter, setMovementDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [movementPage, setMovementPage] = useState<number>(1);
  const [movementPageSize, setMovementPageSize] = useState<number>(25);
  // Sắp xếp 2 bảng: bấm header để đảo chiều; đổi sort -> về trang 1
  const { sortKey: stockSortKey, sortDir: stockSortDir, toggleSort: toggleStockSort } = useSortState();
  const { sortKey: movSortKey, sortDir: movSortDir, toggleSort: toggleMovSort } = useSortState();
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
  };

  const handleExportStocks = () => {
    if (sortedProducts.length === 0) {
      toast('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('ton-kho', [
      {
        name: 'TonKho',
        rows: sortedProducts.map((p) => ({
          'Mã SKU': p.sku,
          'Tên hàng': p.name,
          'Danh mục': p.category,
          'ĐVT': p.unit,
          'Tồn kho': p.stock_quantity,
          'Giá vốn BQ': Math.round(p.avg_cost),
          'Giá trị tồn': Math.round(p.stock_quantity * p.avg_cost),
          'Tồn tối thiểu': p.min_stock ?? '',
        })),
      },
    ]);
  };

  const handlePrintStocks = () => {
    if (sortedProducts.length === 0) {
      toast('Không có dữ liệu để in!', 'error');
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
        { header: 'Giá trị tồn', align: 'right' },
      ],
      rows: sortedProducts.slice(0, 1000).map((p) => [
        p.sku,
        p.name,
        p.unit,
        String(p.stock_quantity),
        Math.round(p.avg_cost).toLocaleString('vi-VN'),
        Math.round(p.stock_quantity * p.avg_cost).toLocaleString('vi-VN'),
      ]),
      footer: ['Tổng', '', '', '', '', Math.round(totalInventoryValue).toLocaleString('vi-VN')],
    });
  };

  const handleExportMovements = () => {
    if (sortedMovements.length === 0) {
      toast('Không có dữ liệu để xuất!', 'error');
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
      toast('Không có dữ liệu để in!', 'error');
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

  // Unique categories
  const categories = new Set<string>();
  products.forEach((p) => {
    if (p.category) categories.add(p.category);
  });
  const categoriesArray = Array.from(categories);

  // Filtered products
  const filteredProducts = products.filter((p) => {
    if (p.product_type === 'service') return false;
    const matchesSearch =
      p.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(stockSearch.toLowerCase());
    const matchesCategory = stockCategoryFilter === 'all' || p.category === stockCategoryFilter;
    let matchesStatus = true;
    if (stockStatusFilter === 'low') matchesStatus = p.stock_quantity <= 15 && p.stock_quantity > 0;
    else if (stockStatusFilter === 'out') matchesStatus = p.stock_quantity <= 0;
    else if (stockStatusFilter === 'in_stock') matchesStatus = p.stock_quantity > 15;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Sorted products
  const sortedProducts = (() => {
    if (!stockSortKey) return filteredProducts;
    const statusRank = (p: Product) => (p.stock_quantity <= 0 ? 0 : p.stock_quantity <= 15 ? 1 : 2);
    const getters: Record<string, (p: Product) => unknown> = {
      sku: (p) => p.sku,
      name: (p) => p.name,
      category: (p) => p.category,
      unit: (p) => p.unit,
      stock_quantity: (p) => p.stock_quantity,
      avg_cost: (p) => p.avg_cost,
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

  // Filtered movements
  const filteredMovements = stockMovements.filter((m) => {
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

  // Aggregate inventory values
  const totalInventoryValue = products.reduce((sum, p) => sum + (p.stock_quantity > 0 ? p.stock_quantity * p.avg_cost : 0), 0);

  return (
    <div id="inventory-view" className="flex-1 flex flex-col h-[calc(100vh-56px)] bg-slate-100 overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-blue-600" />
            <span>Kho Hàng & Nhập Kho Vật Tư (Giá Vốn Bình Quân MAC)</span>
          </h2>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <Button
            variant="ghost"
            onClick={() => setActiveTab('stocks')}
            className={activeTab === 'stocks' ? 'bg-white text-blue-700 shadow-2xs hover:bg-white' : ''}
          >
            Tồn kho thực tế
          </Button>
          <Button
            variant="ghost"
            onClick={() => setActiveTab('movements')}
            className={activeTab === 'movements' ? 'bg-white text-blue-700 shadow-2xs hover:bg-white' : ''}
          >
            Nhật ký Thẻ kho ({stockMovements.length})
          </Button>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setPosFlow('import');
            setCurrentScreen('pos');
          }}
          title="Sang màn bán hàng ở chế độ nhập kho"
        >
          <Plus className="w-4 h-4" />
          <span>Tạo Phiếu Nhập Kho (PN)</span>
        </Button>
        {activeTab === 'stocks' && <TableTools onExportExcel={handleExportStocks} onPrint={handlePrintStocks} />}
        {activeTab === 'movements' && <TableTools onExportExcel={handleExportMovements} onPrint={handlePrintMovements} />}
        </div>
      </div>

      {/* Main content body */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'stocks' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
            {/* Filter Bar */}
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => {
                    setStockSearch(e.target.value);
                    setStockPage(1);
                  }}
                  placeholder="Tìm kiếm vật tư theo tên, mã SKU..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {/* Category Filter */}
              <select
                value={stockCategoryFilter}
                onChange={(e) => {
                  setStockCategoryFilter(e.target.value);
                  setStockPage(1);
                }}
                className="h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="all">Tất cả danh mục ({categoriesArray.length})</option>
                {categoriesArray.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {/* Stock status filter */}
              <select
                value={stockStatusFilter}
                onChange={(e) => {
                  setStockStatusFilter(e.target.value);
                  setStockPage(1);
                }}
                className="h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="all">Tất cả trạng thái kho</option>
                <option value="low">Cảnh báo tồn ít (≤ 15)</option>
                <option value="out">Đã hết hàng (= 0)</option>
                <option value="in_stock">Còn nhiều hàng (&gt; 15)</option>
              </select>
            </div>

            {/* Summary metrics strip */}
            <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>
                Tìm thấy <strong className="text-slate-900 font-mono">{filteredProducts.length}</strong> mặt hàng
              </span>
              <span>
                Tổng giá trị tồn kho:{' '}
                <strong className="font-mono tnum text-blue-700 font-bold">{formatVND(totalInventoryValue)}</strong>
              </span>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <SortableTh className="py-2.5 px-3" label="Mã SKU" sortKey="sku" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3" label="Tên hàng / Quy cách" sortKey="name" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3" label="Loại vật tư" sortKey="category" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="ĐVT" sortKey="unit" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Số lượng tồn" sortKey="stock_quantity" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Giá vốn MAC" sortKey="avg_cost" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Giá trị tồn kho" sortKey="stock_value" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                  <SortableTh className="py-2.5 px-3 text-center" label="Tình trạng" sortKey="status" activeKey={stockSortKey} dir={stockSortDir} onSort={handleStockSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState message="Không tìm thấy vật tư nào phù hợp với bộ lọc." />
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((p) => {
                    const isLow = p.stock_quantity <= 15 && p.stock_quantity > 0;
                    const isOut = p.stock_quantity <= 0;
                    const stockValue = p.stock_quantity * p.avg_cost;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{p.sku}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{p.name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{p.category}</td>
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
                        <td className="py-2.5 px-3 text-right font-mono tnum text-slate-700">
                          {formatVND(p.avg_cost)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tnum font-bold text-slate-900">
                          {formatVND(stockValue)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isOut ? (
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Hết hàng
                            </span>
                          ) : isLow ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Sắp hết (≤15)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-semibold">
                              Đủ hàng
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

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
        {activeTab === 'movements' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
            {/* Filter Bar */}
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={movementSearch}
                  onChange={(e) => {
                    setMovementSearch(e.target.value);
                    setMovementPage(1);
                  }}
                  placeholder="Mã phiếu, sản phẩm, nội dung..."
                  className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {/* Date Filter */}
              <DateFilter
                value={movementDateFilter}
                onChange={(val) => {
                  setMovementDateFilter(val);
                  setMovementPage(1);
                }}
              />

              {/* Movement Type Filter */}
              <select
                value={movementTypeFilter}
                onChange={(e) => {
                  setMovementTypeFilter(e.target.value);
                  setMovementPage(1);
                }}
                className="h-8 px-2 bg-white border border-slate-300 rounded-md text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="all">Tất cả nghiệp vụ</option>
                <option value="import">Nhập kho (PN)</option>
                <option value="export_sales">Xuất bán POS</option>
                <option value="export_project">Vật tư công trình</option>
                <option value="return">Nhập lại / Trả hàng</option>
              </select>
            </div>

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
                  <tr>
                    <td colSpan={8}>
                      <EmptyState message="Không tìm thấy bút toán thẻ kho nào phù hợp với bộ lọc." />
                    </td>
                  </tr>
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
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.movement_type === 'import'
                                ? 'bg-emerald-100 text-emerald-800'
                                : m.movement_type === 'export_sales'
                                ? 'bg-blue-100 text-blue-800'
                                : m.movement_type === 'export_project'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {m.movement_type === 'import'
                              ? 'Nhập kho'
                              : m.movement_type === 'export_sales'
                              ? 'Xuất bán POS'
                              : m.movement_type === 'export_project'
                              ? 'Vật tư công trình'
                              : 'Nhập lại / Trả hàng'}
                          </span>
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
        )}
      </div>
    </div>
  );
}
