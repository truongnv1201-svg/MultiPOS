'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { PurchaseOrder } from '@/lib/types';
import { formatVND } from '@/lib/format';
import { formatQty } from '@/lib/quantity';
import { ScrollText, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SearchInput, FilterSelect } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty } from '@/components/ui/ListStates';
import { AppButton } from '@/components/ui/AppButton';
import { PaginationBar } from '@/components/common/PaginationBar';
import { notify } from '@/components/common/Toast';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';

const IMPORT_STATUS_LABEL: Record<string, string> = {
  completed: 'Hoàn tất',
  debt: 'Công nợ',
  partial: 'Trả một phần',
  cancelled: 'Đã hủy',
};

export function ImportsView({ bare = false }: { bare?: boolean } = {}) {
  const {
    purchaseOrders,
    refreshPurchaseOrders,
    refreshServerPurchaseOrders,
    setCurrentScreen,
    setPosFlow,
  } = useStore();

  // Dexie local là truth dòng hàng của máy mình; mở trang thì nạp local + kéo server
  // để thấy đủ phiếu liên máy (defer microtask theo idiom chung của repo).
  useEffect(() => {
    Promise.resolve().then(() => {
      refreshPurchaseOrders();
      void refreshServerPurchaseOrders();
    });
  }, [refreshPurchaseOrders, refreshServerPurchaseOrders]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: '7days' });
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  // Mặc định mới nhất lên trên (khớp thứ tự server) để không nháy khi dữ liệu về.
  const { sortKey, sortDir, toggleSort } = useSortState('created_at', 'desc');
  const handleSort = (key: string) => {
    toggleSort(key);
    setCurrentPage(1);
  };

  // Chỉ lưu id đang chọn, bản detail luôn suy từ dữ liệu mới nhất qua useMemo.
  // Chi tiết CHỈ hiện phiếu trong danh sách đang lọc.
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedPoCode, setSelectedPoCode] = useState<string | null>(null);
  const pickPo = (id: string, code: string) => {
    setSelectedPoId(id);
    setSelectedPoCode(code);
  };
  const clearSelection = () => {
    setSelectedPoId(null);
    setSelectedPoCode(null);
  };

  const filteredPos = useMemo(() => {
    return purchaseOrders.filter((p) => {
      const q = search.toLowerCase();
      const matchesSearch =
        p.code.toLowerCase().includes(q) ||
        p.supplier_name.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesSupplier = supplierFilter === 'all' || p.supplier_name === supplierFilter;
      const matchesDate = matchesDateFilter(p.created_at, dateFilter);
      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    });
  }, [purchaseOrders, search, statusFilter, supplierFilter, dateFilter]);

  const selectedPo = useMemo(() => {
    if (!selectedPoId && !selectedPoCode) return null;
    return (
      filteredPos.find((p) => p.id === selectedPoId) ??
      filteredPos.find((p) => p.code === selectedPoCode) ??
      null
    );
  }, [filteredPos, selectedPoId, selectedPoCode]);

  // Danh sách NCC (lọc trùng) để làm bộ lọc
  const supplierOptions = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of purchaseOrders) {
      const name = (p.supplier_name || '').trim();
      if (!name) continue;
      set.set(name, (set.get(name) || 0) + 1);
    }
    return [...set.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
      .map(([name, count]) => ({ name, count }));
  }, [purchaseOrders]);

  // Aggregate stats for filtered POs
  const stats = useMemo(() => {
    return filteredPos.reduce(
      (acc, cur) => {
        acc.totalImport += cur.total_amount;
        acc.totalPaid += cur.paid_amount;
        acc.totalDebt += cur.debt_amount;
        return acc;
      },
      { totalImport: 0, totalPaid: 0, totalDebt: 0 }
    );
  }, [filteredPos]);

  const sortedPos = useMemo(() => {
    if (!sortKey) return filteredPos;
    const getters: Record<string, (p: PurchaseOrder) => unknown> = {
      code: (p) => p.code,
      created_at: (p) => p.created_at,
      supplier_name: (p) => p.supplier_name,
      total_amount: (p) => p.total_amount,
      paid_amount: (p) => p.paid_amount,
      debt_amount: (p) => p.debt_amount,
      status: (p) => p.status,
    };
    const get = getters[sortKey];
    if (!get) return filteredPos;
    return sortRows(filteredPos, get, sortDir);
  }, [filteredPos, sortKey, sortDir]);

  const paginatedPos = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedPos.slice(start, start + pageSize);
  }, [sortedPos, currentPage, pageSize]);

  // Reset page + bỏ chọn khi đổi bộ lọc (khỏi bấm nhầm phiếu khác trang)
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleStatusChange = (val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleSupplierChange = (val: string) => {
    setSupplierFilter(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleDateChange = (val: DateFilterState) => {
    setDateFilter(val);
    setCurrentPage(1);
    clearSelection();
  };

  // ---- Xuất Excel / In bảng ----
  const poToRow = (p: PurchaseOrder): Record<string, unknown> => ({
    'Mã phiếu': p.code,
    'Ngày': new Date(p.created_at).toLocaleString('vi-VN'),
    'Nhà cung cấp': p.supplier_name,
    'Số dòng hàng': p.items.length,
    'Tổng tiền': p.total_amount,
    'Đã trả': p.paid_amount,
    'Còn nợ': p.debt_amount,
    'Trạng thái': IMPORT_STATUS_LABEL[p.status] || p.status,
    'Ghi chú': p.note || '',
  });

  const handleExportExcel = () => {
    if (sortedPos.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('don-nhap', [{ name: 'DonNhap', rows: sortedPos.map(poToRow) }]);
  };

  const handlePrint = () => {
    if (sortedPos.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Danh sách phiếu nhập kho',
      meta: [`${sortedPos.length} phiếu`, `Tổng nhập: ${formatVND(stats.totalImport)}`],
      columns: [
        { header: 'Mã phiếu' },
        { header: 'Nhà cung cấp' },
        { header: 'Tổng tiền', align: 'right' },
        { header: 'Đã trả', align: 'right' },
        { header: 'Còn nợ', align: 'right' },
        { header: 'Trạng thái' },
      ],
      rows: sortedPos.slice(0, 1000).map((p) => [
        p.code,
        p.supplier_name,
        p.total_amount.toLocaleString('vi-VN'),
        p.paid_amount.toLocaleString('vi-VN'),
        p.debt_amount.toLocaleString('vi-VN'),
        IMPORT_STATUS_LABEL[p.status] || p.status,
      ]),
      footer: ['Tổng', '', stats.totalImport.toLocaleString('vi-VN'), stats.totalPaid.toLocaleString('vi-VN'), stats.totalDebt.toLocaleString('vi-VN'), ''],
    });
  };

  return (
    <div id="imports-view" className={`flex-1 flex flex-col min-h-0 bg-slate-100 overflow-hidden ${bare ? 'h-full' : 'h-[calc(100dvh-56px)]'}`}>
      {!bare && (
      <PageHeader
        icon={<ScrollText className="w-5 h-5 text-blue-600" />}
        title="Quản lý Đơn nhập"
        count={`${purchaseOrders.length} phiếu nhập`}
        actions={
          <>
            <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
            <AppButton
              onClick={() => {
                setPosFlow('import');
                setCurrentScreen('pos');
              }}
            >
              <Plus className="w-4 h-4" />
              <span>Tạo phiếu nhập</span>
            </AppButton>
          </>
        }
      />
      )}

      {/* Main Content: Table + Detail Preview */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Left: Imports Table */}
        <div className="flex-1 flex flex-col bg-slate-100 min-w-0 min-h-0">
          <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden min-h-0">
            {/* Filters Bar */}
            <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
              <SearchInput
                value={search}
                onChange={handleSearchChange}
                placeholder="Mã phiếu, tên nhà cung cấp..."
              />

              {/* Date filter */}
              <DateFilter value={dateFilter} onChange={handleDateChange} />

              <FilterSelect
                value={statusFilter}
                onChange={handleStatusChange}
                options={[
                  { value: 'all', label: 'Tất cả trạng thái' },
                  { value: 'completed', label: 'Hoàn tất (trả đủ)' },
                  { value: 'debt', label: 'Công nợ (chưa trả)' },
                  { value: 'partial', label: 'Trả một phần' },
                  { value: 'cancelled', label: 'Đã hủy' },
                ]}
              />

              <FilterSelect
                value={supplierFilter}
                onChange={handleSupplierChange}
                className="max-w-[220px]"
                title="Lọc theo nhà cung cấp"
                options={[
                  { value: 'all', label: 'Tất cả nhà cung cấp' },
                  ...supplierOptions.map((s) => ({ value: s.name, label: `${s.name} (${s.count})` })),
                ]}
              />
              {bare && <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />}
            </div>

            {/* Aggregate Summary Strip */}
            <SummaryStrip>
              <div className="flex items-center gap-4">
                <span>
                  Tổng nhập lọc:{' '}
                  <strong className="font-mono text-slate-900">{formatVND(stats.totalImport)}</strong>
                </span>
                <span className="text-emerald-700">
                  Đã trả:{' '}
                  <strong className="font-mono text-emerald-800">{formatVND(stats.totalPaid)}</strong>
                </span>
                <span className="text-rose-600">
                  Còn nợ NCC:{' '}
                  <strong className="font-mono text-rose-700">{formatVND(stats.totalDebt)}</strong>
                </span>
              </div>
            </SummaryStrip>

            {/* Imports Table */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                      <SortableTh className="py-2.5 px-3" label="Mã phiếu" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3" label="Thời gian" sortKey="created_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3" label="Nhà cung cấp" sortKey="supplier_name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3 text-right" label="Tổng tiền" sortKey="total_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3 text-right" label="Đã trả" sortKey="paid_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3 text-right" label="Còn nợ" sortKey="debt_amount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh className="py-2.5 px-3 text-center" label="Trạng thái" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedPos.length === 0 ? (
                      <TableEmpty colSpan={7}>Không tìm thấy phiếu nhập nào phù hợp với bộ lọc.</TableEmpty>
                    ) : (
                      paginatedPos.map((po) => {
                        const isSelected = selectedPo?.id === po.id;
                        return (
                          <tr
                            key={po.id}
                            onClick={() => pickPo(po.id, po.code)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-50/80 font-medium' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                              {po.code}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                              {new Date(po.created_at).toLocaleString('vi-VN')}
                            </td>
                            <td className="py-2.5 px-3 text-slate-800">
                              <div>{po.supplier_name}</div>
                              <div className="text-[10px] text-slate-400">{po.items.length} dòng hàng</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {formatVND(po.total_amount)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                              {formatVND(po.paid_amount)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-rose-600 font-semibold">
                              {po.debt_amount > 0 ? formatVND(po.debt_amount) : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {po.status === 'completed' && (
                                <StatusBadge tone="emerald">Hoàn tất</StatusBadge>
                              )}
                              {po.status === 'debt' && (
                                <StatusBadge tone="rose">Công nợ</StatusBadge>
                              )}
                              {po.status === 'partial' && (
                                <StatusBadge tone="amber">Trả một phần</StatusBadge>
                              )}
                              {po.status === 'cancelled' && (
                                <StatusBadge tone="rose">Đã hủy</StatusBadge>
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
                currentPage={currentPage}
                totalItems={filteredPos.length}
                pageSize={pageSize}
                onPageChange={(p) => {
                  setCurrentPage(p);
                  clearSelection();
                }}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setCurrentPage(1);
                  clearSelection();
                }}
                itemName="phiếu nhập"
              />
            </div>
          </div>
        </div>

        {/* Right: Selected PO Detail Preview */}
        {selectedPo ? (
          <div className="w-full md:w-96 bg-slate-100 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs p-3 flex flex-col overflow-y-auto">
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 font-mono">
                      {selectedPo.code}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {new Date(selectedPo.created_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                </div>

                {/* Supplier info */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                  <div className="text-slate-500 text-[11px]">Nhà cung cấp:</div>
                  <div className="font-semibold text-slate-800">{selectedPo.supplier_name}</div>
                </div>

                {selectedPo.note && (
                  <div className="bg-amber-50/60 p-2.5 rounded-lg border border-amber-200 text-xs">
                    <span className="font-semibold text-amber-800">Ghi chú: </span>
                    <span className="text-slate-700">{selectedPo.note}</span>
                  </div>
                )}

                {/* Line items list */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-700">Chi tiết mặt hàng ({selectedPo.items.length}):</div>
                  <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {selectedPo.items.map((it, idx) => (
                      <div key={`${it.product_id}-${idx}`} className="p-2.5 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span className="font-bold text-slate-800">{it.name}</span>
                          <span className="font-mono text-slate-900">{formatVND(it.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>
                            {it.sku} • SL: {formatQty(it.quantity)} x {formatVND(it.unit_price)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Financial summary */}
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5 font-mono">
                  <div className="flex justify-between text-slate-600">
                    <span>Tiền hàng:</span>
                    <span>{formatVND(selectedPo.subtotal)}</span>
                  </div>
                  {selectedPo.discount_amount > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Giảm giá:</span>
                      <span>-{formatVND(selectedPo.discount_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-sm">
                    <span>Tổng cộng:</span>
                    <span>{formatVND(selectedPo.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Đã trả NCC:</span>
                    <span>{formatVND(selectedPo.paid_amount)}</span>
                  </div>
                  {selectedPo.debt_amount > 0 && (
                    <div className="flex justify-between text-rose-600 font-bold">
                      <span>Còn nợ:</span>
                      <span>{formatVND(selectedPo.debt_amount)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full md:w-96 bg-slate-100 flex-col min-h-0">
            <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs flex items-center justify-center text-slate-400 text-xs p-3">
              Chọn phiếu nhập để xem chi tiết
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
