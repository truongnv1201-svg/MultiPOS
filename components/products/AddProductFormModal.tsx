// Form "Thêm Hàng Hóa Mới" dùng chung — tách từ ProductsView để POS quick-create
// (tìm/quet mã không thấy trong danh mục) gọi đúng MỘT form duy nhất, không nhân bản.
// - ProductsView: mount thường, state giữ nguyên giữa các lần mở (hành vi cũ).
// - ProductSearchBar: mount với key=seq + seedQuery để prefill Tên/SKU từ chuỗi tìm.
'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { notify } from '@/components/common/Toast';
import { Product, ProductType } from '@/lib/types';
import { NumberInput } from '@/components/common/NumberInput';
import { QTY_MAX_DECIMALS, roundQty, suggestDecimalForUnit } from '@/lib/quantity';
import { SheetShell } from '@/components/common/SheetShell';
import { Plus } from 'lucide-react';

export const UNIT_OPTIONS = [
  {
    label: 'Vật liệu & kích thước',
    options: [
      { value: 'm²', label: 'm² — mét vuông' },
      { value: 'md', label: 'md — mét dài' },
      { value: 'm', label: 'm — mét' },
      { value: 'cây', label: 'cây' },
      { value: 'kg', label: 'kg — kilôgam' },
      { value: 'tấn', label: 'tấn' },
    ],
  },
  {
    label: 'Hàng hóa & phụ kiện',
    options: [
      { value: 'cái', label: 'cái' },
      { value: 'chiếc', label: 'chiếc' },
      { value: 'bộ', label: 'bộ' },
      { value: 'cặp', label: 'cặp' },
      { value: 'chai', label: 'chai' },
      { value: 'cuộn', label: 'cuộn' },
      { value: 'thùng', label: 'thùng' },
      { value: 'bao', label: 'bao' },
      { value: 'hộp', label: 'hộp' },
      { value: 'gói', label: 'gói' },
      { value: 'viên', label: 'viên' },
    ],
  },
  {
    label: 'Dịch vụ',
    options: [
      { value: 'chuyến', label: 'chuyến' },
      { value: 'công', label: 'công' },
      { value: 'giờ', label: 'giờ' },
      { value: 'lần', label: 'lần' },
    ],
  },
] as const;

interface AddProductFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Seed từ POS quick-create: điền Tên + SKU từ chuỗi đang tìm/quét */
  seedQuery?: string;
  /** Gọi sau khi tạo thành công (POS dùng để thêm giỏ / mở F3). Bỏ trống = chỉ đóng modal */
  onCreated?: (product: Product) => void;
}

