'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { SearchInput } from '@/components/ui/FilterControls';
import { SummaryStrip, TableEmpty } from '@/components/ui/ListStates';
import { PaginationBar } from '@/components/common/PaginationBar';
import { DateFilter, DateFilterState, matchesDateFilter } from '@/components/common/DateFilter';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { sortRows } from '@/lib/sort';
import { formatNumber } from '@/lib/format';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ExportGroup {
  key: string;
  projectCode: string;
  projectName: string;
  day: string;
  created_at: string;
  lines: { id: string; product_name: string; quantity: number; note: string }[];
  totalQty: number;
}

// Tab Xuất công trình: gộp dòng thẻ kho export_project (đã pull từ server) theo
// (công trình + ngày). Xuất CT hiện không có mã phiếu riêng nên đây là gom nhóm
// hiển thị, không phải chứng từ có mã — muốn chuẩn phiếu thì sinh mã batch PX (phase 2).
export function ExportsTab() {
  const { stockMovements, projects } = useStore();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: '7days' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { sortKey, sortDir, toggleSort } = useSortState('created_at', 'desc');

  const projectNameOf = (code: string): string => {
    const p = (projects || []).find((x) => x.code === code);
    return p ? p.name : '';
  };

  const groups = useMemo<ExportGroup[]>(() => {
    const map = new Map<string, ExportGroup>();
    for (const m of stockMovements) {
      if (m.movement_type !== 'export_project') continue;
      if (!matchesDateFilter(m.created_at, dateFilter)) continue;
      const q = search.toLowerCase();
      if (
        q &&
        !m.reference_code.toLowerCase().includes(q) &&
        !m.product_name.toLowerCase().includes(q) &&
        !projectNameOf(m.reference_code).toLowerCase().includes(q)
      ) {
        continue;
      }
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
      g.lines.push({ id: m.id, product_name: m.product_name, quantity: Math.abs(m.quantity), note: m.note || '' });
      g.totalQty += Math.abs(m.quantity);
      if (m.created_at > g.created_at) g.created_at = m.created_at;
    }
    return [...map.values()];
  }, [stockMovements, projects, search, dateFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return groups;
    const getters: Record<string, (g: ExportGroup) => unknown> = {
      created_at: (g) => g.created_at,
      projectCode: (g) => g.projectCode,
      totalQty: (g) => g.totalQty,
      lines: (g) => g.lines.length,
    };
    const get = getters[sortKey];
    if (!get) return groups;
    return sortRows(groups, get, sortDir);
  }, [groups, sortKey, sortDir]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
  };
  const handleDateChange = (val: DateFilterState) => {
    setDateFilter(val);
    setCurrentPage(1);
  };
  const handleSort = (key: string) => {
    toggleSort(key);
    setCurrentPage(1);
  };

  const handleExportExcel = () => {
    exportToExcel('xuat-cong-trinh', [
      {
        name: 'XuatCongTrinh',
        rows: sorted.map((g) => ({
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
    printTable({
      title: 'Xuất vật tư công trình (gộp theo công trình + ngày)',
      meta: [`${sorted.length} lượt xuất`],
      columns: [
        { header: 'Ngày' },
        { header: 'Công trình' },
        { header: 'Số dòng', align: 'right' },
        { header: 'Tổng SL', align: 'right' },
      ],
      rows: sorted.slice(0, 1000).map((g) => [g.day, g.projectName ? `${g.projectCode} (${g.projectName})` : g.projectCode, String(g.lines.length), g.totalQty.toLocaleString('vi-VN')]),
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden min-h-0">
      <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
        <SearchInput value={search} onChange={handleSearchChange} placeholder="Mã công trình, tên hàng..." />
        <DateFilter value={dateFilter} onChange={handleDateChange} />
        <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
      </div>

      <SummaryStrip>
        <span>
          {sorted.length} lượt xuất công trình trong kỳ lọc
        </span>
      </SummaryStrip>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
              <th className="py-2.5 px-3 w-8" />
              <SortableTh className="py-2.5 px-3" label="Ngày" sortKey="created_at" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh className="py-2.5 px-3" label="Công trình" sortKey="projectCode" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh className="py-2.5 px-3 text-right" label="Số dòng" sortKey="lines" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableTh className="py-2.5 px-3 text-right" label="Tổng SL" sortKey="totalQty" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.length === 0 ? (
              <TableEmpty colSpan={5}>Không có lượt xuất vật tư nào trong kỳ lọc.</TableEmpty>
            ) : (
              paginated.map((g) => {
                const open = !!expanded[g.key];
                return (
                  <React.Fragment key={g.key}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpanded((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                    >
                      <td className="py-2.5 px-3 text-slate-400">
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{g.day}</td>
                      <td className="py-2.5 px-3 text-slate-800">
                        <div className="font-mono font-bold text-blue-700">{g.projectCode}</div>
                        {g.projectName && <div className="text-[11px] text-slate-500">{g.projectName}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{g.lines.length}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatNumber(g.totalQty)}</td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={4} className="py-2 px-3">
                          <div className="space-y-1">
                            {g.lines.map((l) => (
                              <div key={l.id} className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded-md px-2 py-1.5">
                                <span className="font-medium text-slate-700 truncate">{l.product_name}</span>
                                <span className="font-mono text-slate-600 whitespace-nowrap">x{l.quantity}</span>
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
      </div>

      <PaginationBar
        currentPage={currentPage}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setCurrentPage(1);
        }}
        itemName="lượt xuất"
      />
    </div>
  );
}
