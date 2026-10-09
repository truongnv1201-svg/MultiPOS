// 0064 — Sổ phiếu điều chỉnh tồn (hao hụt / đếm thừa), hiển thị ở tab Điều chỉnh
// của trang Quản lý Chứng từ.
//
// Vai trò: đây là "sổ sổ cái" của tồn kho — ai điều chỉnh, lúc nào, vì lý do gì, tồn
// trước/sau, giá trị hao hụt. Không có tab này thì điều chỉnh tồn là thao tác "vô hình".
//
// Riêng phần "chưa gán công trình": cho phép gán bổ sung SAU khi công trình xác nhận.
// Gán không đụng tồn kho (đã trừ đúng một lần lúc ghi phiếu), chỉ chuyển chi phí hao hụt
// sang P&L công trình — nên thao tác này an toàn, làm nhiều lần cũng không sai tồn.
//
// Bố cục chuẩn như 2 bảng chính (Tồn kho thực tế / Nhật ký Thẻ kho): thanh tìm kiếm
// (p-2.5 bg-slate-50) + dòng tổng hợp (px-3 py-1.5 bg-slate-100/70 border-b) + bảng
// desktop (th py-2.5 px-3) + danh sách gọn trên mobile + phân trang dưới cùng.
// Số mục chưa gán công trình nằm ở dòng tổng hợp, KHÔNG nằm trên nhãn tab.
'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { notify } from '@/components/common/Toast';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { PaginationBar } from '@/components/common/PaginationBar';
import { formatVND } from '@/lib/format';
import { formatQty } from '@/lib/quantity';
import { HardHat, Package, Search } from 'lucide-react';
import { STOCK_ADJUST_REASON_LABEL } from '@/lib/types';
import { TableTools } from '@/components/common/TableTools';
import { FilterSelect } from '@/components/ui/FilterControls';
import { exportToExcel, printTable } from '@/lib/excel';

