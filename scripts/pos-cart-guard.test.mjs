// Guard cho đợt fixbug rà soát toàn bộ: giỏ chặn SL bẩn, khóa idempotency ổn định
// theo tab, thống kê ca đúng kênh tiền, reset dọn cả hàng đợi offline.
//
// Vì sao test tĩnh: các hàm nằm trong React hook (không import trực tiếp bằng node),
// nên khóa bằng assert trên source — cùng pattern với các guard *.test.mjs khác.
// Chạy: npm test (node --test ...). Không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('nhập kho: ô tiền trả NCC như bán lẻ (thiếu tự nợ, trống = trả đủ)', () => {
  const pos = read('components/pos/POSScreen.tsx');

  it('có ô Tiền trả NCC + nút Đủ tiền (3 thức, không còn Trả 1 phần)', () => {
    assert.match(pos, /id="imp-tendered-input"/);
    assert.match(pos, /onClick=\{\(\) => setImpTendered\(impTotal\)\}/);
    assert.doesNotMatch(pos, /setImpPaymentMethod\('partial'\)/);
  });

  it('ô trống = trả đủ cả phiếu (giữ hành vi cũ, mobile không ô nhập vẫn đúng)', () => {
    assert.match(pos, /const effectiveTendered = impPaymentMethod === 'debt' \? 0 : impTendered \|\| impTotal;/);
    assert.match(pos, /let paid = Math\.max\(0, Math\.min\(impTotal, effectiveTendered\)\);/);
  });

  it('thiếu tiền bắt chọn NCC (ghi nợ vô chủ không lọt)', () => {
    assert.match(pos, /if \(paid < impTotal && !impSupplier\.trim\(\)\) \{/);
  });
});

