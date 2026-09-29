// 0064 — Modal điều chỉnh tồn kho (hao hụt / đếm thừa).
//
// Vì sao có: vật tư tồn lâu ngày hao mòn nhưng trước 0064 app không có đường nào sửa
// tồn có kiểm soát. Hai cách nhập (anh đã chốt chọn cả hai):
//   1) "Dán tồn thực" — anh đếm thực tế rồi dán (từ bảng tính/điện thoại chụp), hệ thống
//      tự chấn lệch toàn bộ mặt hàng trong danh sách.
//   2) "Điều chỉnh lẻ" — sửa từng mặt hàng ngay trên bảng tồn.
// Cả hai đều quy về cùng một lệnh: số thực tế HOẶC chênh lệch.
//
// Nguyên tắc đã chốt: lý do BẮT BUỘC (không có lý do thì không ai truy được về sau),
// và công trình là TÙY CHỌN — mặc định "Kho (chưa gán công trình)".
'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { notify } from '@/components/common/Toast';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { formatVND } from '@/lib/format';
import { formatQty, parseQtyInput } from '@/lib/quantity';
import { AlertTriangle, CheckCircle2, HardHat, Package, Scale, X } from 'lucide-react';
import {
  STOCK_ADJUST_REASON_LABEL,
  type Product,
  type StockAdjustReason,
} from '@/lib/types';

type Mode = 'count' | 'edit';

/** Ô nhập tồn thực: giữ chuỗi đang gõ để "1." không bị rơi về 0. */
function CountedInput({
  value,
  onChange,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  id: string;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      className="w-full h-8 px-2 text-right font-mono text-sm font-semibold tabular-nums text-blue-600 bg-transparent border-0 focus:outline-hidden focus:text-blue-950 hover:text-blue-900 transition-colors"
    />
  );
}

/** parseQtyInput trả 0 cho chuỗi rác — dùng cho ô tồn thực sẽ thành "mất sạch kho". */
const isCountedValid = (raw: string): boolean => {
  if (raw.trim() === '') return false;
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return false;
  return Number.isFinite(parseQtyInput(raw));
};

