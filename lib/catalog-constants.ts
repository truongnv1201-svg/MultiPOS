// Hằng số thương mại thật (P1): tách khỏi seed dev trong ./mock-data.
// - GRINDING_TYPES / HOLE_PRICE / CORNER_PRICE là cấu hình kinh doanh, được dùng khi
//   offline (fallback khi chưa kéo được grinding_services/cash_rounding từ server).
// - Dữ liệu mẫu INITIAL_* vẫn nằm ở ./mock-data và chỉ dùng seed Dexie local lần đầu.
export interface GrindingType {
  id: string;
  label: string;
  price_per_md: number;
}

export const GRINDING_TYPES: GrindingType[] = [
  { id: 'none', label: 'Không mài / Cắt thô', price_per_md: 0 },
  { id: 'xiet_bong', label: 'Mài xiết bóng (20.000 đ/md)', price_per_md: 20000 },
  { id: 'huynh_vat', label: 'Mài huỳnh vát cạnh (35.000 đ/md)', price_per_md: 35000 },
  { id: 'mo_vit', label: 'Mài mỏ vịt bo tròn (30.000 đ/md)', price_per_md: 30000 },
  { id: 'luc_giac', label: 'Mài 45 độ ghép góc (40.000 đ/md)', price_per_md: 40000 },
];

export const HOLE_PRICE = 25000; // 25k / lỗ khoét
export const CORNER_PRICE = 15000; // 15k / góc bo