describe('giỏ chặn SL bẩn (âm/0/NaN) trước khi trừ tồn', () => {
  const cart = read('lib/store/tx/cart.tsx');

  it('addItemToCart từ chối SL không dương ngay cửa vào', () => {
    assert.match(cart, /if \(\!\(quantity > 0\)\) return;/);
  });

  it('gộp dòng trùng mà SL gộp <= 0 thì gỡ dòng (không giữ dòng âm kho)', () => {
    assert.match(cart, /if \(\!\(newQty > 0\)\) \{[\s\S]{0,200}filter\(\(_, i\) => i !== existingIndex\)/);
  });

  it('updateCartItem bỏ qua SL bẩn nhưng vẫn áp update khác (sửa giá không kẹt)', () => {
    assert.match(cart, /const \{ quantity, \.\.\.rest \} = updates;/);
    assert.match(cart, /quantity !== undefined && \!\(quantity > 0\) \? rest : updates/);
  });
});

describe('khóa idempotency ổn định theo tab (chống trùng đơn khi retry)', () => {
  const cart = read('lib/store/tx/cart.tsx');
  const checkout = read('lib/store/tx/checkout.tsx');
  const types = read('lib/store/types.ts');

  it('CartTab có trường client_ref', () => {
    assert.match(types, /client_ref\?: string;/);
  });

  it('checkout tái dùng khóa của tab, chỉ sinh mới khi chưa có', () => {
    assert.match(checkout, /activeCart\.client_ref \|\| `ord-/);
    assert.match(checkout, /if \(\!activeCart\.client_ref\) updateActiveTab\(\{ client_ref: clientRef \}\);/);
  });

  it('đổi món/xóa món/xóa giỏ thì xoay/xóa khóa (khóa cũ hết khớp nội dung)', () => {
    const hits = cart.match(/client_ref: undefined/g) || [];
    assert.ok(hits.length >= 4, `cần >= 4 chỗ xoay khóa, thấy ${hits.length}`);
  });

  it('luồng updateActiveTab tới được checkout (qua TxOrdersDeps)', () => {
    assert.match(read('lib/store/tx/orders-types.ts'), /updateActiveTab: \(updater: Partial<CartTab>\) => void;/);
    assert.match(read('lib/store/transactions.tsx'), /updateActiveTab: cart\.updateActiveTab,/);
  });
});

describe('thống kê ca đúng kênh tiền', () => {
  const checkout = read('lib/store/tx/checkout.tsx');

  it('cọc chuyển khoản KHÔNG vào doanh thu transfer_sales', () => {
    assert.match(checkout, /transfer_sales: \!isCash && \!isDeposit \? prev\.transfer_sales \+ paidAmount/);
  });

  it('cọc mọi kênh đều vào deposit_collected', () => {
    assert.match(checkout, /deposit_collected: isDeposit \? prev\.deposit_collected \+ paidAmount/);
  });
});

describe('reset dọn cả hàng đợi offline', () => {
  const store = read('lib/store.tsx');

  it('resetData xóa pendingOps + pendingMasterData (khỏi replay thao tác mồ côi)', () => {
    assert.match(store, /await db\.pendingOps\.clear\(\)/);
    assert.match(store, /await db\.pendingMasterData\.clear\(\)/);
  });
});

describe('đổi project dọn máy trạm (khỏi lẫn số dư project cũ)', () => {
  it('có helper dọn sạch mọi bảng Dexie + map KH local', () => {
    const db = read('lib/db.ts');
    assert.match(db, /export const MACHINE_PROJECT_KEY = 'multipos_project_url';/);
    assert.match(db, /export async function clearLocalMachineData\(\): Promise<void>/);
    assert.match(db, /await Promise\.all\(db\.tables\.map\(\(t\) => t\.clear\(\)\)\)/);
    assert.match(db, /localStorage\.removeItem\('multipos_customer_map_v1'\)/);
  });

  it('boot phát hiện đổi URL project thì dọn + ghi marker (lần đầu chỉ ghi marker)', () => {
    const store = read('lib/store.tsx');
    assert.match(store, /prevProjectUrl !== currentProjectUrl/);
    assert.match(store, /await clearLocalMachineData\(\);/);
    assert.match(store, /localStorage\.setItem\(MACHINE_PROJECT_KEY, currentProjectUrl\)/);
  });

  it('Cài đặt KHÔNG còn nút tay (zero-touch 10/2026: user không thạo kỹ thuật)', () => {
    // Quyết định mới thay thế nút tay cũ: bỏ Tải/Khôi phục backup tay, bỏ nút
    // "Dọn sạch dữ liệu máy trạm" (nguy hiểm khi bấm nhầm). An toàn đổi project
    // vẫn giữ bằng wipe TỰ ĐỘNG lúc boot (test ngay phía trên).
    const settings = read('components/settings/SettingsView.tsx');
    assert.ok(!/Dọn sạch dữ liệu máy trạm/.test(settings), 'không còn nút dọn máy trạm');
    assert.ok(!/handleWipeMachine/.test(settings), 'không còn handler dọn máy trạm');
    assert.ok(!/Tải bản sao lưu/.test(settings), 'không còn nút tải backup tay');
    assert.ok(!/Khôi phục từ tệp/.test(settings), 'không còn nút khôi phục tay');
    assert.ok(!/isBackupStale/.test(settings), 'không còn nhắc sao lưu tay');
    // Thay bằng dòng trạng thái tự động, không nút bấm.
    assert.match(settings, /tự động sao lưu/);
  });

  it('lưu cửa hàng báo toast (không hộp inline im lặng)', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.match(settings, /notify\('Đã lưu thông tin cửa hàng lên máy chủ\.', 'success'\)/);
    assert.ok(!/setShopMsg|shopMsg/.test(settings), 'không còn message inline khối cửa hàng');
  });

  it('toàn trang Cài đặt dùng toast, không còn hộp message inline', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.match(settings, /import \{ notify \} from '@\/components\/common\/Toast';/);
    for (const name of ['grindingMsg', 'posMsg', 'vietqrMsg', 'backupMsg']) {
      assert.ok(!new RegExp(name).test(settings), `còn sót ${name}`);
    }
  });

  it('lời cảm ơn + chính sách nằm ở mục nội dung phiếu in (mỗi ô đúng 1 lần)', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.equal((settings.match(/Lời cảm ơn cuối phiếu/g) || []).length, 1);
    assert.equal((settings.match(/Chính sách đổi trả \(in nhỏ cuối phiếu\)/g) || []).length, 1);
    assert.ok(
      settings.indexOf('Nội dung hiển thị trên phiếu in') < settings.indexOf('Lời cảm ơn cuối phiếu'),
      '2 ô phải nằm sau tiêu đề mục nội dung phiếu in'
    );
  });

  it('mọi nút xóa (thùng rác) dùng đỏ thường trực, không xám-chờ-hover', () => {
    // Chuẩn: text-rose-600 (+ hover:bg-rose-50). Kiểu cũ xám text-slate-400 chỉ đỏ
    // khi hover khiến user không nhận ra xóa được.
    for (const f of [
      'components/projects/ProjectsView.tsx',
      'components/pos/DimensionModalF3.tsx',
      'components/pos/POSScreen.tsx',
      'components/hrm/tabs/AdvancesModal.tsx',
    ]) {
      assert.ok(!/text-slate-400 hover:text-rose-600/.test(read(f)), `${f} còn nút xóa xám`);
    }
  });
});

describe('số dư đầu kỳ cấu hình được (không cộng cứng trong code)', () => {
  it('ShopSettings có 2 số dư đầu kỳ, mặc định 0', () => {
    const shop = read('lib/store/shop.ts');
    assert.match(shop, /openingCashBalance: number;/);
    assert.match(shop, /openingBankBalance: number;/);
    assert.match(shop, /openingCashBalance: 0,/);
    assert.match(shop, /openingBankBalance: 0,/);
  });

  it('sổ quỹ cộng số dư đầu kỳ từ cấu hình, không còn số cứng', () => {
    const cashbook = read('components/cashbook/CashbookView.tsx');
    assert.ok(!/}, 2000000\)/.test(cashbook), 'còn cộng cứng 2M');
    assert.ok(!/}, 15000000\)/.test(cashbook), 'còn cộng cứng 15M');
    assert.match(cashbook, /shop\.openingCashBalance \?\? 0/);
    assert.match(cashbook, /shop\.openingBankBalance \?\? 0/);
  });

  it('Cài đặt cho Admin sửa 2 số dư đầu kỳ', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.match(settings, /Số dư đầu kỳ tiền mặt/);
    assert.match(settings, /Số dư đầu kỳ ngân hàng/);
    assert.match(settings, /updateShop\(\{ openingCashBalance:/);
    assert.match(settings, /updateShop\(\{ openingBankBalance:/);
  });
});

describe('cài đặt theo máy trạm (local-only, không đồng bộ server)', () => {
  it('mặc định POS + lời cảm ơn + chính sách nằm trong LOCAL_SHOP_KEYS', () => {
    const commerce = read('lib/store/commerce.tsx');
    for (const key of ['defaultVat', 'defaultPayment', 'defaultPriceBook', 'footerThanks', 'receiptPolicy']) {
      assert.match(commerce, new RegExp(`'${key}',`), `thiếu local key ${key}`);
    }
  });

  it('VietQR không còn đẩy/kéo server', () => {
    const commerce = read('lib/store/commerce.tsx');
    assert.ok(!/saveVietqrSettings/.test(commerce), 'còn sót saveVietqrSettings');
    assert.ok(!/refreshVietqr/.test(commerce), 'còn sót refreshVietqr');
    const settings = read('components/settings/SettingsView.tsx');
    assert.ok(!/handleSaveVietqr|handleSavePosDefaults/.test(settings), 'còn sót nút lưu server');
  });

  it('ghi chú sao lưu tự động nằm trên header trang Cài đặt', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.match(settings, /Dữ liệu tự động sao lưu mỗi đêm/);
  });
});

describe('đợt fixbug rà soát vòng 2 (không trùng đơn, đúng kênh tiền, đúng số)', () => {
  it('bảng lương không chốt đã-chi khi còn người tạm ứng vượt lương', () => {
    const hrm = read('lib/store/hrm-slice.tsx');
    assert.match(hrm, /payrollItems\.filter\(\(i\) => i\.run_id === runId && \!i\.paid && i\.net <= 0\)/);
    assert.match(hrm, /update\(\{ status: 'finalized', paid_at: null \}\)/);
  });

  it('QR khổ K80 thu đúng số còn nợ (như khổ A4)', () => {
    const receipt = read('components/pos/ReceiptModal.tsx');
    assert.match(receipt, /const qrAmount = order\.debt_amount > 0 \? order\.debt_amount : order\.total_amount;/);
    assert.match(receipt, /buildVietqrUrl\(vietqr, qrAmount,/);
  });

  it('doanh thu KPI chỉ tính đơn đã giao (cùng tập với lãi gộp)', () => {
    const reports = read('components/reports/ReportsView.tsx');
    assert.match(reports, /\.filter\(\(o\) => o\.status === 'completed' \|\| o\.status === 'partial_returned'\)\s*\n\s*\.reduce\(\(sum, o\) => sum \+ o\.total_amount, 0\);/);
  });

  it('sheet mobile xóa từ khóa KH cũ khi mở đơn khác', () => {
    const sheet = read('components/pos/MobilePaymentSheet.tsx');
    assert.match(sheet, /if \(open && \!prevOpenRef\.current\) setCustomerQuery\(''\);/);
  });

  it('hàm nhập lẻ chết đã gỡ (cứng bank + trả đủ, không ai gọi)', () => {
    for (const f of [
      'lib/store/tx/shift-stock.tsx',
      'lib/store/transactions.tsx',
      'lib/store.tsx',
    ]) {
      assert.doesNotMatch(read(f), /importStock[^B]/);
    }
  });

  it('trả từng phần: type + guard + trạng thái server', () => {
    assert.match(read('lib/types.ts'), /'partial_returned'/);
    const ret = read('lib/store/tx/order-returns.ts');
    assert.match(ret, /order\.status !== 'partial_returned'\) \{/);
    assert.match(ret, /Đơn đã trả một phần — hoàn nốt phần còn lại, không hủy nguyên đơn\./);
    assert.match(ret, /let srvStatus: 'returned' \| 'partial_returned' \| null/);
    const orders = read('components/orders/OrdersView.tsx');
    assert.match(orders, /Trả một phần/);
    const reports = read('components/reports/ReportsView.tsx');
    assert.match(reports, /o\.status === 'partial_returned'/);
  });

  it('trùng mã CT không đè dự án người khác (sinh mã mới đẩy riêng)', () => {
    const projects = read('lib/store/tx/projects.tsx');
    assert.ok(!/select\('id'\)\.eq\('code', project\.code\)/.test(projects), 'không tra id theo code để PATCH');
    assert.match(projects, /generateOrderCode\('CT'\)/);
  });

  it('mở ca báo đúng: chỉ đóng modal khi mở thật (không thành công oan)', () => {
    const modal = read('components/pos/ShiftModalF12.tsx');
    assert.match(modal, /const ok = await openNewShift\(newShiftStartingCash\);/);
    assert.match(modal, /if \(!ok\) return;/);
    const shift = read('lib/store/tx/shift-stock.tsx');
    assert.match(shift, /async \(startingCash: number\): Promise<boolean> =>/);
  });

  it('mở modal ca thì reset ô nhập (không giữ số lần mở trước)', () => {
    const modal = read('components/pos/ShiftModalF12.tsx');
    assert.match(modal, /if \(shiftModalOpen && !prevOpenRef\.current\) \{/);
    assert.match(modal, /setNewShiftStartingCash\(currentShift\.counted_cash \?\? 2000000\)/);
  });

  it('Esc đóng modal ca (khớp nhãn nút)', () => {
    const modal = read('components/pos/ShiftModalF12.tsx');
    assert.match(modal, /if \(e\.key === 'Escape'\) setShiftModalOpen\(false\);/);
  });

  it('tạo KH trùng SĐT thì hỏi dùng chung (khỏi phân mảnh công nợ)', () => {
    const catalog = read('lib/store/catalog.tsx');
    assert.match(catalog, /SĐT đã tồn tại/);
    assert.match(catalog, /Dùng hồ sơ cũ/);
  });
});