export function StockAdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { products, projects, adjustStock, profile } = useStore();
  const [mode, setMode] = useState<Mode>('count');
  const [reason, setReason] = useState<StockAdjustReason>('damage');
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  /** tồn thực nhập theo productId (mode 'count') */
  const [counted, setCounted] = useState<Record<string, string>>({});
  /** chênh lệch nhập theo productId (mode 'edit') */
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const canAdjust = !profile || profile.role === 'admin' || profile.role === 'manager';

  // Mở modal -> dựng sẵn tồn thực = tồn hệ thống (anh chỉ sửa mặt hàng lệch, không gõ lại cả bảng).
  // Dùng pattern "adjust state during render" của repo (HRMView) thay vì setState trong effect
  // (react-hooks/set-state-in-effect).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      const seeded: Record<string, string> = {};
      for (const p of products) {
        if (p.product_type === 'service' || p.product_type === 'combo') continue;
        seeded[p.id] = formatQty(p.stock_quantity, true);
      }
      setCounted(seeded);
      setDeltas({});
      setSearch('');
      setNote('');
      setProjectId('');
      setReason('damage');
      setMode('count');
    }
  }

  // Danh sách mặt hàng có tồn thực tế (bỏ dịch vụ/combo — không có tồn để đếm).
  const stockable = useMemo(
    () => products.filter((p) => p.product_type !== 'service' && p.product_type !== 'combo'),
    [products]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? stockable.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q))
      : stockable;
    return base.slice(0, 200);
  }, [stockable, search]);

  /** Chênh lệch đang chờ ghi: âm = mất hàng, dương = đếm thừa. */
  const pending = useMemo(() => {
    const list: { product: Product; delta: number }[] = [];
    for (const p of visible) {
      if (mode === 'count') {
        const raw = counted[p.id];
        if (raw === undefined) continue;
        // Ô đang gõ dở ("", "1.", "-") thì BỎ QUA chứ không coi là 0 — nếu coi 0 thì
        // lúc đang gõ sẽ hiện "mất toàn bộ tồn" và tạo cảm giác sai.
        if (!isCountedValid(raw)) continue;
        const v = parseQtyInput(raw);
        const d = Math.round((v - p.stock_quantity) * 1000) / 1000;
        if (d !== 0) list.push({ product: p, delta: d });
      } else {
        const raw = deltas[p.id];
        if (!raw) continue;
        if (!isCountedValid(raw)) continue;
        const v = parseQtyInput(raw);
        if (v === 0) continue;
        list.push({ product: p, delta: v });
      }
    }
    return list;
  }, [visible, counted, deltas, mode]);

  /** Ô đang gõ dở nhưng không hợp lệ -> báo để anh không tưởng là đã nhập xong. */
  const invalidInputs = useMemo(() => {
    const bad: string[] = [];
    const source = mode === 'count' ? counted : deltas;
    for (const p of visible) {
      const raw = source[p.id];
      if (raw === undefined || raw.trim() === '') continue;
      if (!isCountedValid(raw)) bad.push(p.sku);
    }
    return bad;
  }, [visible, counted, deltas, mode]);

  const lossItems = pending.filter((x) => x.delta < 0);
  const gainItems = pending.filter((x) => x.delta > 0);
  const lossValue = lossItems.reduce((s, x) => s + Math.abs(x.delta) * (x.product.avg_cost || 0), 0);
  const selectedProject = projects.find((p) => p.id === projectId);

  const reset = () => {
    setCounted({});
    setDeltas({});
    setNote('');
    setSearch('');
  };

  const handleSubmit = async () => {
    if (!canAdjust) {
      notify('Chỉ Admin/Quản lý được điều chỉnh tồn kho!', 'error');
      return;
    }
    if (pending.length === 0) {
      notify('Chưa có mặt hàng nào chênh lệch so với tồn hệ thống.', 'info');
      return;
    }
    if (invalidInputs.length > 0) {
      notify(
        `Còn ${invalidInputs.length} ô nhập chưa hợp lệ (${invalidInputs.slice(0, 3).join(', ')}${invalidInputs.length > 3 ? '…' : ''}). Ô đó chưa được tính vào phiếu.`,
        'error'
      );
      return;
    }
    setBusy(true);
    try {
      const lines =
        mode === 'count'
          ? pending.map((x) => ({ productId: x.product.id, countedStock: parseQtyInput(counted[x.product.id] || '0') }))
          : pending.map((x) => ({ productId: x.product.id, delta: x.delta }));
      const res = await adjustStock(lines, reason, { note: note.trim() || undefined, projectId: projectId || null });
      if (res) {
        notify(
          `Đã điều chỉnh ${res.adjusted} mặt hàng (phiếu ${res.code}).` +
            (res.lossAmount > 0
              ? ` Giá trị hao hụt: ${formatVND(res.lossAmount)}` +
                (selectedProject
                  ? ` — ghi vào chi phí vật tư công trình ${selectedProject.code}.`
                  : ' — ghi vào hao hụt tồn kho (chưa gán công trình).')
              : ''),
          'success'
        );
        reset();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Điều chỉnh tồn kho"
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Scale className="w-4 h-4 text-amber-400" />
            <span>Điều chỉnh tồn kho (hao hụt / đếm thừa)</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 sm:p-4 space-y-3 overflow-y-auto min-h-0">
          {!canAdjust && (
            <div className="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>Tài khoản của anh chỉ xem được, không điều chỉnh được tồn. Chức năng này dành cho Admin/Quản lý.</span>
            </div>
          )}

          {/* Hai cách nhập — anh đã chốt dùng cả hai */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg self-start">
            <button
              type="button"
              id="btn-adjust-mode-count"
              onClick={() => setMode('count')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'count' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Package className="w-3.5 h-3.5" /> Dán tồn thực tế
            </button>
            <button
              type="button"
              id="btn-adjust-mode-edit"
              onClick={() => setMode('edit')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'edit' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Scale className="w-3.5 h-3.5" /> Điều chỉnh lẻ từng hàng
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            {mode === 'count'
              ? 'Nhập/ dán tồn thực tế đếm được. Hệ thống tự chấn lệch — dòng nào khớp tồn hệ thống sẽ không ghi.'
              : 'Nhập số hao hụt (âm, ví dụ -3) hoặc số đếm thừa (dương, ví dụ 2) cho từng mặt hàng.'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="adjust-reason" className="block text-[11px] font-semibold text-slate-700 mb-1">
                Lý do điều chỉnh <span className="text-rose-500">*</span>
              </label>
              <select
                id="adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as StockAdjustReason)}
                className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:border-amber-500 focus:outline-hidden text-slate-800"
              >
                {Object.entries(STOCK_ADJUST_REASON_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div id="adjust-project-select">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Gắn công trình <span className="font-normal text-slate-400">(tùy chọn)</span>
              </label>
              <SearchableSelect
                value={projectId}
                onChange={setProjectId}
                placeholder="Kho (chưa gán công trình)"
                options={[
                  { value: '', label: 'Kho (chưa gán công trình)', sub: 'Hao hụt tính vào kho, không vào P&L công trình' },
                  ...projects.map((p) => ({
                    value: p.id,
                    label: `${p.code} — ${p.name}`,
                    sub: 'Ghi vào chi phí vật tư của công trình',
                  })),
                ]}
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <HardHat className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
            {selectedProject
              ? `Hao hụt sẽ ghi vào chi phí vật tư của ${selectedProject.code} — lợi nhuận công trình giảm tương ứng. Tồn kho vẫn chỉ trừ đúng một lần.`
              : 'Để trống nghĩa là hao hụt tồn kho chung. Nếu sau đó biết thuộc công trình nào, mở tab "Nhật ký điều chỉnh" để gán bổ sung (không trừ tồn thêm).'}
          </p>

          <div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Lọc theo tên / SKU / mã vạch..."
              className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden text-slate-800"
            />
          </div>

          <div className="border border-slate-200 rounded-lg overflow-auto max-h-[38vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr>
                  <th className="py-2 px-2.5 text-left">Mặt hàng</th>
                  <th className="py-2 px-2.5 w-24 text-right">Tồn hệ thống</th>
                  <th className="py-2 px-2.5 w-28 text-center">
                    {mode === 'count' ? 'Tồn thực tế' : 'Hao hụt / Thừa'}
                  </th>
                  <th className="py-2 px-2.5 w-24 text-right">Chênh lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((p) => {
                  const sysStock = p.stock_quantity;
                  const raw = mode === 'count' ? counted[p.id] : deltas[p.id];
                  const touched = raw !== undefined && raw.trim() !== '';
                  const bad = touched && !isCountedValid(raw);
                  // Chỉ tính chênh lệch khi ô hợp lệ, nếu không sẽ hiện "mất sạch kho" khi đang gõ.
                  let delta = 0;
                  if (!bad && touched) {
                    const v = parseQtyInput(raw);
                    delta = mode === 'count'
                      ? Math.round((v - sysStock) * 1000) / 1000
                      : v;
                  }
                  return (
                    <tr key={p.id} className={bad ? 'bg-rose-50' : delta !== 0 ? (delta < 0 ? 'bg-rose-50/60' : 'bg-emerald-50/60') : 'hover:bg-slate-50'}>
                      <td className="py-1.5 px-2.5">
                        <div className="font-semibold text-slate-800 truncate max-w-[240px]">{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {p.sku} · giá vốn {formatVND(p.avg_cost)}/{p.unit}
                        </div>
                      </td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{formatQty(sysStock, true)}</td>
                      <td className="py-1.5 px-1.5">
                        {mode === 'count' ? (
                          <CountedInput
                            id={`adjust-count-${p.sku}`}
                            ariaLabel={`Tồn thực tế ${p.name}`}
                            value={counted[p.id] ?? ''}
                            onChange={(v) => setCounted((prev) => ({ ...prev, [p.id]: v }))}
                          />
                        ) : (
                          <input
                            id={`adjust-delta-${p.sku}`}
                            type="text"
                            inputMode="decimal"
                            value={deltas[p.id] ?? ''}
                            aria-label={`Chênh lệch ${p.name}`}
                            placeholder="0"
                            onChange={(e) => setDeltas((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-full h-8 px-2 text-right font-mono text-sm font-semibold tabular-nums text-blue-600 bg-transparent border-0 focus:outline-hidden focus:text-blue-950 hover:text-blue-900 transition-colors placeholder:text-slate-300"
                          />
                        )}
                      </td>
                      <td
                        className={`py-1.5 px-2.5 text-right font-mono font-semibold ${
                          bad ? 'text-rose-600' : delta < 0 ? 'text-rose-700' : delta > 0 ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {bad ? 'số không hợp lệ' : delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${formatQty(delta, true)}`}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      Không có mặt hàng nào khớp từ khoá tìm.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <label htmlFor="adjust-note" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Ghi chú
            </label>
            <input
              id="adjust-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: đếm cuối tháng 9, vỡ 2 thùng sơn khi vận chuyển"
              className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden text-slate-800"
            />
          </div>
        </div>

        {/* Chân: tóm tắt phiếu — luôn hiện để anh thấy hệ quả tiền trước khi bấm Ghi */}
        <div className="border-t border-slate-200 bg-slate-50 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <strong className="font-mono text-slate-800">{pending.length}</strong> mặt hàng chênh lệch
            </span>
            {lossItems.length > 0 && (
              <span className="text-rose-700">
                mất <strong className="font-mono">{lossItems.length}</strong> ({formatVND(lossValue)})
              </span>
            )}
            {gainItems.length > 0 && (
              <span className="text-emerald-700">
                thừa <strong className="font-mono">{gainItems.length}</strong>
              </span>
            )}
            {pending.length > 0 && (
              <span className="text-slate-400">không ghi vào sổ quỹ (tiền đã trả lúc nhập kho)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Xoá dòng nhập
            </button>
            <button
              type="button"
              id="btn-adjust-submit"
              onClick={handleSubmit}
              disabled={busy || pending.length === 0 || !canAdjust}
              className="h-8 px-3.5 text-xs font-bold rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {busy ? 'Đang ghi...' : `Ghi điều chỉnh (${pending.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
