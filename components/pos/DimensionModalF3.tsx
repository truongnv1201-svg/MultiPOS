'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { DimensionDetail, OrderItem } from '@/lib/types';
import { HOLE_PRICE, CORNER_PRICE } from '@/lib/mock-data';
import { formatVND, formatNumber, handleMoneyInputChange } from '@/lib/format';
import { calculateDimensionRow } from '@/lib/db';
import { Plus, Trash2, Settings2, RefreshCw, X, Check, HelpCircle } from 'lucide-react';

interface DialogProps {
  item: OrderItem;
  isNew: boolean;
  onClose: () => void;
}

function DimensionModalDialog({ item, isNew, onClose }: DialogProps) {
  const { updateCartItem, addItemToCart, products, grindingServices } = useStore();

  const grindingLabel = (id: string) => {
    const g = grindingServices.find((x) => x.id === id);
    if (!g) return id;
    return g.price_per_md > 0 ? `${g.label} (${formatNumber(g.price_per_md)} đ/md)` : g.label;
  };

  const [batchGrindingType, setBatchGrindingType] = useState<string>('none');
  const [rows, setRows] = useState<DimensionDetail[]>(() => {
    if (item.dimension_details && item.dimension_details.length > 0) {
      return item.dimension_details;
    }
    // Dòng trắng (không seed số mẫu): user tự nhập, ô đầu tự focus + bôi đen
    const initialRow = calculateDimensionRow({
      id: `dim-${Date.now()}`,
      length: 0,
      width: 0,
      quantity: item.quantity > 0 ? item.quantity : 1,
      grinding_type: 'none',
      grinding_unit_price: 0,
      holes: 0,
      hole_unit_price: HOLE_PRICE,
      corners: 0,
      corner_unit_price: CORNER_PRICE,
      extra_fee: 0,
    });
    return [initialRow];
  });

  // Enter nhảy ô: Dài -> Rộng -> SL -> Phụ phí -> dòng tiếp theo;
  // ô cuối của dòng cuối thì thêm dòng mới & focus ô đầu dòng mới
  const handleCellEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const target = e.target as HTMLInputElement;
    const cells = Array.from(
      document.querySelectorAll('#dimension-modal-container tbody input[data-dim-col]') || []
    ) as HTMLInputElement[];
    const i = cells.indexOf(target);
    if (i >= 0 && i < cells.length - 1) {
      cells[i + 1].focus();
      return;
    }
    handleAddRow();
    setTimeout(() => {
      (
        document.querySelector(
          '#dimension-modal-container tbody tr:last-child input[data-dim-col="length"]'
        ) as HTMLElement | null
      )?.focus();
    }, 60);
  };

  const product =
    products.find((p) => p.id === item.product_id) ||
    products.find((p) => p.sku === item.sku); // fallback SKU khi catalog server refresh đổi id (uuid)
  const wasteFactor = item.waste_factor ?? product?.waste_factor ?? 5;
  const unitPrice = item.unit_price;

  // Text thô khi đang gõ số lẻ (gõ "1." giữ nguyên dấu chấm tới khi thành "1.5");
  // totals dùng số parse được, blur/Enter thì chốt về số
  const [editCell, setEditCell] = useState<{ id: string; col: string; text: string } | null>(null);
  const cellText = (rowId: string, col: string, formatted: string | number) =>
    editCell && editCell.id === rowId && editCell.col === col ? editCell.text : formatted;

  const handleDecimalText = (row: DimensionDetail, col: 'length' | 'width', raw: string) => {
    setEditCell({ id: row.id, col, text: raw });
    const v = parseFloat(raw.replace(',', '.'));
    handleUpdateRow(row.id, col, isNaN(v) ? 0 : v);
  };

  const commitEditCell = (rowId: string, col: string) =>
    setEditCell((cur) => (cur && cur.id === rowId && cur.col === col ? null : cur));
  // Công mài = chu vi × đơn giá mài; Phụ phí = phần còn lại (nhập tay, tương thích legacy lỗ/góc)
  const grindingFeeOf = (r: DimensionDetail) => Math.round(r.perimeter_md * (r.grinding_unit_price || 0));
  const extraFeeOf = (r: DimensionDetail) => Math.max(0, r.processing_fee - grindingFeeOf(r));

  // Row update helper
  const handleUpdateRow = (id: string, field: keyof DimensionDetail, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === 'grinding_type') {
          // Per-row select đã bỏ (giá mài chọn chung ở toolbar); giữ nhánh cho dữ liệu cũ
          const g = grindingServices.find((x) => x.id === value);
          updated.grinding_unit_price = g?.price_per_md || 0;
        }
        return calculateDimensionRow(updated);
      })
    );
  };

  // Phụ phí nhập tay: chốt thành extra_fee (xóa legacy lỗ/góc của dòng đó)
  const handleExtraFeeChange = (id: string, value: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return calculateDimensionRow({ ...r, extra_fee: Math.max(0, value), holes: 0, corners: 0 });
      })
    );
  };

  // Add new row with Auto-Inheritance (SRS 4.5.2): kích thước + loại mài + phụ phí kế thừa dòng trên
  const handleAddRow = () => {
    const lastRow = rows[rows.length - 1];
    const newGrindingType = lastRow?.grinding_type || 'none';
    const newGrindingPrice = lastRow?.grinding_unit_price ?? 0;

    const newRow = calculateDimensionRow({
      id: `dim-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      length: lastRow?.length || 0,
      width: lastRow?.width || 0,
      quantity: 1,
      grinding_type: newGrindingType,
      grinding_unit_price: newGrindingPrice,
      holes: 0,
      hole_unit_price: HOLE_PRICE,
      corners: 0,
      corner_unit_price: CORNER_PRICE,
      extra_fee: lastRow ? extraFeeOf(lastRow) : 0,
    });

    setRows((prev) => [...prev, newRow]);
  };

  // Remove row
  const handleRemoveRow = (id: string) => {
    if (rows.length <= 1) {
      alert('Đơn hàng m² bắt buộc có ít nhất 1 dòng quy cách!');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Batch Sync Grinding to all rows (SRS 4.5.1)
  const handleBatchSync = () => {
    const g = grindingServices.find((x) => x.id === batchGrindingType);
    const price = g?.price_per_md || 0;
    setRows((prev) =>
      prev.map((r) =>
        calculateDimensionRow({
          ...r,
          grinding_type: batchGrindingType,
          grinding_unit_price: price,
        })
      )
    );
  };

  // Summary calculations
  const totalActualM2 = Math.round(rows.reduce((sum, r) => sum + r.actual_m2, 0) * 1000) / 1000;
  const totalPerimeterMd = Math.round(rows.reduce((sum, r) => sum + r.perimeter_md, 0) * 100) / 100;
  const totalProcessingFee = rows.reduce((sum, r) => sum + r.processing_fee, 0);
  const totalGlassSubtotal = Math.round(totalActualM2 * unitPrice);
  const totalAmount = totalGlassSubtotal + totalProcessingFee;
  const totalWasteM2 = Math.round(totalActualM2 * (1 + wasteFactor / 100) * 1000) / 1000;

  // Save to Cart
  const handleSave = useCallback(() => {
    if (rows.length === 0) return;

    // Chặn dòng thiếu kích thước (ô đang để trống/0)
    const badIdx = rows.findIndex((r) => !(r.length > 0 && r.width > 0 && r.quantity > 0));
    if (badIdx >= 0) {
      alert(`Dòng ${badIdx + 1} chưa đủ kích thước! Dài, Rộng và Số tấm phải lớn hơn 0.`);
      return;
    }

    if (isNew) {
      if (product) {
        addItemToCart(product, totalActualM2, rows);
      }
    } else {
      updateCartItem(item.id, {
        quantity: totalActualM2,
        dimension_details: rows,
        processing_fee: totalProcessingFee,
        waste_factor: wasteFactor,
        material_consumed: totalWasteM2,
        subtotal: totalAmount - item.discount_amount,
      });
    }

    onClose();
  }, [rows, isNew, product, addItemToCart, updateCartItem, item, totalActualM2, totalProcessingFee, wasteFactor, totalWasteM2, totalAmount, onClose]);

  // Keyboard shortcut listener for Modal (Ctrl+Enter to save, Esc to cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, onClose]);

  return (
    <div
      id="dimension-modal-overlay"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div
        id="dimension-modal-container"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-amber-400 text-slate-900 rounded">
              F3
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>CHI TIẾT KÍCH THƯỚC & DIỆN TÍCH (F3)</span>
                <span className="text-amber-400 font-normal">— {item.name}</span>
              </h2>
              <div className="text-[11px] text-slate-300 flex items-center gap-3">
                <span>Đơn giá phôi: {formatVND(unitPrice)}/m²</span>
                <span>•</span>
                <span>Hệ số hao hụt phôi (Waste factor): <strong className="text-amber-300">{wasteFactor}%</strong></span>
              </div>
            </div>
          </div>
          <button
            id="btn-close-dimension-modal"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Batch Grinding Type Sync (SRS 4.5.1) */}
        <div
          id="dimension-toolbar-batch"
          className="px-5 py-2.5 bg-amber-50/80 border-b border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-amber-700" />
            <span className="font-semibold text-amber-900">
              Đơn giá công mài:
            </span>
            <select
              id="batch-grinding-select"
              value={batchGrindingType}
              onChange={(e) => setBatchGrindingType(e.target.value)}
              className="h-8 px-2.5 bg-white border border-amber-300 rounded-md text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            >
              {grindingServices.map((g) => (
                <option key={g.id} value={g.id}>
                  {grindingLabel(g.id)}
                </option>
              ))}
            </select>
            <button
              id="btn-sync-all-rows"
              onClick={handleBatchSync}
              type="button"
              className="h-8 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium text-xs flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Áp dụng</span>
            </button>
          </div>

          <div className="text-[11px] text-amber-800 italic flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Phím Enter tại dòng cuối tự động thêm dòng mới & kế thừa loại mài</span>
          </div>
        </div>

        {/* Dimension Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <th className="py-2 px-2 w-10 text-center">STT</th>
                <th className="py-2 px-2 w-24">Dài (m)</th>
                <th className="py-2 px-2 w-24">Rộng (m)</th>
                <th className="py-2 px-2 w-16 text-center">Số tấm</th>
                <th className="py-2 px-2 w-28 text-right">Phụ phí (đ)</th>
                <th className="py-2 px-2 w-24 text-right">Chu vi (md)</th>
                <th className="py-2 px-2 w-24 text-right">Công mài (đ)</th>
                <th className="py-2 px-2 w-24 text-right">Phí GC (đ)</th>
                <th className="py-2 px-2 w-24 text-right">Diện tích (m²)</th>
                <th className="py-2 px-2 w-10 text-center">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => {
                return (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-2 text-center text-slate-500 font-mono">
                      {index + 1}
                    </td>

                    {/* Dài (m) — text + bôi đen khi focus để gõ đè; cho phép xóa trắng */}
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        data-dim-col="length"
                        autoFocus={index === 0}
                        value={cellText(row.id, 'length', row.length || '')}
                        onChange={(e) => handleDecimalText(row, 'length', e.target.value)}
                        onFocus={(e) => {
                          commitEditCell(row.id, 'length');
                          e.target.select();
                        }}
                        onBlur={() => commitEditCell(row.id, 'length')}
                        onKeyDown={handleCellEnter}
                        placeholder="0"
                        className="w-full h-8 px-2 text-right font-mono bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                      />
                    </td>

                    {/* Rộng (m) */}
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        data-dim-col="width"
                        value={cellText(row.id, 'width', row.width || '')}
                        onChange={(e) => handleDecimalText(row, 'width', e.target.value)}
                        onFocus={(e) => {
                          commitEditCell(row.id, 'width');
                          e.target.select();
                        }}
                        onBlur={() => commitEditCell(row.id, 'width')}
                        onKeyDown={handleCellEnter}
                        placeholder="0"
                        className="w-full h-8 px-2 text-right font-mono bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                      />
                    </td>

                    {/* Số tấm (SL) */}
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        data-dim-col="quantity"
                        value={row.quantity || ''}
                        onChange={(e) => {
                          const v = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                          handleUpdateRow(row.id, 'quantity', isNaN(v) ? 0 : v);
                        }}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={handleCellEnter}
                        placeholder="1"
                        className="w-full h-8 px-1.5 text-center font-bold bg-white border border-slate-300 rounded text-blue-700 focus:border-blue-500 focus:outline-hidden"
                      />
                    </td>

                    {/* Phụ phí nhập tay mỗi dòng */}
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        data-dim-col="extra"
                        value={extraFeeOf(row) ? new Intl.NumberFormat('vi-VN').format(extraFeeOf(row)) : ''}
                        onChange={(e) => {
                          handleMoneyInputChange(e, (num) => handleExtraFeeChange(row.id, num));
                        }}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={handleCellEnter}
                        placeholder="0"
                        className="w-full h-8 px-2 text-right font-mono bg-white border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
                        title="Phụ phí thêm mỗi dòng (khoét lỗ, bo góc đặc biệt...)"
                      />
                    </td>

                    {/* Chu vi */}
                    <td className="py-2 px-2 text-right font-mono text-slate-600">
                      {row.perimeter_md.toFixed(1)}
                    </td>

                    {/* Công mài = chu vi × đơn giá mài */}
                    <td className="py-2 px-2 text-right font-mono text-slate-700">
                      {formatNumber(grindingFeeOf(row))}
                    </td>

                    {/* Phí GC = Công mài + Phụ phí */}
                    <td className="py-2 px-2 text-right font-mono font-semibold text-amber-700">
                      {formatNumber(row.processing_fee)}
                    </td>

                    {/* Diện tích thực */}
                    <td className="py-2 px-2 text-right font-mono font-bold text-slate-800">
                      {row.actual_m2.toFixed(3)}
                    </td>

                    {/* Delete */}
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => handleRemoveRow(row.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        title="Xóa dòng kích thước"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Add Row Button */}
          <div className="mt-3 flex items-center justify-between">
            <button
              id="btn-add-dimension-row"
              onClick={handleAddRow}
              type="button"
              title="Enter tại ô Phụ phí của dòng cuối để thêm dòng mới"
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm dòng</span>
            </button>
            <span className="text-xs text-slate-500">
              Tổng số tấm: <strong className="text-slate-800">{rows.reduce((sum, r) => sum + r.quantity, 0)} tấm</strong>
            </span>
          </div>
        </div>

        {/* Summary Footer Panel (SRS 4.5.4) */}
        <div
          id="dimension-modal-summary"
          className="px-5 py-3 bg-slate-100 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"
        >
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-slate-500 text-[11px]">TỔNG DIỆN TÍCH THỰC:</div>
            <div className="text-base font-bold text-blue-700 font-mono">
              {totalActualM2.toFixed(3)} m²
            </div>
            <div className="text-[10px] text-slate-400">
              Xuất kho (+{wasteFactor}%): <span className="font-semibold text-slate-600">{totalWasteM2.toFixed(3)} m²</span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-slate-500 text-[11px]">TỔNG CHU VI:</div>
            <div className="text-base font-bold text-emerald-700 font-mono">
              {totalPerimeterMd.toFixed(1)} md
            </div>
            <div className="text-[10px] text-slate-400">Chu vi mài cạnh 4 mép</div>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-slate-500 text-[11px]">TỔNG PHÍ GIA CÔNG:</div>
            <div className="text-base font-bold text-amber-700 font-mono">
              {formatVND(totalProcessingFee)}
            </div>
            <div className="text-[10px] text-slate-400">Gồm công mài + phụ phí</div>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
            <div className="text-slate-500 text-[11px]">THÀNH TIỀN TẠM TÍNH:</div>
            <div className="text-base font-extrabold text-rose-600 font-mono">
              {formatVND(totalAmount)}
            </div>
            <div className="text-[10px] text-slate-400">Phôi kính + Phí gia công</div>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between">
          <button
            id="btn-cancel-dimension-modal"
            onClick={onClose}
            type="button"
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            HỦY (Esc)
          </button>
          <div className="flex items-center gap-2">
            <button
              id="btn-confirm-dimension-modal"
              onClick={handleSave}
              type="button"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>XÁC NHẬN CẬP NHẬT (Ctrl+Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DimensionModalF3() {
  const { dimensionModalItem, setDimensionModalItem } = useStore();
  if (!dimensionModalItem) return null;
  return (
    <DimensionModalDialog
      item={dimensionModalItem.item}
      isNew={Boolean(dimensionModalItem.isNew)}
      onClose={() => setDimensionModalItem(null)}
    />
  );
}