export function AddProductFormModal({ open, onClose, seedQuery, onCreated }: AddProductFormModalProps) {
  const { addProduct } = useStore();

  // Form state — mặc định giống form gốc của Danh mục hàng hóa.
  // SKU để trống -> addProduct tự sinh SP... (giống form Danh mục);
  // chỉ seed sẵn SKU khi chuỗi tìm/quét có dạng mã vạch (toàn số, ≥ 6 chữ số).
  const [name, setName] = useState(seedQuery?.trim() ?? '');
  const [sku, setSku] = useState(() => {
    const q = seedQuery?.trim() ?? '';
    return /^\d{6,}$/.test(q) ? q : '';
  });
  const [unit, setUnit] = useState('cái');
  const [productType, setProductType] = useState<ProductType>('goods');
  const [retailPrice, setRetailPrice] = useState<number | ''>('');
  const [importPrice, setImportPrice] = useState<number | ''>('');
  const [stockQuantity, setStockQuantity] = useState<number | ''>('');
  // Mặc định cho phép số lượng thập phân (2,15 kg) — tắt thủ công cho hàng đếm theo cái
  const [allowDecimal, setAllowDecimal] = useState(true);
  const [wasteFactor, setWasteFactor] = useState(5);
  const [defaultGrindingPrice, setDefaultGrindingPrice] = useState(20000);
  const [saving, setSaving] = useState(false);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const created = await addProduct({
        name: name.trim(),
        unit,
        product_type: productType,
        retail_price: Math.max(0, Math.round(retailPrice || 0)),
        import_price: Math.max(0, Math.round(importPrice || 0)),
        avg_cost: Math.max(0, Math.round(importPrice || 0)), // INT-ERR-01
        stock_quantity: Math.max(0, roundQty(stockQuantity || 0)),
        allow_decimal: productType === 'area' ? true : allowDecimal,
        waste_factor: productType === 'area' ? wasteFactor : undefined,
        default_grinding_price: productType === 'area' ? defaultGrindingPrice : undefined,
        // SKU/Mã vạch từ quick-create POS; bỏ trống để addProduct tự sinh SP...
        sku: sku.trim() || undefined,
      } as Parameters<typeof addProduct>[0]);

      setName('');
      notify('Thêm mới sản phẩm thành công!', 'success');
      onClose();
      onCreated?.(created);
    } catch (err: unknown) {
      notify(`Không thể tạo sản phẩm: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      label="Thêm hàng hóa"
      icon={<Plus className="w-4 h-4 text-emerald-400" />}
      title="Thêm Hàng Hóa Mới (Bỏ trống SKU để tự sinh SP0000xx)"
    >
      <form onSubmit={handleCreateProduct} className="flex flex-col min-h-0">
        <div className="p-4 space-y-3 text-xs overflow-y-auto">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Tên sản phẩm *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vd: Kính dán an toàn 8.38mm trắng trong"
              className="w-full h-8 px-2.5 border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
              autoFocus
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Mã SKU / Mã vạch</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Bỏ trống để tự sinh (SP0000xx)"
              className="w-full h-8 px-2.5 font-mono border border-slate-300 rounded focus:border-blue-500 focus:outline-hidden"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Loại sản phẩm</label>
              <select
                value={productType}
                onChange={(e) => {
                  const val = e.target.value as ProductType;
                  setProductType(val);
                  // Đổi loại hàng thì chọn luôn đơn vị mặc định hợp lý
                  if (val === 'area') setUnit('m²');
                  else if (val === 'combo') setUnit('bộ');
                  else if (val === 'service') setUnit('công');
                  else if (unit === 'm²' || unit === 'bộ' || unit === 'công') setUnit('cái');
                }}
                className="w-full h-8 px-2 border border-slate-300 rounded"
              >
                <option value="area">Diện tích (Kính, Tấm alu, MDF)</option>
                <option value="goods">Thường (Cây nhôm, Phụ kiện)</option>
                <option value="combo">Combo trọn bộ (Trừ kho con)</option>
                <option value="service">Dịch vụ (Công lắp đặt)</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Đơn vị tính</label>
              <select
                value={unit}
                onChange={(e) => {
                  const next = e.target.value;
                  setUnit(next);
                  // Đơn vị cân nặng/thể tích (kg, l, tạ...) -> gợi ý bật số lượng thập phân
                  if (suggestDecimalForUnit(next) && productType !== 'area') setAllowDecimal(true);
                }}
                aria-label="Đơn vị tính"
                className="w-full h-8 px-2.5 border border-slate-300 rounded bg-white"
              >
                {UNIT_OPTIONS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Giá bán (đ)</label>
              <NumberInput
                value={retailPrice}
                onChange={(val) => setRetailPrice(val)}
                placeholder="0"
                className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Giá vốn nhập (đ)</label>
              <NumberInput
                value={importPrice}
                onChange={(val) => setImportPrice(val)}
                placeholder="0"
                className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
              />
            </div>
          </div>

          {productType === 'area' && (
            <div className="grid grid-cols-2 gap-2 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              <div>
                <label className="font-semibold text-amber-900 block mb-1">
                  Hệ số hao hụt phôi (%)
                </label>
                <NumberInput
                  allowDecimals={true}
                  value={wasteFactor}
                  onChange={(val) => setWasteFactor(val)}
                  placeholder="5"
                  className="w-full h-8 px-2.5 border border-amber-300 rounded font-mono bg-white focus:border-amber-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="font-semibold text-amber-900 block mb-1">
                  Giá mài mặc định (đ/md)
                </label>
                <NumberInput
                  value={defaultGrindingPrice}
                  onChange={(val) => setDefaultGrindingPrice(val)}
                  placeholder="20.000"
                  className="w-full h-8 px-2.5 border border-amber-300 rounded font-mono bg-white focus:border-amber-500 focus:outline-hidden"
                />
              </div>
            </div>
          )}

          {productType !== 'service' && productType !== 'combo' && (
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Số lượng tồn kho ban đầu</label>
              <NumberInput
                value={stockQuantity}
                onChange={(val) => setStockQuantity(val)}
                allowDecimals={productType === 'area' || allowDecimal}
                maxDecimals={QTY_MAX_DECIMALS}
                placeholder="0"
                className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono focus:border-blue-500 focus:outline-hidden"
              />
              <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={productType === 'area' ? true : allowDecimal}
                  disabled={productType === 'area'}
                  onChange={(e) => setAllowDecimal(e.target.checked)}
                  className="w-4 h-4 accent-blue-600"
                />
                Cho phép bán số lượng thập phân (vd 2,15 kg)
                {productType === 'area' && <span className="text-slate-400 font-normal">— hàng m² luôn tính thập phân</span>}
              </label>
            </div>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
          >
            Hủy
          </button>
          <button
            type="submit"
            id="btn-add-product-save"
            disabled={saving}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-bold shadow-xs"
          >
            {saving ? 'Đang lưu...' : 'Lưu sản phẩm'}
          </button>
        </div>
      </form>
    </SheetShell>
  );
}
