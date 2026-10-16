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

describe('POS: giỏ hiện thẳng trong trang trên mobile (không sheet tách rời)', () => {
  const pos = read('components/pos/POSScreen.tsx');

  it('bảng giỏ bán chỉ hiện từ lg trở lên', () => {
    assert.match(pos, /hidden lg:block border border-slate-200 rounded-lg overflow-hidden shadow-2xs/);
  });

  it('record list giỏ hiện thẳng dưới lg, cùng id ổn định cho e2e', () => {
    assert.match(pos, /id="cart-record-list"[\s\S]{0,120}className="lg:hidden/);
    assert.doesNotMatch(pos, /id="btn-pos-mobile-cart-summary"/);
  });

  it('dòng giỏ inline sửa được SL / quy cách / xóa (dùng lại callback giỏ sẵn có)', () => {
    assert.match(pos, /onCommit=\{\(value\) => updateCartItem\(item\.id, \{ quantity: value \}\)\}/);
    assert.match(pos, /onClick=\{\(\) => removeCartItem\(item\.id\)\}/);
    assert.match(pos, /onClick=\{\(\) => setDimensionModalItem\(\{ item \}\)\}/);
    assert.match(pos, /allowDecimal=\{allowsDecimalQty\(productById\(item\.product_id\)\)\}/);
  });

  it('list giỏ mobile có nhãn SL/CK nhìn thấy được (không chỉ aria-label)', () => {
    // Bảng desktop có header "SL / Diện tích" + "CK (%)"; list mobile không có header
    // nên ô nhập phải có nhãn chữ, nếu không người mới không biết gõ gì vào.
    assert.match(pos, /uppercase text-slate-400">SL</);
    assert.match(pos, /uppercase text-slate-400">CK</);
  });

  it('giỏ có lề dưới đều với lề hông, khung trắng vẫn kéo đầy chiều cao', () => {
    assert.match(pos, /id="cart-table-container" className="flex-1 min-h-0 overflow-auto p-2"/);
    // pb-0 từng làm đáy giỏ áp sát thanh ghim -> lề dưới lệch 3 cạnh còn lại.
    assert.doesNotMatch(pos, /id="cart-table-container" className="[^"]*pb-0/);
    assert.doesNotMatch(pos, /id="cart-record-list"[\s\S]{0,200}mb-2/);
    // Giỏ ít dòng: khung list trắng kéo đầy chiều cao, phần thừa hiện trắng thay vì nền xám.
    assert.match(pos, /id="cart-record-list"[\s\S]{0,200}className="lg:hidden min-h-full bg-white/);
  });

  it('3 luồng chung 1 khung mobile (bán/nhập/xuất CT không lệch)', () => {
    // Khung chứa đều cuộn trong (min-h-0) + lề p-2 cả 4 cạnh như nhau.
    for (const id of ['cart-table-container', 'import-table-container', 'project-table-container']) {
      assert.match(pos, new RegExp(`id="${id}" className="flex-1 min-h-0 overflow-auto p-2"`));
    }
    // List mobile cùng pattern: trắng kéo đầy + bo xl (đếm đủ 3).
    const lists = pos.match(/lg:hidden min-h-full bg-white divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden/g) || [];
    assert.equal(lists.length, 3);
  });

  it('không còn sheet giỏ tách rời (file đã xóa, không còn state mở sheet)', () => {
    assert.ok(!existsSync(join(ROOT, 'components/pos/MobileCartSheet.tsx')), 'file sheet phải bị xóa');
    assert.doesNotMatch(pos, /MobileCartSheet/);
    assert.doesNotMatch(pos, /isMobileCartOpen/);
  });

  it('nút Giỏ trên dock (tablet) cuộn tới danh sách giỏ trong trang', () => {
    assert.match(pos, /getElementById\(\s*isProjectFlow \? 'project-table-container' : isImportFlow \? 'import-table-container' : 'cart-record-list'\s*\)/);
    assert.match(pos, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  });
});

describe('Điện thoại (< 768px): khóa POS, không bottom nav / dock / menu phân hệ', () => {
  const page = read('app/page.tsx');

  it('có hook useIsPhone theo breakpoint md', () => {
    assert.ok(existsSync(join(ROOT, 'hooks/useIsPhone.ts')), 'thiếu hooks/useIsPhone.ts');
    assert.match(read('hooks/useIsPhone.ts'), /max-width: 767px/);
  });

  it('page ép màn POS trên điện thoại, chỉ chừa đường vào Chấm công', () => {
    assert.match(page, /const effectiveScreen: ActiveScreen = isPhone \? \(currentScreen === 'attendance' \? 'attendance' : 'pos'\) : currentScreen;/);
    assert.ok(!/\{currentScreen === 'pos' && <POSScreen/.test(page), 'còn render theo currentScreen thô');
  });

  it('bottom nav + dock chỉ hiện trên tablet (md -> lg), ẩn trên điện thoại', () => {
    const nav = read('components/MobileBottomNav.tsx');
    assert.match(nav, /hidden md:block lg:hidden fixed inset-x-0 bottom-0/);
    const dock = read('components/pos/MobilePOSDock.tsx');
    assert.match(dock, /hidden md:block lg:hidden fixed inset-x-0 bottom-0/);
  });

  it('menu phân hệ không mở trên điện thoại + nút menu/header ẩn', () => {
    const flyout = read('components/FlyoutMenu.tsx');
    assert.match(flyout, /if \(!flyoutMenuOpen \|\| isPhone\) return null;/);
    const header = read('components/GlobalHeader.tsx');
    assert.match(header, /max-md:hidden flex h-9/);
  });

  it('thanh toán ghim cố định đáy điện thoại thay dock', () => {
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40/);
  });

  it('điện thoại không tự mở phiếu sau bán (coi như tắt in tự động)', () => {
    const checkout = read('lib/store/tx/checkout.tsx');
    assert.match(checkout, /const isPhone = useIsPhone\(\);/);
    assert.match(checkout, /if \(shop\.autoPrint !== false && !isPhone\) \{/);
  });

  it('điện thoại tắt hẳn in: mọi nút in ẩn dưới md, tablet/desktop giữ', () => {
    const receipt = read('components/pos/ReceiptModal.tsx');
    assert.match(receipt, /id="btn-print-receipt-mobile"[\s\S]{0,400}hidden md:flex lg:hidden/);
    assert.match(receipt, /id="btn-print-receipt"[\s\S]{0,300}hidden lg:flex/);
    const tools = read('components/common/TableTools.tsx');
    assert.match(tools, /text-slate-600 hover:bg-slate-100 font-medium hidden md:flex items-center/);
    // Xuất Excel không phải in -> giữ nguyên trên mọi khổ màn.
    assert.match(tools, /text-emerald-700 hover:bg-emerald-50 font-medium flex items-center/);
    const orders = read('components/orders/OrdersView.tsx');
    assert.match(orders, /hidden md:flex items-center gap-1\.5 shadow-2xs/);
  });

  it('nhập kho / xuất vật tư chỉ còn trên tablet+desktop, điện thoại bỏ hẳn', () => {
    const pos = read('components/pos/POSScreen.tsx');
    // Điện thoại (<768px) ép luồng về 'sale' ngay ở render; posFlow trong store vẫn nguyên
    // để xoay sang tablet/desktop là quay lại đúng luồng đang làm.
    assert.match(pos, /const flow = isPhone \? 'sale' : posFlow;/);
    // Thanh ghim đáy "Nhập kho / Xuất vật tư" chỉ render dưới md = điện thoại -> đã bỏ.
    assert.doesNotMatch(pos, /id="btn-pos-mobile-stock-action"/);
    assert.doesNotMatch(pos, /md:hidden fixed inset-x-0 bottom-0 z-40/);
    // Panel desktop (lg) vẫn giữ nút ghim đáy của 2 luồng nhập/xuất.
    assert.match(pos, /isStockFlow \? 'overflow-hidden' : 'overflow-y-auto'/);
    assert.match(pos, /className="flex-1 min-h-0 overflow-y-auto space-y-3"/);
    assert.match(pos, /className="shrink-0 pt-3 border-t border-slate-200 space-y-2"/);
  });

  it('thanh nút bán hàng nằm trong luồng như nút nhập kho (không ghim sticky)', () => {
    const css = read('app/globals.css');
    assert.doesNotMatch(css, /#pos-bottom-bar\s*\{/);
  });

  it('cụm luồng Bán/Nhập/Xuất CT ẩn trên điện thoại, header mobile còn 1 dòng tìm hàng', () => {
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /\{canImport && !isPhone && \(/);
    assert.doesNotMatch(pos, /max-md:flex-1 max-md:grid max-md:grid-cols-3/);
    // 3 cột [search | tabs | controls] chỉ từ md; dưới md (điện thoại) ô tìm full-width.
    assert.match(pos, /id="pos-goods-toolbar"[\s\S]{0,220}grid grid-cols-1 md:grid-cols-\[minmax\(0,50%\)_minmax\(0,1fr\)_auto\]/);
  });

  it('điện thoại bán 1 đơn: dải tab hóa đơn + nút thêm tab ẩn dưới md', () => {
    const pos = read('components/pos/POSScreen.tsx');
    assert.match(pos, /id="order-tabs-group"[\s\S]{0,200}className="hidden md:flex/);
    // Nút + và store đa tab vẫn giữ cho desktop (tối đa 3 tab).
    assert.match(pos, /id="btn-new-tab"/);
    assert.match(read('lib/store/tx/cart.tsx'), /if \(cartTabs\.length >= 3\)/);
  });

  it('vùng đệm đáy POS vừa khít thanh ghim điện thoại (không dải xám thừa)', () => {
    const css = read('app/globals.css');
    // Tablet giữ 5.5rem (còn chỗ cho dock cố định); điện thoại override vừa thanh ghim.
    assert.match(css, /\.pos-mobile-bottom-space \{\s*\n\s*padding-bottom: calc\(5\.5rem \+ env\(safe-area-inset-bottom\)\);/);
    assert.match(css, /@media \(max-width: 767px\)[\s\S]{0,300}\.pos-mobile-bottom-space/);
    assert.match(css, /padding-bottom: max\(4rem, calc\(3\.5rem \+ env\(safe-area-inset-bottom\)\)\);/);
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

  it('toolbar POS đã bỏ 2 nút quét mã/bàn phím cho rộng chỗ (giữ component để dùng lại)', () => {
    const bar = read('components/pos/ProductSearchBar.tsx');
    assert.match(bar, /export function useSearchTools\(\): SearchTools/);
    assert.match(bar, /export function SearchToolButtons\(\{ tools \}/);
    const pos = read('components/pos/POSScreen.tsx');
    assert.doesNotMatch(pos, /<SearchToolButtons tools=\{searchTools\} \/>/);
    assert.match(pos, /externalTools=\{searchTools\}\s*\n?\s*hideTools/);
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

  it('kho chỉ còn record list thẻ kho, bảng ẩn trên mobile', () => {
    assert.ok(!/id="stock-record-list"/.test(inv), 'còn record list tồn đã bỏ');
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
    assert.match(pos, /id="pos-payment-panel"[\s\S]{0,100}?className=\{`hidden lg:flex/);
    assert.match(pos, /id="btn-pos-mobile-payment"/);
    assert.match(pos, /<MobilePaymentSheet/);
    // 2026-09: dock có 3 nhánh — bán / nhập kho / xuất vật tư công trình (tab POS "Xuất CT").
    assert.match(
      pos,
      /onPrimaryAction=\{\s*isImportFlow\s*\n?\s*\?\s*handleImportCommit\s*\n?\s*:\s*isProjectFlow\s*\n?\s*\?\s*handleProjectExportCommit\s*\n?\s*:\s*\(\) => setIsMobilePaymentOpen\(true\)/
    );
    // 2 luồng dòng hàng (nhập/xuất CT) đều mở bảng tương ứng, không mở sheet giỏ bán
    assert.match(pos, /isStockFlow \? \(isProjectFlow \? projLines\.length : impLines\.length\)/);
    assert.doesNotMatch(pos, /open=\{isMobileCartOpen/);
  });

  it('panel desktop đúng 3 phương thức, không còn Quẹt thẻ', () => {
    assert.match(pos, /id="pos-payment-methods" className="grid grid-cols-3 gap-1"/);
    assert.doesNotMatch(pos, /id="payment-method-card"/);
    assert.doesNotMatch(pos, /Quẹt thẻ/);
    assert.match(pos, /<span>Chuyển khoản<\/span>/);
  });

  it('sheet thanh toán đúng 3 phương thức (Tiền mặt/Chuyển khoản/Ghi nợ), tiền khách đưa và nút thu tiền', () => {
    assert.match(pay, /aria-label="Thanh toán"/);
    assert.match(pay, /Tiền mặt/);
    assert.match(pay, /Chuyển khoản/);
    assert.match(pay, /Ghi nợ/);
    assert.doesNotMatch(pay, /Quẹt thẻ/);
    assert.match(pay, /id="mobile-payment-tendered-input"/);
    assert.match(pay, /id="btn-pos-mobile-payment-confirm"/);
    assert.match(pay, /pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  it('sheet mobile đổi được khách hàng (bỏ chọn về khách lẻ, không đơ)', () => {
    // Bug: nút Đổi chỉ setCustomerQuery('') trong khi selectedCustomer còn set ->
    // hộp xanh đứng yên, bấm mãi không chọn lại được.
    assert.match(pay, /onClearCustomer: \(\) => void/);
    assert.doesNotMatch(pay, /onClick=\{\(\) => setCustomerQuery\(''\)\}/);
    assert.match(pay, /focusSearchRef\.current = true;[\s\S]{0,80}onClearCustomer\(\)/);
    // Danh sách hiện ngay cả khi chưa gõ (top 20) + luôn có mục khách lẻ đầu danh sách.
    assert.doesNotMatch(pay, /customerQuery\.trim\(\) !== '' && \(\s*\n\s*<div id="mobile-payment-customer-list"/);
    assert.match(pay, /id="mobile-payment-customer-list"[\s\S]{0,900}Không lưu hồ sơ · không cộng nợ/);
    assert.match(pos, /onClearCustomer=\{\(\) => pickCustomer\(/);
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

  it('chip version CalVer tu dong (ngay build + SHA, khong sua tay)', () => {
    // scripts/gen-build-info.cjs sinh public/build-info.json mỗi lần build
    const gen = read('scripts/gen-build-info.cjs');
    assert.match(gen, /build-info\.json/);
    assert.match(gen, /VERCEL_GIT_COMMIT_SHA/);
    assert.match(gen, /git rev-parse --short HEAD/);
    assert.match(gen, /Asia\/Ho_Chi_Minh/);
    // next.config.ts gọi generator (mọi Build Command đều qua đây)
    assert.match(read('next.config.ts'), /gen-build-info\.cjs/);
    assert.match(read('next.config.ts'), /genBuildInfo\(\)/);
    // route trả cả sha + date cho chip
    const route = read('app/api/version/route.ts');
    assert.match(route, /build-info\.json/);
    assert.match(route, /NextResponse\.json\(\{ sha, date \}\)/);
    // header không còn số gán cứng, chip đọc từ API + cache local
    const header = read('components/GlobalHeader.tsx');
    assert.ok(!/v2\.14/.test(header), 'header còn số version gán cứng');
    assert.match(header, /BuildVersionChip/);
    assert.match(header, /fetch\('\/api\/version', \{ cache: 'no-store' \}\)/);
    assert.match(header, /multipos_build_info/);
    // tên app cài đặt + file sinh không mang version
    assert.ok(!/v2\.14/.test(read('public/manifest.webmanifest')), 'manifest còn version cũ');
    assert.match(read('.gitignore'), /public\/build-info\.json/);
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

describe('Modal kính F3 trên điện thoại: thẻ dòng thay bảng ngang', () => {
  const dim = read('components/pos/DimensionModalF3.tsx');

  it('bảng 10 cột chỉ dành cho desktop, mobile dùng thẻ dòng', () => {
    assert.match(dim, /<div className="hidden lg:block">/);
    assert.match(dim, /id="dimension-mobile-cards" className="lg:hidden/);
    // DOM bảng đứng trước để e2e [data-dim-col].first() trên desktop vẫn trúng ô đang hiện.
    assert.ok(dim.indexOf('<table') < dim.indexOf('dimension-mobile-cards'));
  });

  it('thẻ gọn: Dài/Rộng/SL chung 1 hàng, phụ phí full hàng, số liệu gộp lên đầu thẻ', () => {
    assert.match(dim, /grid grid-cols-3 gap-1\.5/);
    assert.match(dim, /Tấm \{index \+ 1\}[\s\S]{0,400}actual_m2\)\} m2 · \{formatNumber\(row\.processing_fee\)\}/);
    // Chu vi chi tiết dọn khỏi thẻ (vẫn còn ở ô tổng hợp) để thẻ lùn.
    assert.doesNotMatch(dim, /CV \{formatQty\(row\.perimeter_md\)\}/);
    assert.match(dim, /data-dim-col="length"[\s\S]{0,1500}data-dim-col="width"[\s\S]{0,1500}data-dim-col="quantity"[\s\S]{0,1500}data-dim-col="extra"/);
    assert.match(dim, /onKeyDown=\{handleCellEnter\}/);
    assert.match(dim, /h-11 px-2/);
  });

  it('Enter nhảy ô chỉ tính ô đang hiện (layout ẩn display:none không focus được)', () => {
    assert.match(dim, /getClientRects\(\)\.length > 0/);
  });

  it('header + toolbar + nút xác nhận gọn trên điện thoại', () => {
    assert.match(dim, /KÍCH THƯỚC & DIỆN TÍCH \(F3\)/);
    assert.match(dim, /text-\[13px\] sm:text-base font-bold text-white truncate/);
    assert.match(dim, /flex flex-wrap items-center gap-x-2/);
    // Gợi ý phím Enter là cho bàn phím cứng -> ẩn trên điện thoại.
    assert.match(dim, /text-\[11px\] text-amber-800 italic hidden sm:flex/);
    // Nút xác nhận chỉ hiện chữ dài từ sm trở lên.
    assert.match(dim, /XÁC NHẬN<span className="hidden sm:inline"> CẬP NHẬT \(Ctrl\+Enter\)<\/span>/);
    // Thanh mài gọn 1 hàng: nhãn rút gọn trên mobile, select giãn hết cỡ.
    assert.match(dim, /Mài:[\s\S]{0,20}<\/span>/);
    assert.match(dim, /id="batch-grinding-select"[\s\S]{0,200}className="flex-1 min-w-0"/);
    // Ô chọn không ép min-width theo nhãn dài nhất -> hết tràn màn hình hẹp.
    const fc = read('components/ui/FilterControls.tsx');
    assert.match(fc, /noAutoWidth\?: boolean/);
    assert.match(dim, /id="batch-grinding-select"[\s\S]{0,200}noAutoWidth/);
  });
});

describe('Chấm công trên điện thoại (0085): quản lý chấm theo NGÀY, NV chỉ xem công mình', () => {
  const page = read('app/page.tsx');
  const header = read('components/GlobalHeader.tsx');
  const flyout = read('components/FlyoutMenu.tsx');
  const hrm = read('components/hrm/HRMView.tsx');
  const mgr = read('components/hrm/mobile/AttendanceMobileManager.tsx');
  const sheet = read('components/hrm/mobile/AttendanceDaySheet.tsx');
  const mine = read('components/hrm/mobile/MyAttendanceView.tsx');
  const sql = read('supabase/migrations/0085_hrm_self_visibility.sql');
  const desktopGrid = read('components/hrm/tabs/AttendanceTab.tsx');

  it('điện thoại whitelist đúng 2 màn: POS + attendance (khớp test page ở trên)', () => {
    // Không reserve đáy cho nav trên điện thoại (chấm công không có bottom bar)
    assert.match(page, /effectiveScreen === 'pos' \|\| isPhone \? '' : 'mobile-main-bottom-space'/);
  });

  it('điểm vào là nút header riêng cho điện thoại + có đường về Bán hàng', () => {
    assert.match(header, /id="header-attendance-btn"/);
    assert.match(header, /id="header-attendance-btn"[\s\S]{0,160}md:hidden/);
    assert.match(header, /onClick=\{\(\) => setCurrentScreen\('attendance'\)\}/);
    assert.match(mgr, /id="btn-att-mobile-back"[\s\S]{0,200}setCurrentScreen\('pos'\)/);
    assert.match(mine, /id="btn-att-mobile-back"/);
  });

  it('menu phân hệ ẩn "Quản lý nhân sự" với thu ngân/worker (khớp Alt+T blockRestricted)', () => {
    assert.match(flyout, /\/\/ 0085: RLS chỉ cho nhân viên thường đọc dữ liệu của chính họ/);
    assert.match(flyout, /\.\.\.\(!isRestricted\n\s*\? \[\{ screen: 'hr' as const, label: 'Quản lý nhân sự'/);
  });

  it('HRMView rẽ nhánh theo vai trò + khổ màn, giữ markDay/clearDay làm đường ghi', () => {
    assert.match(hrm, /if \(!isManager\) \{\n\s*return <MyAttendanceView/);
    assert.match(hrm, /if \(isPhone\) \{\n\s*return \(\n\s*<AttendanceMobileManager/);
    assert.match(hrm, /onMark=\{markDay\}/);
    assert.match(hrm, /onClear=\{clearDay\}/);
    // Desktop/tablet vẫn còn lưới 31 cột (mobile không thay thế bàn làm việc)
    assert.match(desktopGrid, /role="grid"/);
  });

  it('màn quản lý: dải ngày + record list + chấm nhanh cả ngày, không có lưới ngang', () => {
    assert.match(mgr, /id="att-mobile-day-strip"/);
    assert.match(mgr, /id="att-mobile-record-list"[\s\S]{0,80}bg-white divide-y divide-slate-100/);
    assert.match(mgr, /id="btn-att-fill-day"/);
    assert.match(mgr, /await confirmDialog\(`Chấm "Đi làm" cho \$\{missing\.length\} người/);
    assert.match(mgr, /attendanceModeOf\(e\) === 'normal'/, 'diện miễn chấm công không lên danh sách');
    assert.doesNotMatch(mgr, /role="grid"/);
    // Lề dưới đều lề hông như các list mobile khác (p-2, không pb-0)
    assert.match(mgr, /className="flex-1 min-h-0 overflow-auto p-2"/);
  });

  it('bar trên điện thoại không được cuộn ngang (nút "Hôm nay" phải luôn bấm được ở 390px)', () => {
    const barStart = mgr.indexOf('shrink-0 h-12 px-2');
    const bar = mgr.slice(barStart, mgr.indexOf('att-mobile-day-strip', barStart));
    assert.ok(bar.length > 0 && bar.length < 4000, 'không tìm thấy bar tiêu đề màn chấm công');
    assert.doesNotMatch(bar, /overflow-x-auto/, 'bar để cuộn ngang là nút cuối bị đẩy tràn màn hình');
    assert.match(bar, /<h2 className="flex min-w-0/, 'tiêu đề phải co bằng truncate, không đẩy nút ra ngoài');
    assert.match(bar, /ml-auto flex shrink-0 items-center/, 'cụm tháng + Hôm nay luôn shrink-0');
  });

  it('dải ngày tự cuộn tới ngày đang chọn (bấm "Hôm nay" / chuyển tháng là ô đó vào giữa)', () => {
    assert.match(mgr, /const stripRef = useRef<HTMLDivElement>\(null\);/);
    assert.match(mgr, /dayRefs = useRef\(new Map<string, HTMLButtonElement>\(\)\)/);
    assert.match(mgr, /strip\.scrollTo\(\{ left: btn\.offsetLeft - \(strip\.clientWidth - btn\.offsetWidth\) \/ 2, behavior: 'smooth' \}\)/);
    assert.match(mgr, /\}, \[iso, monthKey\]\);/, 'effect phải chạy khi đổi ngày lẫn đổi tháng');
    assert.match(mgr, /ref=\{stripRef\}/);
    assert.match(mgr, /dayRefs\.current\.set\(d\.iso, el\)/);
  });

  it('sheet chấm 1 ngày: 5 trạng thái >=44px, 1 nút Lưu, có OT + ghi chú', () => {
    assert.match(sheet, /ATTENDANCE_STATUS_ORDER\.map/);
    assert.match(sheet, /className=\{`flex h-14 flex-col/);
    assert.match(sheet, /id="btn-att-mark-submit"/);
    assert.match(sheet, /onMark\(\{ employee_id: employee\.id, work_date: iso, status, ot_hours: ot, note/);
    assert.match(sheet, /SheetShell open onClose=\{onClose\}/);
    assert.match(sheet, /disabled=\{busy \|\| locked\}/, 'tháng đã chốt thì không ghi được');
    assert.doesNotMatch(sheet, /supa\./, 'sheet không tự ghi server, đi qua markDay');
  });

  it('màn nhân viên thường: chỉ xem — không callback ghi, không lộ lương người khác', () => {
    const mineCode = mine
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    assert.match(mine, /id="my-attendance-view"/);
    assert.match(mine, /employees\.find\(\(e\) => e\.user_id && e\.user_id === user\?\.id\)/);
    for (const forbidden of ['markDay', 'clearDay', 'onMark', 'onClear', 'supa.', 'daily_wage', 'monthly_salary', 'net', 'advance']) {
      assert.ok(!mineCode.includes(forbidden), `MyAttendanceView không được chạm quyền ghi / số lương: ${forbidden}`);
    }
    assert.match(mine, /grid grid-cols-7/);
    assert.match(mine, /nhờ Quản lý bổ sung/);
  });

  it('migration 0085: SELECT HRM lọc theo auth.uid()/my_employee_id(), giữ nguyên policy ghi', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/0085_hrm_self_visibility.sql')), 'thiếu 0085');
    const code = sql
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n');
    assert.match(code, /create or replace function public\.my_employee_id\(\)/);
    assert.match(code, /language sql stable security definer set search_path = public/);
    assert.match(code, /revoke all on function public\.my_employee_id\(\) from public, anon;/);
    assert.match(code, /grant execute on function public\.my_employee_id\(\) to authenticated;/);
    assert.match(code, /create policy "employees_select"[\s\S]{0,120}using \(public\.is_manager\(\) or user_id = auth\.uid\(\)\)/);
    for (const [tbl, re] of [
      ['attendance_days', /create policy "attendance_select" on public\.attendance_days[\s\S]{0,140}using \(public\.is_manager\(\) or employee_id = public\.my_employee_id\(\)\)/],
      ['payroll_items', /create policy "payroll_items_select" on public\.payroll_items[\s\S]{0,140}using \(public\.is_manager\(\) or employee_id = public\.my_employee_id\(\)\)/],
      ['salary_advances', /create policy "advances_select" on public\.salary_advances[\s\S]{0,140}using \(public\.is_manager\(\) or employee_id = public\.my_employee_id\(\)\)/],
    ]) {
      assert.match(code, re, `policy SELECT của ${tbl} phải lọc theo my_employee_id()`);
    }
    assert.match(code, /create policy "payroll_runs_select"[\s\S]{0,120}using \(public\.is_manager\(\)\)/);
    assert.ok(!/for all to authenticated/.test(code), '0085 chỉ đổi SELECT, không đụng policy ghi đang chạy');
    assert.ok(!/delete from|update public\./i.test(code), '0085 không sửa dữ liệu');
  });
});
