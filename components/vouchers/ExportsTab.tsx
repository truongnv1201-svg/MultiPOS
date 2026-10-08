'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { SearchInput, FilterSelect } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty } from '@/components/ui/ListStates';
import { PaginationBar } from '@/components/common/PaginationBar';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import { formatQty } from '@/lib/quantity';

interface ExportGroup {
  key: string;
  projectCode: string;
  projectName: string;
  day: string;
  created_at: string;
  lines: { id: string; product_name: string; quantity: number; note: string }[];
  totalQty: number;
}

// Tab Xuất công trình: cùng khung master-detail như Đơn bán/Đơn nhập (bảng trái +
// panel phải). Dòng = lượt xuất gộp theo (công trình + ngày) từ thẻ kho server —
// xuất CT hiện không có mã phiếu riêng nên đây là gom nhóm hiển thị, muốn chuẩn
// phiếu thì sinh mã batch PX (phase 2).
export function ExportsTab() {
  const { stockMovements, projects, products } = useStore();
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'this_week' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const { sortKey, sortDir, toggleSort } = useSortState('created_at', 'desc');

  const projectNameOf = (code: string): string => {
    const p = (projects || []).find((x) => x.code === code);
    return p ? p.name : '';
  };

  // Server chỉ lưu product_id trên thẻ kho (bỏ JOIN để nhẹ payload) — tra tên
  // từ catalog local như Thẻ kho, mục đã xóa mới rơi về nhãn dự phòng.
  const productNameOf = (product_id: string, fallback: string): string => {
    const hit = (products || []).find((p) => p.id === product_id);
    return hit?.name || fallback || 'Sản phẩm đã xóa';
  };

  const groups = useMemo<ExportGroup[]>(() => {
    const map = new Map<string, ExportGroup>();
    for (const m of stockMovements) {
      if (m.movement_type !== 'export_project') continue;
      if (!matchesDateFilter(m.created_at, dateFilter)) continue;
      const itemName = productNameOf(m.product_id, m.product_name);
      const q = search.toLowerCase();
      if (
        q &&
        !m.reference_code.toLowerCase().includes(q) &&
        !itemName.toLowerCase().includes(q) &&
        !projectNameOf(m.reference_code).toLowerCase().includes(q)
      ) {
        continue;
      }
      if (projectFilter !== 'all' && m.reference_code !== projectFilter) continue;
      const day = new Date(m.created_at).toLocaleDateString('vi-VN');
      const key = `${m.reference_code}__${day}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          projectCode: m.reference_code,
          projectName: projectNameOf(m.reference_code),
          day,
          created_at: m.created_at,
          lines: [],
          totalQty: 0,
        };
        map.set(key, g);
      }
      g.lines.push({ id: m.id, product_name: itemName, quantity: Math.abs(m.quantity), note: m.note || '' });
      g.totalQty += Math.abs(m.quantity);
      if (m.created_at > g.created_at) g.created_at = m.created_at;
    }
    return [...map.values()];
  }, [stockMovements, projects, products, search, projectFilter, dateFilter]);

  const projectOptions = useMemo(() => {
    const set = new Map<string, number>();
    for (const m of stockMovements) {
      if (m.movement_type !== 'export_project') continue;
      set.set(m.reference_code, (set.get(m.reference_code) || 0) + 1);
    }
    return [...set.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
      .map(([code, count]) => ({ code, count, name: projectNameOf(code) }));
  }, [stockMovements, projects]);

  const sortedGroups = useMemo(() => {
    if (!sortKey) return groups;
    const getters: Record<string, (g: ExportGroup) => unknown> = {
      created_at: (g) => g.created_at,
      projectCode: (g) => g.projectCode,
      lines: (g) => g.lines.length,
      totalQty: (g) => g.totalQty,
    };
    const get = getters[sortKey];
    if (!get) return groups;
    return sortRows(groups, get, sortDir);
  }, [groups, sortKey, sortDir]);

  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedGroups.slice(start, start + pageSize);
  }, [sortedGroups, currentPage, pageSize]);

  // Chi tiết chỉ hiện lượt xuất trong danh sách đã lọc (null stays null để khỏi
  // dính lựa chọn cũ ngoài bộ lọc khi đổi filter/trang).
  const selectedGroup = useMemo(() => {
    if (!selectedGroupKey) return null;
    return sortedGroups.find((g) => g.key === selectedGroupKey) ?? null;
  }, [sortedGroups, selectedGroupKey]);

  const clearSelection = () => setSelectedGroupKey(null);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleProjectChange = (val: string) => {
    setProjectFilter(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleDateChange = (val: DateFilterState) => {
    setDateFilter(val);
    setCurrentPage(1);
    clearSelection();
  };
  const handleSort = (key: string) => {
    toggleSort(key);
    setCurrentPage(1);
  };

  const handleExportExcel = () => {
    if (sortedGroups.length === 0) return;
    exportToExcel('xuat-cong-trinh', [
      {
        name: 'XuatCongTrinh',
        rows: sortedGroups.map((g) => ({
          Ngày: g.day,
          'Công trình': g.projectCode,
          'Tên công trình': g.projectName,
          'Số dòng': g.lines.length,
          'Tổng SL': g.totalQty,
        })),
      },
    ]);
  };

  const handlePrint = () => {
    if (sortedGroups.length === 0) return;
    printTable({
      title: 'Xuất vật tư công trình (gộp theo công trình + ngày)',
      meta: [`${sortedGroups.length} lượt xuất`],
      columns: [
        { header: 'Ngày' },
        { header: 'Công trình' },
        { header: 'Số dòng', align: 'right' },
        { header: 'Tổng SL', align: 'right' },
      ],
      rows: sortedGroups.slice(0, 1000).map((g) => [g.day, g.projectName ? `${g.projectCode} (${g.projectName})` : g.projectCode, String(g.lines.length), g.totalQty.toLocaleString('vi-VN')]),
    });
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
      {/* Left: Export Groups Table */}
      <div className="flex-1 flex flex-col bg-slate-100 min-w-0 min-h-0">
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden min-h-0">
          <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
            <SearchInput
              value={search}
              onChange={handleSearchChange}
              placeholder="Mã công trình, tên hàng..."
            />
            <DateFilter value={dateFilter} onChange={handleDateChange} />
            <FilterSelect
              value={projectFilter}
              onChange={handleProjectChange}
              className="max-w-[220px]"
              title="Lọc theo công trình"
              options={[
                { value: 'all', label: 'Tất cả công trình' },
                ...projectOptions.map((p) => ({
                  value: p.code,
                  label: p.name ? `${p.code} (${p.name})` : p.code,
                })),
              ]}
            />
            <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
          </div>

          <SummaryStrip>
            <span>
              {sortedGroups.length} lượt xuất công trình trong kỳ lọc
            </span>
          </SummaryStrip>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                  <SortableTh className="py-2.5 px-3" label="Ngày" sortKey="created_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3" label="Công trình" sortKey="projectCode" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Số dòng" sortKey="lines" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh className="py-2.5 px-3 text-right" label="Tổng SL" sortKey="totalQty" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedGroups.length === 0 ? (
                  <TableEmpty colSpan={4}>Không có lượt xuất vật tư nào trong kỳ lọc.</TableEmpty>
                ) : (
                  paginatedGroups.map((g) => {
                    const isSelected = selectedGroup?.key === g.key;
                    return (
                      <tr
                        key={g.key}
                        onClick={() => setSelectedGroupKey(g.key)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/80 font-medium' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                          {g.day}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">
                          <div className="font-mono font-bold text-blue-700">{g.projectCode}</div>
                          {g.projectName && (
                            <div className="text-[11px] text-slate-500">{g.projectName}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">{g.lines.length}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatQty(g.totalQty)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar
            currentPage={currentPage}
            totalItems={sortedGroups.length}
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
            itemName="lượt xuất"
          />
        </div>
      </div>

      {/* Right: Selected Export Detail Preview */}
      {selectedGroup ? (
        <div className="w-full md:w-96 bg-slate-100 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs p-3 flex flex-col overflow-y-auto">
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 font-mono">
                    {selectedGroup.projectCode}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Xuất ngày {selectedGroup.day}
                  </p>
                </div>
              </div>

              {/* Project info */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                <div className="text-slate-500 text-[11px]">Công trình:</div>
                <div className="font-semibold text-slate-800">
                  {selectedGroup.projectName || selectedGroup.projectCode}
                </div>
              </div>

              {/* Line items list */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700">Chi tiết vật tư ({selectedGroup.lines.length}):</div>
                <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {selectedGroup.lines.map((l) => (
                    <div key={l.id} className="p-2.5 space-y-1">
                      <div className="flex justify-between font-medium">
                        <span className="font-bold text-slate-800">{l.product_name}</span>
                        <span className="font-mono text-slate-900">x{formatQty(l.quantity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Số dòng:</span>
                  <span>{selectedGroup.lines.length}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200 text-sm">
                  <span>Tổng SL:</span>
                  <span>{formatQty(selectedGroup.totalQty)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full md:w-96 bg-slate-100 flex-col min-h-0">
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-2xs flex items-center justify-center text-slate-400 text-xs p-3">
            Chọn lượt xuất để xem chi tiết
          </div>
        </div>
      )}
    </div>
  );
}
