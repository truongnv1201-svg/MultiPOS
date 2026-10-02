// Test tĩnh bảo vệ Giai đoạn 2 (mobile-first): các bảng ngang phải có record list
// / bottom sheet thay thế trên điện thoại, và Sync Center phải mở được từ header.
// Chạy: npm test (node --test ...). Chỉ đọc file nên không cần mạng/DB.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
// Chuẩn hoá CRLF -> LF: repo không có .gitattributes, file checkout trên Windows có
// thể là CRLF trong khi regex trong test viết với \n (VD assert khối isMobileViewport
// trong lib/excel.ts). Không chuẩn hoá thì test đỏ oan trên máy Windows.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('POS: mobile cart sheet thay bảng ngang', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const sheet = read('components/pos/MobileCartSheet.tsx');

  it('bảng giỏ bán chỉ hiện từ lg trở lên', () => {
    assert.match(pos, /hidden lg:block border border-slate-200 rounded-lg overflow-hidden shadow-2xs/);
  });

  it('bảng dòng nhập chỉ hiện từ lg trở lên', () => {
    assert.match(pos, /lg:hidden flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100/);
  });

  it('nút Giỏ trên dock mở sheet thay vì cuộn tới bảng', () => {
    assert.match(pos, /onOpenCart=\{\(\) => \{[\s\S]{0,400}setIsMobileCartOpen\(true\)/);
  });

  it('sheet có id ổn định + nút đóng + thanh toán, có safe-area', () => {
    assert.match(sheet, /id="cart-record-list"/);
    assert.match(sheet, /aria-label="Đóng giỏ hàng"/);
    assert.match(sheet, /onCheckout/);
    assert.match(sheet, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it('sheet dùng lại callback giỏ sẵn có (không nhân bản logic giỏ)', () => {
    assert.match(pos, /onQuantityChange=\{\(itemId, quantity\) => updateCartItem\(itemId, \{ quantity \}\)\}/);
    assert.match(pos, /onRemove=\{removeCartItem\}/);
  });
});

describe('POS: đã bỏ chế độ bán hàng dạng lưới thẻ', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const cart = read('lib/store/tx/cart.tsx');

  it('không còn khối lưới thẻ sản phẩm', () => {
    assert.doesNotMatch(pos, /id="product-grid-section"/);
    assert.doesNotMatch(pos, /posMode === 'standard' && \(/);
  });

  it('không còn nút đổi chế độ và không còn state posMode', () => {
    assert.doesNotMatch(pos, /id="btn-toggle-pos-mode"/);
    assert.doesNotMatch(pos, /\bposMode\b/);
    assert.doesNotMatch(pos, /\bsetPosMode\b/);
    assert.doesNotMatch(cart, /\bposMode\b/);
    assert.doesNotMatch(cart, /\bsetPosMode\b/);
  });

  it('POS vẫn chọn hàng được bằng ô tìm kiếm (không mất đường thêm hàng trên mobile)', () => {
    // Thanh tìm nằm trong #pos-goods-toolbar, không bị ẩn trên mobile — đây là đường
    // chọn hàng duy nhất sau khi bỏ lưới thẻ.
    assert.match(pos, /id="pos-goods-toolbar"[\s\S]{0,1500}<ProductSearchBar/);
    assert.doesNotMatch(pos, /id="pos-goods-toolbar"[^>]*hidden lg/);
  });

  it('F2 là phím toàn cục về màn Bán hàng (nút header quảng cáo F2 phải bấm được)', () => {
    // F2 từng đổi chế độ Thẻ/Nhanh; bỏ lưới thẻ thì F2 thành phím về POS, xử lý ở
    // GlobalHeader chung với nút #btn-goto-pos (đóng menu phân hệ rồi chuyển màn).
    const header = read('components/GlobalHeader.tsx');
    assert.match(header, /e\.key === 'F2'/);
    assert.match(header, /go\('pos'\)/);
  });

  it('2 nút quét mã/bàn phím nằm ở cột controls phải (state dùng chung với ô tìm)', () => {
    const bar = read('components/pos/ProductSearchBar.tsx');
    assert.match(bar, /export function useSearchTools\(\): SearchTools/);
    assert.match(bar, /export function SearchToolButtons\(\{ tools \}/);
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /const searchTools = useSearchTools\(\);/);
    assert.match(pos, /externalTools=\{searchTools\}\s*\n?\s*hideTools/);
    assert.match(pos, /<SearchToolButtons tools=\{searchTools\} \/>/);
  });
});

describe('POS: gợi ý và nhảy phím F1 / F9 (thu ngân không rời bàn phím)', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const searchBar = read('components/pos/ProductSearchBar.tsx');
  const header = read('components/GlobalHeader.tsx');

  it('ô tìm hàng hiện huy hiệu F1 (user mới biết phím tắt, không chỉ tooltip)', () => {
    assert.match(searchBar, /id="f1-search-input"/);
    assert.match(searchBar, /<kbd[^>]*>[\s\S]{0,20}F1[\s\S]{0,20}<\/kbd>/);
    assert.match(header, /getElementById\('f1-search-input'\)/);
  });

  it('F9 nhịp 1 nhảy tới ô tiền, bấm nữa điền đủ tiền (khỏi tìm nút Đủ tiền)', () => {
    assert.match(pos, /id="f9-tendered-input"/);
    assert.match(pos, /document\.activeElement === tenderedInputRef\.current/);
    assert.match(pos, /updateActiveTab\(\{ tendered_amount: calculatedTotals\.payable \}\)/);
  });
});

describe('POS: bàn phím phải cuộn theo dòng đang chọn trong dropdown', () => {
  const search = read('components/pos/ProductSearchBar.tsx');
  const select = read('components/common/SearchableSelect.tsx');

  it('dropdown tìm hàng cuộn dòng đang chọn vào khung (block: nearest)', () => {
    assert.match(search, /ref=\{\s*isSelected[\s\S]{0,220}scrollIntoView\(\{ block: 'nearest' \}\)/);
  });

  it('SearchableSelect cũng cuộn dòng active vào khung (trần max-h-52)', () => {
    assert.match(select, /max-h-52 overflow-y-auto/);
    assert.doesNotMatch(select, /className="absolute z-50 left-0 right-0 mt-1 h-52/);
    assert.match(select, /ref=\{\s*isActive[\s\S]{0,220}scrollIntoView\(\{ block: 'nearest' \}\)/);
  });

  it('điều hướng mũi tên vẫn giữ nguyên (đổi chỉ cuộn, không đổi hành vi chọn)', () => {
    assert.match(search, /if \(e\.key === 'ArrowDown'\)[\s\S]{0,120}setSelectedIndex/);
    assert.match(search, /if \(e\.key === 'ArrowUp'\)[\s\S]{0,160}setSelectedIndex/);
  });

  it('dropdown bám sát nội dung khi ít kết quả, có trần khi nhiều kết quả', () => {
    // h-64 cố định -> chừa khối trống to khi chỉ có 0-1 kết quả.
    assert.doesNotMatch(search, /id="search-results-dropdown"[\s\S]{0,400}className="[^"]*\bh-64\b/);
    assert.match(search, /id="search-results-dropdown"[\s\S]{0,400}max-h-72 flex flex-col/);
    // Dải hướng dẫn phím không bị cắt khi khung chạm trần.
    assert.match(search, /text-\[10px\] text-slate-500 flex items-center justify-between shrink-0/);
  });
});

describe('POS: ô tìm khách hàng F4 dùng được bàn phím', () => {
  const pos = read('components/pos/POSScreen.tsx');

  it('mũi tên lên/xuống di chuyển dòng khách (vòng lặp) và mở dropdown', () => {
    assert.match(pos, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
    assert.match(pos, /setCustomerActiveIndex\(\(prev\) => \{[\s\S]{0,320}return \(\(next % total\) \+ total\) % total;/);
  });

  it('Enter chọn khách đang chọn, Escape vẫn đóng dropdown', () => {
    assert.match(pos, /if \(e\.key === 'Enter'\) \{[\s\S]{0,900}pickCustomer\(cust\)/);
    assert.match(pos, /if \(e\.key === 'Escape'\) closeCustomerDropdown\(\);/);
  });

  it('dòng đang chọn được đánh dấu và tự cuộn vào khung dropdown', () => {
    assert.match(pos, /id="customer-search-dropdown"[\s\S]{0,300}max-h-40[\s\S]{0,80}overflow-y-auto/);
    // max-h-40 cũng chứa chuỗi "h-40", nên phải loại trừ tiền tố "max-".
    assert.doesNotMatch(pos, /id="customer-search-dropdown"[\s\S]{0,300}className="[^"]*(?<!max-)\bh-40\b/);
    assert.match(pos, /custIdx === customerActiveIndex \? 'bg-blue-50'/);
    assert.match(pos, /custIdx === customerActiveIndex[\s\S]{0,220}scrollIntoView\(\{ block: 'nearest' \}\)/);
  });

  it('đóng dropdown / gõ lại từ khoá thì về dòng đầu', () => {
    assert.match(pos, /setCustomerSearch\(e\.target\.value\);[\s\S]{0,200}setCustomerActiveIndex\(0\);/);
    assert.match(pos, /const closeCustomerDropdown = useCallback\(\(\) => \{[\s\S]{0,160}setCustomerActiveIndex\(0\);/);
  });
});

describe('POS: khách lẻ tại quầy là mục chọn được, không phải fallback của ô nhập', () => {
  const pos = read('components/pos/POSScreen.tsx');

  it('ô nhập khi đang sửa hiện đúng chuỗi gõ (kể cả rỗng), không tự nhảy nhãn', () => {
    assert.match(pos, /value=\{customerEditing \? customerSearch : customerSearch \|\| activeCart\.customer_name\}/);
    assert.match(pos, /onChange=\{\(e\) => \{[\s\S]{0,200}setCustomerEditing\(true\);/);
    assert.match(pos, /onFocus=\{\(e\) => \{[\s\S]{0,200}setCustomerEditing\(true\);/);
  });

  it('đóng dropdown khi rời ô phải trễ (nếu đóng ngay, dòng bị gỡ trước khi click trúng)', () => {
    assert.match(pos, /onBlur=\{\(\) => \{[\s\S]{0,520}window\.setTimeout\(/);
    // ...và phải bỏ qua nếu người dùng đã quay lại ô (tránh đóng nhầm dropdown vừa mở lại)
    assert.match(pos, /if \(customerWrapRef\.current\?\.contains\(document\.activeElement\)\) return;/);
  });

  it('khách lẻ nằm đầu danh sách gợi ý với id sentinel, KHÔNG phải bản ghi DB', () => {
    assert.match(pos, /const WALK_IN_CUSTOMER_ID = 'walk-in-customer';/);
    assert.match(pos, /const customerOptions = React\.useMemo<CustomerOption\[\]>\(\s*\(\) => \[walkInOption, \.\.\.customers\]/);
    // id sentinel không phải UUID nên không thể lẫn với khách thật
    assert.doesNotMatch(pos, /walkInOption = React\.useMemo<CustomerOption>\(\s*\(\) => \(\{[\s\S]{0,200}customers\.find/);
  });

  it('chọn mục khách lẻ = bỏ chọn khách hàng (customer_id rỗng) nhưng giữ nhãn đơn', () => {
    assert.match(pos, /customer_id: cust\.isWalkIn \? undefined : cust\.id,/);
    assert.match(pos, /customer_name: cust\.name,/);
    assert.match(pos, /Không lưu hồ sơ · không cộng nợ/);
  });
});

describe('POS: tạo mới nhanh từ ô tìm kiếm (khách hàng / NCC)', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const search = read('components/pos/ProductSearchBar.tsx');
  const select = read('components/common/SearchableSelect.tsx');
  const custModal = read('components/pos/POSQuickCustomerModal.tsx');

  it('ô khách hàng: có dòng "Tạo khách hàng mới" ở chân dropdown', () => {
    assert.match(pos, /id="btn-quick-create-customer"/);
    assert.match(pos, /Tạo khách hàng mới: &quot;\{customerSearch\.trim\(\)\}&quot;/);
    assert.match(pos, /id="btn-quick-create-customer"[\s\S]{0,400}openQuickCustomer\(customerSearch\.trim\(\)\)/);
  });

  it('Enter khi không có kết quả thì mở form tạo nhanh (giống ô tìm hàng hóa)', () => {
    assert.match(pos, /filteredCustomers\.length === 0 && customerSearch\.trim\(\)[\s\S]{0,200}openQuickCustomer\(/);
    // Ô tìm hàng hóa dùng đúng quy tắc này làm mẫu
    assert.match(search, /filteredProducts\.length === 0\)[\s\S]{0,200}openQuickCreate\(searchQuery\)/);
  });

  it('form khách hàng nhận tên điền sẵn và nhảy con trỏ sang ô SĐT', () => {
    assert.match(custModal, /initialName = ''/);
    assert.match(custModal, /useState<string>\(initialName\)/);
    assert.match(custModal, /if \(initialName\.trim\(\)\) phoneRef\.current\?\.focus\(\);/);
    assert.match(pos, /<POSQuickCustomerModal[\s\S]{0,200}initialName=\{quickCustomerSeed\}/);
  });

  it('SearchableSelect: onQuickCreate thêm dòng tạo nhanh + Enter khi không có kết quả', () => {
    assert.match(select, /onQuickCreate\?: \(query: string\) => void;/);
    assert.match(select, /const showQuickCreate = Boolean\(onQuickCreate\) && query\.trim\(\) !== '' && !hasExactMatch;/);
    assert.match(select, /id="btn-quick-create-option"/);
    assert.match(select, /showQuickCreate && filtered\.length === 0\)[\s\S]{0,220}onQuickCreate\?\.\(query\.trim\(\)\)/);
  });

  it('ô NCC trong luồng Nhập hàng nối vào form thêm NCC nhanh, tên điền sẵn', () => {
    assert.match(pos, /quickCreateLabel="Tạo nhà cung cấp mới"/);
    assert.match(pos, /onQuickCreate=\{\(q\) => \{[\s\S]{0,200}setSupName\(q\);[\s\S]{0,120}setIsQuickSupplierModalOpen\(true\);/);
    assert.match(pos, /id="quick-sup-name-input"/);
  });
});

describe('Kho + NCC: mobile record list', () => {
  const inv = read('components/inventory/InventoryView.tsx');
  const sup = read('components/suppliers/SuppliersView.tsx');

  it('kho có record list tồn và thẻ kho, bảng ẩn trên mobile', () => {
    assert.match(inv, /id="stock-record-list" className="lg:hidden/);
    assert.match(inv, /id="movement-record-list" className="lg:hidden/);
    assert.match(inv, /hidden lg:block flex-1 min-h-0 overflow-y-auto overflow-x-auto/);
  });

  it('kho không bị bottom nav cắt (bỏ chiều cao 100dvh cứng)', () => {
    assert.match(inv, /id="inventory-view" className="[^"]*h-full[^"]*min-h-0/);
    assert.doesNotMatch(inv, /100dvh/);
  });

  it('NCC có record list + sheet chi tiết, bảng ẩn trên mobile', () => {
    assert.match(sup, /id="supplier-record-list" className="lg:hidden/);
    assert.match(sup, /aria-label="Chi tiết nhà cung cấp"/);
    assert.match(sup, /hidden md:flex w-full md:w-96/);
  });
});

describe('Sync Center: mở được từ header, xem & gửi lại hàng đợi', () => {
  const header = read('components/GlobalHeader.tsx');
  const sheet = read('components/common/SyncCenterSheet.tsx');

  it('header có nút mở trung tâm đồng bộ (id ổn định)', () => {
    assert.match(header, /id="header-sync-center-btn"/);
    assert.match(header, /<SyncCenterSheet open=\{syncCenterOpen\}/);
  });

  it('sheet đọc cả 3 hàng đợi offline và đếm thao tác lỗi', () => {
    assert.match(sheet, /db\.pendingOps\.toArray\(\)/);
    assert.match(sheet, /db\.pendingMasterData\.toArray\(\)/);
    assert.match(sheet, /db\.pendingOrders\.toArray\(\)/);
    assert.match(sheet, /status === 'failed'/);
  });

  it('sheet có hành động đồng bộ ngay, gửi lại lỗi và bỏ hàng đợi (có xác nhận)', () => {
    assert.match(sheet, /await refreshNow\(\)/);
    assert.match(sheet, /await syncPendingOps\(true\)/);
    assert.match(sheet, /confirmDialog\(/);
    assert.match(sheet, /db\.pendingOps\.clear\(\)/);
  });

  it('nút Làm mới rời đã bỏ — thao tác kéo số liệu gộp vào Trung tâm đồng bộ', () => {
    assert.doesNotMatch(header, /id="header-refresh-btn"/);
    assert.match(header, /id="header-sync-center-btn"[\s\S]{0,900}?Đang đồng bộ dữ liệu mới nhất/);
    assert.match(sheet, /await refreshNow\(\)/);
  });

  it('nút Online gộp vào nút đồng bộ — màu nút là trạng thái mạng', () => {
    // Không còn pill trạng thái mạng riêng; nút sync đỏ khi offline,
    // xanh lá khi realtime trực tiếp.
    assert.doesNotMatch(header, /id="network-status-toggle"/);
    assert.match(header, /\!isOnline[\s\S]{0,200}?bg-rose-950\/90/);
    assert.match(header, /realtimeLive[\s\S]{0,200}?bg-emerald-950\/80/);
  });
});

describe('Giai đoạn 3: thanh toán ghim + sheet dùng chung + quét mã + PWA', () => {
  const pos = read('components/pos/POSScreen.tsx');
  const pay = read('components/pos/MobilePaymentSheet.tsx');
  const shell = read('components/common/SheetShell.tsx');
  const scanner = read('components/pos/BarcodeScannerSheet.tsx');
  const search = read('components/pos/ProductSearchBar.tsx');
  const sup = read('components/suppliers/SuppliersView.tsx');
  const cus = read('components/customers/CustomersView.tsx');
  const pro = read('components/products/ProductsView.tsx');
  const addPro = read('components/products/AddProductFormModal.tsx');
  const store = read('lib/store.tsx');
  const sw = read('public/sw.js');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const offlineCard = read('components/settings/OfflineReadyCard.tsx');

  it('panel thanh toán desktop ẩn trên mobile, thay bằng thanh ghim + sheet', () => {
    assert.match(pos, /id="pos-payment-panel"[\s\S]{0,80}?className="hidden lg:flex/);
    assert.match(pos, /id="btn-pos-mobile-payment"/);
    assert.match(pos, /<MobilePaymentSheet/);
    // 2026-09: dock có 3 nhánh — bán / nhập kho / xuất vật tư công trình (tab POS "Xuất CT").
    assert.match(
      pos,
      /onPrimaryAction=\{\s*isImportFlow\s*\n?\s*\?\s*handleImportCommit\s*\n?\s*:\s*isProjectFlow\s*\n?\s*\?\s*handleProjectExportCommit\s*\n?\s*:\s*\(\) => setIsMobilePaymentOpen\(true\)/
    );
    // 2 luồng dòng hàng (nhập/xuất CT) đều mở bảng tương ứng, không mở sheet giỏ bán
    assert.match(pos, /isStockFlow \? \(isProjectFlow \? projLines\.length : impLines\.length\)/);
    assert.match(pos, /open=\{isMobileCartOpen && !isStockFlow\}/);
  });

  it('sheet thanh toán có đủ phương thức, tiền khách đưa và nút thu tiền', () => {
    assert.match(pay, /aria-label="Thanh toán"/);
    assert.match(pay, /Tiền mặt/);
    assert.match(pay, /VietQR/);
    assert.match(pay, /Quẹt thẻ/);
    assert.match(pay, /Ghi nợ/);
    assert.match(pay, /id="mobile-payment-tendered-input"/);
    assert.match(pay, /id="btn-pos-mobile-payment-confirm"/);
    assert.match(pay, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it('SheetShell là bottom sheet trên mobile, hộp thoại trên desktop', () => {
    assert.match(shell, /fixed inset-0 z-50 flex items-end sm:items-center/);
    assert.match(shell, /sm:rounded-xl rounded-t-2xl/);
    assert.match(shell, /max-h-\[92dvh\]/);
  });

  it('modal danh mục + trả nợ dùng chung SheetShell (không còn overlay copy-paste)', () => {
    assert.match(sup, /<SheetShell/);
    assert.match(sup, /label="Phiếu chi trả nợ nhà cung cấp"/);
    assert.doesNotMatch(sup, /fixed inset-0 z-50 bg-slate-900\/50 flex items-center justify-center/);
    assert.match(cus, /<SheetShell/);
    assert.doesNotMatch(cus, /fixed inset-0 z-50 bg-slate-900\/60 backdrop-blur-xs/);
    assert.match(pro, /<SheetShell/);
    assert.match(addPro, /<SheetShell/);
  });

  it('quét mã vạch: BarcodeDetector + fallback nhập tay, camera được tắt khi đóng', () => {
    assert.match(scanner, /getUserMedia/);
    assert.match(scanner, /BarcodeDetector/);
    assert.match(scanner, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
    assert.match(scanner, /id="barcode-manual-input"/);
    assert.match(search, /id="btn-pos-scan-barcode"/);
    assert.match(search, /p\.barcode \|\| ''\)\.trim\(\)\.toLowerCase\(\) === normalized/);
  });

  it('PWA: service worker cache shell + manifest có icon maskable & shortcut', () => {
    assert.match(sw, /const CACHE = 'multipos-v213-1'/);
    assert.match(sw, /SHELL_URL = '\/'/);
    assert.match(sw, /caches\.match\(SHELL_URL\)/);
    assert.ok(existsSync(join(ROOT, 'public/icons/icon-maskable.svg')));
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
    assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);
  });

  it('shortcut /?screen= mở thẳng phân hệ tương ứng', () => {
    assert.match(store, /URLSearchParams\(window\.location\.search\)\.get\('screen'\)/);
  });

  it('Cài đặt có card trạng thái offline (cache catalog + SW + cài app)', () => {
    assert.match(offlineCard, /db\.products\.count\(\)/);
    assert.match(offlineCard, /navigator\.serviceWorker\.getRegistration\(\)/);
    assert.match(offlineCard, /beforeinstallprompt/);
    assert.match(offlineCard, /id="btn-check-app-update"/);
  });

  it('báo bản mới theo SHA deploy (không phụ thuộc sw.js đổi hay không)', () => {
    // Mỗi push = deploy mới nhưng sw.js hiếm khi đổi -> banner cũ không bao giờ hiện.
    // API trả SHA commit lúc build, client so với lần đầu, khác = báo banner chung.
    const route = read('app/api/version/route.ts');
    assert.match(route, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
    const pwa = read('components/PwaRegister.tsx');
    assert.match(pwa, /fetch\('\/api\/version', \{ cache: 'no-store' \}\)/);
    assert.match(pwa, /sha !== firstShaRef\.current/);
    assert.match(pwa, /dismissedShaRef\.current = latestShaRef\.current/);
  });
});

describe('Giai đoạn 4: icon PWA + in điện thoại + bàn phím + record list giá/KH', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const print = read('lib/print.ts');
  const excel = read('lib/excel.ts');
  const receipt = read('components/pos/ReceiptModal.tsx');
  const search = read('components/pos/ProductSearchBar.tsx');
  const pro = read('components/products/ProductsView.tsx');
  const cus = read('components/customers/CustomersView.tsx');

  it('manifest có icon PNG 192/512 + maskable, script sinh icon tồn tại', () => {
    for (const file of ['public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/icon-maskable-512.png']) {
      assert.ok(existsSync(join(ROOT, file)), `thiếu ${file}`);
    }
    assert.ok(existsSync(join(ROOT, 'scripts/generate-pwa-icons.mjs')));
    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable' && i.type === 'image/png'));
  });

  it('in từ điện thoại: helper tab in + nút trên phiếu, không đụng đường in desktop', () => {
    assert.match(print, /export function printElementInTab/);
    assert.match(print, /export function openPrintableTab/);
    assert.match(print, /window\.open\(url, '_blank'\)/);
    assert.match(print, /Đang tải hình…/, 'phải chờ ảnh QR trước khi cho in');
    assert.match(receipt, /id="btn-print-receipt-mobile"/);
    assert.match(receipt, /printElementInTab\(area/);
    assert.match(receipt, /id="btn-print-receipt"/, 'giữ nguyên nút in desktop');
    assert.match(excel, /if \(isMobileViewport\(\)\) \{\n\s+const preview = html\.replace/);
    assert.match(excel, /printDocumentViaIframe\(html\);/);
  });

  it('chế độ bàn phím: bật/tắt được, tự thêm hàng khi gõ nhanh, nhớ trên máy', () => {
    assert.match(search, /id="btn-pos-wedge-mode"/);
    assert.match(search, /multipos_wedge_mode/);
    assert.match(search, /handleQueryChange/);
    assert.match(search, /wedgeTimerRef\.current = window\.setTimeout/);
  });

  it('bảng giá + khách hàng có record list mobile, bảng ngang ẩn trên mobile', () => {
    assert.match(pro, /id="product-record-list" className="lg:hidden/);
    assert.match(pro, /id="products-view" className="[^"]*h-full[^"]*min-h-0/);
    assert.doesNotMatch(pro, /100dvh/);
    assert.match(cus, /id="customer-record-list" className="lg:hidden/);
    assert.match(cus, /aria-label="Chi tiết khách hàng"/);
    assert.match(cus, /hidden md:flex w-full md:w-96/);
    assert.doesNotMatch(cus, /100dvh/);
  });
});
