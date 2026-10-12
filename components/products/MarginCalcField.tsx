// Máy tính cộng % trên vốn nhập — dùng chung cho form Thêm + Sửa hàng hóa.
// Bố cục: Giá vốn nhập -> Cộng % -> Giá bán (3 ô trên 1 hàng); gợi ý gọn 1 dòng
// lãi/biên suy từ giá hiện tại (sửa giá tay thì dòng này cập nhật theo).
// - Ô % là tác vụ một chiều: nhập % -> tính giá, gọi onPriceChange, xóa ô.
// - Không làm tròn nghìn: giá = tròn từng đồng (hàng nhạy giá như dây điện).
'use client';

import React, { useState } from 'react';
import { NumberInput } from '@/components/common/NumberInput';
import { formatVND } from '@/lib/format';
import { lineMargin, priceFromMarkup } from '@/lib/costing';

// Chênh tuyệt đối 2 biên (điểm %) từ ngưỡng này thì cảnh báo lô nhập bất thường.
export const MARGIN_DIVERGE_WARN_PP = 20;

interface MarkupPctInputProps {
  /** Giá vốn nhập (gần nhất) — gốc tính cộng %. */
  cost: number | '';
  /** Gọi khi user nhập % -> giá mới đã tính. */
  onPriceChange: (price: number) => void;
}

// Ô nhập % (cột giữa hàng giá). Chưa có vốn thì khóa (không ẩn) để user vẫn
// thấy tính năng và biết phải nhập vốn trước.
export function MarkupPctInput({ cost, onPriceChange }: MarkupPctInputProps) {
  const [markup, setMarkup] = useState<number | ''>('');
  const c = Number(cost) || 0;

  const handleMarkup = (val: number) => {
    setMarkup(val);
    if (c > 0 && val !== 0) {
      onPriceChange(priceFromMarkup(c, val));
      setMarkup('');
    }
  };

  return (
    <div>
      <label className="font-semibold text-slate-700 block mb-1">Cộng (%)</label>
      <NumberInput
        value={markup}
        onChange={handleMarkup}
        allowDecimals
        maxDecimals={2}
        placeholder={c > 0 ? 'Vd: 30' : 'Nhập vốn trước'}
        suffix="%"
        disabled={c <= 0}
        title={c > 0 ? 'Nhập % để tính giá bán từ vốn' : 'Nhập giá vốn nhập trước rồi mới cộng %'}
        className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono bg-white focus:border-blue-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
      />
    </div>
  );
}

interface MarginHintProps {
  /** Giá vốn nhập (gần nhất). */
  cost: number | '';
  /** Giá bán hiện tại trong form. */
  price: number | '';
  /** Vốn BQ thực (form sửa) — dòng tham chiếu, không dùng để tính giá. */
  avgCost?: number;
}

// Dòng gợi ý gọn dưới hàng giá: lãi + biên (+ biên BQ ở form sửa).
export function MarginHint({ cost, price, avgCost }: MarginHintProps) {
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  if (c <= 0 || p <= 0) return null;

  const margin = lineMargin(p, c);
  const hasAvgRef = avgCost !== undefined && (Number(avgCost) || 0) > 0;
  const marginAvg = hasAvgRef ? lineMargin(p, Number(avgCost)) : null;
  const diverge =
    marginAvg !== null && Math.abs(margin.pct - marginAvg.pct) >= MARGIN_DIVERGE_WARN_PP;

  return (
    <div className="text-[11px] text-slate-500">
      <span>
        Lãi <strong className="font-mono text-emerald-700">{formatVND(margin.amount)}</strong>
        {' '}• Biên <strong className="font-mono text-slate-700">{margin.pct.toFixed(1)}%</strong>
      </span>
      {marginAvg !== null && (
        <span>
          {' '}• Vốn BQ: <strong className="font-mono text-slate-700">{marginAvg.pct.toFixed(1)}%</strong>
          {diverge && (
            <span className="font-semibold text-amber-700"> — lệch xa, kiểm tra lô nhập / tồn cũ.</span>
          )}
        </span>
      )}
    </div>
  );
}