export function StockAdjustTable() {
  const { stockAdjustments, projects, assignAdjustProject, profile } = useStore();
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [pickProject, setPickProject] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'loss' | 'gain' | 'unassigned'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const canAssign = !profile || profile.role === 'admin' || profile.role === 'manager';

  const rows = stockAdjustments;

  const totalLoss = useMemo(
    () => rows.filter((r) => r.delta < 0).reduce((s, r) => s + r.loss_amount, 0),
    [rows]
  );
  const unassigned = useMemo(() => rows.filter((r) => r.delta < 0 && !r.project_id), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter === 'loss' && !(r.delta < 0)) return false;
      if (kindFilter === 'gain' && !(r.delta >= 0)) return false;
      if (kindFilter === 'unassigned' && !(r.delta < 0 && !r.project_id)) return false;
      if (!q) return true;
      const reason = (STOCK_ADJUST_REASON_LABEL[r.reason] || r.reason || '').toLowerCase();
      return (
        r.code.toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        reason.includes(q) ||
        (r.note && r.note.toLowerCase().includes(q)) ||
        (r.project_code && r.project_code.toLowerCase().includes(q)) ||
        (r.project_name && r.project_name.toLowerCase().includes(q)) ||
        (r.adjusted_by_name && r.adjusted_by_name.toLowerCase().includes(q))
      );
    });
  }, [rows, search, kindFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const startAssign = (id: string) => {
    setAssigningId(id);
    setPickProject('');
  };

  const confirmAssign = async (adjustmentId: string) => {
    if (!pickProject) {
      notify('Chọn công trình cần gán trước khi lưu.', 'error');
      return;
    }
    const ok = await assignAdjustProject(adjustmentId, pickProject);
    if (ok) {
      setAssigningId(null);
      setPickProject('');
      notify('Đã gán công trình cho khoản hao hụt (tồn kho không đổi).', 'success');
    }
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    exportToExcel('so-dieu-chinh-ton', [
      {
        name: 'DieuChinhTon',
        rows: rows.map((a) => ({
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

  const handlePrint = () => {
    if (rows.length === 0) {
      notify('Không có dữ liệu để in!', 'error');
      return;
    }
    printTable({
      title: 'Sổ điều chỉnh tồn kho (hao hụt / đếm thừa)',
      meta: [
        `${rows.length} phiếu dòng`,
        `Tổng giá trị hao hụt: ${formatVND(totalLoss)}`,
        `Còn chưa gán công trình: ${unassigned.length} mục`,
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
      rows: rows.slice(0, 1000).map((a) => [
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
      footer: ['Tổng giá trị hao hụt', '', '', '', '', '', '', '', Math.round(totalLoss).toLocaleString('vi-VN'), ''],
    });
  };

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Package className="w-10 h-10 text-slate-300 stroke-1" />
        <p className="text-sm font-medium text-slate-600">Chưa có phiếu điều chỉnh tồn nào</p>
        <p className="text-xs text-slate-400 max-w-sm">
          Khi vật tư hao hụt (vỡ, hết hạn, thất lạc) hoặc đếm tồn thực tế lệch với hệ thống, bấm
          nút <strong>Điều chỉnh tồn</strong> trên thanh công cụ để ghi phiếu. Mọi thay đổi đều có
          thẻ kho + lý do + người thực hiện.
        </p>
      </div>
    );
  }

  const renderAssignCell = (r: (typeof rows)[number], compact = false) => {
    const isLoss = r.delta < 0;
    if (r.project_code) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
          <HardHat className="w-3 h-3" />
          {r.project_code}
        </span>
      );
    }
    if (!isLoss) return <span className="text-[11px] text-slate-400">— (đếm thừa)</span>;
    if (assigningId === r.id) {
      return (
        <div className={`flex items-center gap-1 ${compact ? 'flex-wrap' : ''}`}>
          <div className={compact ? 'w-full' : 'w-40'}>
            <SearchableSelect
              value={pickProject}
              onChange={setPickProject}
              placeholder="Chọn công trình..."
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
              }))}
            />
          </div>
          <button
            onClick={() => confirmAssign(r.id)}
            className="h-7 px-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
          >
            Lưu
          </button>
          <button
            onClick={() => {
              setAssigningId(null);
              setPickProject('');
            }}
            className="h-7 px-1.5 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50"
          >
            Hủy
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="text-[11px] text-amber-800 font-semibold">Chưa gán CT</span>
        {canAssign && (
          <button
            onClick={() => startAssign(r.id)}
            className="text-[10px] text-blue-700 hover:underline font-semibold"
          >
            Gán công trình
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full min-h-0">
      {/* Thanh tìm kiếm — cùng style 2 bảng chính */}
      <div className="p-2.5 border-b border-slate-200 flex flex-wrap items-center gap-2 bg-slate-50">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            id="adjust-search-input"
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm mã phiếu, mặt hàng, SKU, lý do, công trình, người làm..."
            className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-500 focus:outline-hidden"
          />
        </div>
        <FilterSelect
          value={kindFilter}
          onChange={(v) => {
            setKindFilter(v as typeof kindFilter);
            setPage(1);
          }}
          title="Lọc loại phiếu"
          options={[
            { value: 'all', label: 'Tất cả phiếu' },
            { value: 'loss', label: 'Hao hụt / Giảm tồn' },
            { value: 'gain', label: 'Đếm thừa / Tăng tồn' },
            { value: 'unassigned', label: 'Chưa gán công trình' },
          ]}
        />
        <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
      </div>

      {/* Dòng tổng hợp riêng — số mục chưa gán công trình nằm ở đây, không nằm trên nhãn tab */}
      <div className="px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600">
        <span>
          Tìm thấy <strong className="text-slate-900 font-mono">{filtered.length}</strong> phiếu dòng
        </span>
        <span>
          Tổng giá trị hao hụt:{' '}
          <strong className="font-mono text-rose-700 font-bold">{formatVND(totalLoss)}</strong>
          {' · '}
          <strong className="text-slate-900 font-mono">{unassigned.length}</strong> mục chưa gán công trình
        </span>
      </div>

      {/* Danh sách gọn trên mobile — bảng ngang chỉ dành cho desktop */}
      <div className="lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
        {paginated.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">
            Không tìm thấy phiếu điều chỉnh nào phù hợp với bộ lọc.
          </p>
        ) : (
          paginated.map((r) => {
            const isLoss = r.delta < 0;
            return (
              <div key={r.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 leading-snug truncate">{r.product_name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {r.code} · {new Date(r.created_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-mono font-bold ${isLoss ? 'text-rose-700' : 'text-emerald-700'}`}
                  >
                    {r.delta > 0 ? '+' : ''}
                    {formatQty(r.delta, true)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                  <span>
                    {STOCK_ADJUST_REASON_LABEL[r.reason] || r.reason} · {r.adjusted_by_name || '—'}
                  </span>
                  {r.loss_amount > 0 ? (
                    <span className="font-mono font-bold text-rose-700">{formatVND(r.loss_amount)}</span>
                  ) : (
                    <span className="font-mono">—</span>
                  )}
                </div>
                <div className="mt-1">{renderAssignCell(r, true)}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
              <th className="py-2.5 px-3 text-left">Phiếu / Thời điểm</th>
              <th className="py-2.5 px-3 text-left">Mặt hàng</th>
              <th className="py-2.5 px-3 text-right">Tồn trước</th>
              <th className="py-2.5 px-3 text-right">Chênh lệch</th>
              <th className="py-2.5 px-3 text-right">Tồn sau</th>
              <th className="py-2.5 px-3 text-left">Lý do</th>
              <th className="py-2.5 px-3 text-right">Giá trị hao hụt</th>
              <th className="py-2.5 px-3 text-left">Gắn công trình</th>
              <th className="py-2.5 px-3 text-left">Người làm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  Không tìm thấy phiếu điều chỉnh nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              paginated.map((r) => {
                const isLoss = r.delta < 0;
                return (
                  <tr key={r.id} className={isLoss ? 'hover:bg-rose-50/50' : 'hover:bg-emerald-50/50'}>
                    <td className="py-2.5 px-3">
                      <div className="font-mono text-[11px] text-slate-700">{r.code}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(r.created_at).toLocaleString('vi-VN')}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-800 truncate max-w-[200px]">{r.product_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{r.sku}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatQty(r.previous_stock, true)}</td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-bold ${
                        isLoss ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {r.delta > 0 ? '+' : ''}
                      {formatQty(r.delta, true)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                      {formatQty(r.previous_stock + r.delta, true)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-700">{STOCK_ADJUST_REASON_LABEL[r.reason] || r.reason}</div>
                      {r.note && <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{r.note}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-rose-700">
                      {r.loss_amount > 0 ? formatVND(r.loss_amount) : '—'}
                    </td>
                    <td className="py-2.5 px-3">{renderAssignCell(r)}</td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-600">{r.adjusted_by_name || '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        currentPage={page}
        totalItems={filtered.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        itemName="phiếu dòng"
      />
    </div>
  );
}
