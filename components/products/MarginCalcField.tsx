// Máy tính cộng % trên vốn nhập — dùng chung cho form Thêm + Sửa hàng hóa.
// - Ô % là tác vụ một chiều: nhập % -> tính giá bán, gọi onPriceChange.
// - Dòng gợi ý suy từ props (vốn, giá hiện tại) nên sửa giá tay ở form thì
//   %/biên hiển thị lại đúng mà không cần đồng bộ state 2 chiều.
// - Không làm tròn nghìn: giá = tròn từng đồng (hàng nhạy giá như dây điện).
'use client';

import React, { useState } from 'react';
import { NumberInput } from '@/components/common/NumberInput';
import { formatVND } from '@/lib/format';
import { lineMargin, markupFromPrice, priceFromMarkup } from '@/lib/costing';

// Chênh tuyệt đối 2 biên (điểm %) từ ngưỡng này thì cảnh báo lô nhập bất thường.
export const MARGIN_DIVERGE_WARN_PP = 20;

interface MarginCalcFieldProps {
  /** Giá vốn nhập (gần nhất) — gốc tính cộng %. */
  cost: number | '';
  /** Giá bán hiện tại trong form (để suy %/biên hiển thị). */
  price: number | '';
  /** Vốn BQ thực (form sửa) — dòng tham chiếu, không dùng để tính giá. */
  avgCost?: number;
  /** Gọi khi user nhập % -> giá mới đã tính. */
  onPriceChange: (price: number) => void;
}

export function MarginCalcField({ cost, price, avgCost, onPriceChange }: MarginCalcFieldProps) {
  const [markup, setMarkup] = useState<number | ''>('');
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  const a = avgCost !== undefined ? Number(avgCost) || 0 : 0;
  const hasAvgRef = avgCost !== undefined;

  // Vốn = 0 thì % vô nghĩa (dịch vụ/combo/hàng chưa nhập) — ẩn cả cụm.
  if (c <= 0 && a <= 0) return null;

  const handleMarkup = (val: number) => {
    setMarkup(val);
    if (c > 0 && val !== 0) {
      onPriceChange(priceFromMarkup(c, val));
    }
  };

  const shownMarkup = markupFromPrice(c, p);
  const margin = lineMargin(p, c);
  const marginAvg = hasAvgRef && a > 0 ? lineMargin(p, a) : null;
  const diverge =
    marginAvg !== null && Math.abs(margin.pct - marginAvg.pct) >= MARGIN_DIVERGE_WARN_PP;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center gap-2">
        <label className="font-semibold text-slate-700 whitespace-nowrap">Cộng % trên vốn nhập</label>
        <NumberInput
          value={markup}
          onChange={handleMarkup}
          allowDecimals
          maxDecimals={2}
          placeholder="Vd: 30"
          suffix="%"
          className="w-28 h-8 px-2.5 border border-slate-300 rounded font-mono bg-white focus:border-blue-500 focus:outline-hidden"
        />
        <span className="text-[11px] text-slate-500">
          {c > 0 ? (
            <>
              Đã cộng <strong className="text-slate-800 font-mono">{shownMarkup.toFixed(1)}%</strong>
              {' '}• Biên trên giá bán <strong className="text-slate-800 font-mono">{margin.pct.toFixed(1)}%</strong>
              {' '}• Lãi <strong className="text-emerald-700 font-mono">{formatVND(margin.amount)}</strong>
            </>
          ) : (
            'Chưa có vốn nhập nên không tính được %'
          )}
        </span>
      </div>
      {marginAvg !== null && (
        <p className="mt-1 text-[11px] text-slate-500">
          Biên trên vốn BQ hiện tại: <strong className="font-mono text-slate-700">{marginAvg.pct.toFixed(1)}%</strong>
          {diverge && (
            <span className="ml-1 font-semibold text-amber-700">
              — lệch xa biên trên giá nhập mới, kiểm tra lô nhập bất thường / tồn cũ giá rẻ.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
