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

  it('Cài đặt có nút dọn máy trạm (chỉ Admin, có xác nhận)', () => {
    const settings = read('components/settings/SettingsView.tsx');
    assert.match(settings, /Dọn sạch dữ liệu máy trạm/);
    assert.match(settings, /\{isAdmin && \(\s*\n?\s*<button\s*\n?\s*onClick=\{handleWipeMachine\}/);
    assert.match(settings, /window\.confirm\('Dọn SẠCH toàn bộ dữ liệu trên máy này/);
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

  it('doanh thu KPI chỉ tính đơn hoàn tất (cùng tập với lãi gộp)', () => {
    const reports = read('components/reports/ReportsView.tsx');
    assert.match(reports, /\.filter\(\(o\) => o\.status === 'completed'\)\s*\n\s*\.reduce\(\(sum, o\) => sum \+ o\.total_amount, 0\);/);
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
});
