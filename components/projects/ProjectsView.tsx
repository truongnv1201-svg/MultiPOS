'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Project, ProjectMaterial, ProjectWorker } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Building2,
  Plus,
  ArrowRight,
  Boxes,
  Users,
  Hammer,
  Trash2,
  X,
  HardHat,
  Search,
  Phone,
  MapPin,
  CalendarDays,
  Wallet,
  Banknote,
  PieChart,
  Pencil,
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { NumberInput } from '@/components/common/NumberInput';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { notify } from '@/components/common/Toast';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';

const EMPTY_PROJECT_MATERIALS: ProjectMaterial[] = [];
const EMPTY_PROJECT_WORKERS: ProjectWorker[] = [];

/** Ngày dd/MM/yyyy từ chuỗi ISO; chuỗi rác hoặc thiếu -> trả về '—' thay vì "Invalid Date". */
function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN');
}

export function ProjectsView() {
  const { projects, customers, cashbook, addProject, updateProject, deleteProject, products, employees, addProjectWorker, removeProjectLine, updateProjectFinance, collectProjectDeposit, syncProjects, isOnline, setPosFlow, setPosProjectId, setCurrentScreen, profile } = useStore();
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null);
  // Ô tìm kiếm của cột danh sách (lọc theo tên / mã HĐ / chủ nhà / địa chỉ)
  const [projectQuery, setProjectQuery] = useState('');

  /** Xuất vật tư nằm trong POS và chỉ Admin/Quản lý vào được (giống tab "Xuất CT"). */
  const canExportMaterials = !profile || profile.role === 'admin' || profile.role === 'manager';
  /** Xoá dự án là phá huỷ (dù server có hoàn kho) nên chỉ Admin/Quản lý thấy nút.
      Server chặn lần 2 bằng is_manager() nên gọi trực tiếp cũng không lọt. */
  const canDeleteProject = !profile || profile.role === 'admin' || profile.role === 'manager';

  /** Mở thẳng màn POS ở tab "Xuất CT" với công trình hiện tại đã chọn sẵn. */
  const goToProjectExport = (project: Project) => {
    setPosProjectId(project.id);
    setPosFlow('project');
    setCurrentScreen('pos');
  };

  // Bảng projects KHÔNG nằm trong publication realtime (0049 chỉ có 10 bảng nghiệp vụ) và
  // cũng không có trong TABLE_REFRESH, nên syncProjects trước đây chỉ chạy lúc đăng nhập /
  // vào lại mạng. Hệ quả thật: sửa hoặc tạo dự án ở máy khác thì máy này không thấy tới
  // khi tải lại trang, và người dùng không có đường nào để biết là dữ liệu cũ.
  // Gọi lại khi mở màn + khi vào lại mạng, đúng như HRMView gọi refreshHrm().
  useEffect(() => {
    if (!isOnline) return;
    syncProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // New project modal
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [name, setName] = useState('');
  // Chọn KH có sẵn (link customer_id) hoặc gõ tên chủ đầu tư mới (allowCustom)
  const [customerPick, setCustomerPick] = useState('');
  const [address, setAddress] = useState('');
  const [estimatedRevenue, setEstimatedRevenue] = useState(0);
  const [skipEstimate, setSkipEstimate] = useState(false);

  // ---- 0066: Sửa thông tin dự án (tạo sai tên/chủ đầu tư/địa chỉ) ----
  // Tách khỏi modal tạo mới để không lẫn state; chỉ sửa 3 trường định danh, số tiền
  // sửa ở modal tài chính. Mở modal là seed từ currentProject, lưu qua updateProject
  // (đường đẩy server có sẵn — không cần RPC riêng vì đây là sửa thông tin, không
  // đụng tồn kho/tiền).
  const [isEditInfoOpen, setIsEditInfoOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCustomerPick, setEditCustomerPick] = useState('');
  const [editAddress, setEditAddress] = useState('');

  // Xuất vật tư -> chuyển sang màn POS (tab "Xuất CT"), modal cũ đã gỡ

  // Thêm thợ — chọn từ hồ sơ nhân sự (tự điền lương/việc), cho phép thợ ngoài
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
  const [wEmployeeId, setWEmployeeId] = useState('');
  const [wName, setWName] = useState('');
  const [wRole, setWRole] = useState('Thợ kính');
  const [wDays, setWDays] = useState(1);
  const [wWage, setWWage] = useState(500000);
  const [wAllow, setWAllow] = useState(0);
  const wPreviewTotal = Math.round(wDays * wWage + wAllow);
  const activeEmployees = (employees || []).filter((e) => e.status === 'active');
  const pickedEmployee = activeEmployees.find((e) => e.id === wEmployeeId);

  const handlePickWorker = (v: string) => {
    const emp = activeEmployees.find((e) => e.id === v);
    if (emp) {
      // Chọn từ nhân sự: link mã NV + tự điền việc/lương theo hồ sơ
      setWEmployeeId(emp.id);
      setWName(emp.full_name);
      setWRole(emp.position || 'Thợ');
      setWWage(emp.salary_type === 'daily' ? emp.daily_wage || 0 : Math.round((emp.monthly_salary || 0) / 26));
    } else {
      // Thợ ngoài (tự gõ): không link, giữ tay các ô còn lại
      setWEmployeeId('');
      setWName(v);
    }
  };

  const resetWorkerForm = () => {
    setWEmployeeId('');
    setWName('');
    setWRole('Thợ kính');
    setWDays(1);
    setWWage(500000);
    setWAllow(0);
  };


  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    const updated = await addProjectWorker(currentProject.id, {
      worker_name: wName,
      role: wRole,
      days_worked: wDays,
      daily_wage: wWage,
      allowance: wAllow,
      employee_id: wEmployeeId || undefined,
      employee_code: pickedEmployee?.code,
    });
    if (updated) {
      setSelectedProject(updated);
      setIsWorkerModalOpen(false);
      resetWorkerForm();
    }
  };

  // Modal tài chính: sửa dự toán/quyết toán/chi khác độc lập nhau
  const [isFinModalOpen, setIsFinModalOpen] = useState(false);
  const [finEstimated, setFinEstimated] = useState(0);
  const [finSettled, setFinSettled] = useState(0);
  const [finOther, setFinOther] = useState(0);

  // Modal thu cọc chủ đầu tư
  const [isDepModalOpen, setIsDepModalOpen] = useState(false);
  const [depAmount, setDepAmount] = useState(0);
  const [depMethod, setDepMethod] = useState<'cash' | 'transfer'>('cash');

  const openFinModal = () => {
    if (!currentProject) return;
    setFinEstimated(currentProject.estimated_revenue);
    setFinSettled(currentProject.settled_revenue);
    setFinOther(currentProject.other_costs);
    setIsFinModalOpen(true);
  };

  const handleSaveFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    const updated = await updateProjectFinance(currentProject.id, {
      estimated_revenue: finEstimated,
      settled_revenue: finSettled,
      other_costs: finOther,
    });
    if (updated) {
      setSelectedProject(updated);
      setIsFinModalOpen(false);
    }
  };

  const handleCollectDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    const remaining = Math.max(0, currentProject.settled_revenue - (currentProject.deposit_amount || 0));
    if (depAmount > remaining) {
      const ok = await confirmDialog(
        `Số thu ${formatVND(depAmount)} vượt số còn phải thu ${formatVND(remaining)}.\nVẫn thu?`,
        { title: 'Thu cọc/đợt', confirmLabel: 'Vẫn thu' }
      );
      if (!ok) return;
    }
    const updated = await collectProjectDeposit(currentProject.id, depAmount, depMethod);
    if (updated) {
      setSelectedProject(updated);
      setIsDepModalOpen(false);
      setDepAmount(0);
      notify(`Đã thu ${formatVND(depAmount)} cho công trình ${currentProject.code}.`, 'success');
    }
  };

  const handleRemoveLine = async (kind: 'material' | 'worker', lineKey: string, label: string) => {
    if (!currentProject) return;
    const ok = await confirmDialog(`Gỡ dòng "${label}" khỏi công trình?${kind === 'material' ? '\nVật tư sẽ hoàn lại kho.' : ''}`, {
      title: 'Gỡ dòng công trình',
      confirmLabel: 'Gỡ dòng',
      danger: true,
    });
    if (!ok) return;
    const updated = await removeProjectLine(currentProject.id, kind, lineKey);
    if (updated) setSelectedProject(updated);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Link KH có sẵn để ăn công nợ + đồng bộ server; tên gõ mới thì lưu chay
    const matchedCustomer = customers.find((c) => c.id === customerPick);
    const resolvedCustomerId = matchedCustomer ? matchedCustomer.id : '';
    const resolvedCustomerName = matchedCustomer
      ? matchedCustomer.name
      : customerPick.trim() || 'Chủ đầu tư';
    // Bỏ qua báo giá -> quyết toán = 0 (chỉ nhập sau ở modal tài chính)
    const settled = skipEstimate ? 0 : estimatedRevenue;

    const created = await addProject({
      name: name.trim(),
      customer_id: resolvedCustomerId,
      customer_name: resolvedCustomerName,
      address,
      estimated_revenue: estimatedRevenue,
      settled_revenue: settled,
      deposit_amount: 0,
      materials: [],
      workers: [],
      other_costs: 0,
      material_cost_total: 0,
      labor_cost_total: 0,
      total_cost: 0,
      actual_profit: settled,
      created_at: new Date().toISOString(),
    });

    setSelectedProject(created);
    setIsNewProjectModalOpen(false);
    setName('');
    setCustomerPick('');
    setAddress('');
    setEstimatedRevenue(0);
    setSkipEstimate(false);
  };

  // ---- 0066: Sửa thông tin + Xoá dự án ----
  const openEditInfoModal = () => {
    if (!currentProject) return;
    setEditName(currentProject.name);
    // Ưu tiên giữ link KH cũ: nếu customer_id còn trong danh mục thì chọn sẵn id,
    // không thì đổ tên chủ đầu tư vào ô để sửa tay (allowCustom giữ lại chữ gõ).
    const stillLinked = currentProject.customer_id && customers.some((c) => c.id === currentProject.customer_id);
    setEditCustomerPick(stillLinked ? (currentProject.customer_id as string) : currentProject.customer_name || '');
    setEditAddress(currentProject.address || '');
    setIsEditInfoOpen(true);
  };

  const handleSaveEditInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !editName.trim()) return;
    const matched = customers.find((c) => c.id === editCustomerPick);
    const resolvedCustomerId = matched ? matched.id : '';
    const resolvedCustomerName = matched ? matched.name : editCustomerPick.trim() || 'Chủ đầu tư';
    const patch = {
      name: editName.trim(),
      customer_id: resolvedCustomerId,
      customer_name: resolvedCustomerName,
      address: editAddress.trim(),
    };
    // updateProject trả void nhưng đã tự setProjects trong store — ở đây ghép lại object
    // mới cho selectedProject local để UI hiện ngay mà không cần đợi sync.
    await updateProject(currentProject.id, patch);
    setSelectedProject({ ...currentProject, ...patch });
    setIsEditInfoOpen(false);
    notify(`Đã cập nhật thông tin công trình ${currentProject.code}.`, 'success');
  };

  const handleDeleteProject = async (project: Project) => {
    // Liệt kê hậu quả TRƯỚC khi hỏi để không ai bấm nhầm: vật tư hoàn kho, tiền giữ lại.
    const matLines = project.materials.filter((m) => !m.is_adjust).length;
    const wasteLines = project.materials.length - matLines;
    const deposit = project.deposit_amount || 0;
    const lines = [
      `Xoá vĩnh viễn công trình ${project.code} — ${project.name}?`,
      ``,
      `• ${matLines} dòng vật tư đã xuất sẽ HOÀN VỀ KHO${wasteLines > 0 ? ` (${wasteLines} dòng hao hụt không hoàn vì chưa từng trừ kho)` : ''}`,
      `• ${project.workers.length} thợ sẽ bị gỡ khỏi công trình`,
      deposit > 0
        ? `• Đã thu ${formatVND(deposit)}: GIỮ NGUYÊN trong sổ quỹ (không xoá tiền)`
        : `• Chưa thu khoản nào nên sổ quỹ không đổi`,
      `• Không thể hoàn tác sau khi xoá`,
    ];
    const ok = await confirmDialog(lines.join('\n'), {
      title: 'Xoá dự án',
      confirmLabel: 'Xoá vĩnh viễn',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteProject(project.id);
    if (res) {
      notify(
        `Đã xoá ${res.code}: hoàn ${res.restored_lines} dòng vật tư về kho` +
          (res.unlinked_adjustments > 0 ? `, ${res.unlinked_adjustments} khoản hao hụt chuyển về kho chung` : '') +
          `.`,
        'success'
      );
      // Chọn dự án còn lại để màn hình không trống (giữ đúng thứ tự danh sách)
      const rest = projects.filter((x) => x.id !== project.id);
      setSelectedProject(rest[0] || null);
    }
  };

  // Cần sửa thủ công dữ liệu dự án thì gọi updateProject(id, updates) — không còn
  // khái niệm giai đoạn/trạng thái từ 0065 (chỉ để hiển thị, không điều khiển gì).

  const currentProject = selectedProject;

  // ---- Dữ liệu dẫn xuất cho bố cục 3 cột ----
  // Tính thẳng (không useMemo) như sortedMaterials/sortedWorkers bên dưới: quy mô danh
  // sách nhỏ, lọc và cộng chỉ chạy mỗi render — thêm memo chỉ gây cảnh báo React Compiler.

  // Danh sách đã lọc theo ô tìm kiếm của cột trái
  const visibleProjects = (() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.name, p.code, p.customer_name, p.address].some((v) => (v || '').toLowerCase().includes(q))
    );
  })();

  // SĐT chủ đầu tư tra từ danh mục KH (project chỉ lưu customer_id + tên)
  const customerPhone =
    (currentProject && currentProject.customer_id
      ? customers.find((c) => c.id === currentProject.customer_id)?.phone
      : '') || '';

  // Tiền còn phải thu + tỷ lệ đã thu (dùng cho khối tiến độ thu tiền)
  const projectRemaining = Math.max(
    0,
    currentProject ? currentProject.settled_revenue - (currentProject.deposit_amount || 0) : 0
  );
  const projectReceivedPct =
    currentProject && currentProject.settled_revenue > 0
      ? ((currentProject.deposit_amount || 0) / currentProject.settled_revenue) * 100
      : 0;

  // Lịch sử thu tiền của công trình: lấy từ sổ quỹ thật (phiếu 'deposit' trỏ mã CT).
  // Không tự chế số liệu — sổ quỹ là bản ghi dòng tiền, nếu lệch thì phải thấy được ở đây.
  const projectDeposits = currentProject
    ? cashbook
        .filter(
          (e) => e.type === 'receipt' && e.category === 'deposit' && e.reference_order_code === currentProject.code
        )
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    : [];


  // Sắp xếp 2 bảng vật tư / nhân công của công trình đang xem (bấm header để đảo chiều)
  const { sortKey: matSortKey, sortDir: matSortDir, toggleSort: toggleMatSort } = useSortState();
  const { sortKey: workerSortKey, sortDir: workerSortDir, toggleSort: toggleWorkerSort } = useSortState();
  const materials = currentProject?.materials ?? EMPTY_PROJECT_MATERIALS;
  const workers = currentProject?.workers ?? EMPTY_PROJECT_WORKERS;
  const sortedMaterials = (() => {
    if (!matSortKey) return materials;
    const getters: Record<string, (m: ProjectMaterial) => unknown> = {
      sku: (m) => m.sku,
      name: (m) => m.name,
      quantity: (m) => m.quantity,
      unit_cost: (m) => m.unit_cost,
      total_cost: (m) => m.total_cost,
    };
    const get = getters[matSortKey];
    if (!get) return materials;
    return sortRows(materials, get, matSortDir);
  })();
  const sortedWorkers = (() => {
    if (!workerSortKey) return workers;
    const getters: Record<string, (w: ProjectWorker) => unknown> = {
      worker_name: (w) => w.worker_name,
      role: (w) => w.role,
      days_worked: (w) => w.days_worked,
      daily_wage: (w) => w.daily_wage,
      allowance: (w) => w.allowance,
      total_wage: (w) => w.total_wage,
    };
    const get = getters[workerSortKey];
    if (!get) return workers;
    return sortRows(workers, get, workerSortDir);
  })();

  // ---- Xuất Excel / In bảng ----
  const handleExportExcel = () => {
    if (projects.length === 0) {
      notify('Không có dữ liệu để xuất!', 'error');
      return;
    }
    const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
      {
        name: 'CongTrinh',
        rows: projects.map((p) => ({
          'Mã CT': p.code,
          'Tên công trình': p.name,
          'Khách hàng': p.customer_name,
          'Địa chỉ': p.address,
          'Dự toán': p.estimated_revenue,
          'Quyết toán': p.settled_revenue,
          'Vật tư': p.material_cost_total,
          'Nhân công': p.labor_cost_total,
          'Chi khác': p.other_costs,
          'Tổng chi': p.total_cost,
          'Lãi thực': p.actual_profit,
        })),
      },
    ];
    if (currentProject) {
      sheets.push({
        name: 'VatTu',
        rows: currentProject.materials.map((m) => ({
          'Mã CT': currentProject.code,
          'SKU': m.sku,
          'Vật tư': m.name,
          'SL': m.quantity,
          'ĐVT': m.unit,
          'Đơn giá vốn': m.unit_cost,
          'Thành tiền': m.total_cost,
        })),
      });
      sheets.push({
        name: 'CongTho',
        rows: currentProject.workers.map((w) => ({
          'Mã CT': currentProject.code,
          'Thợ': w.worker_name,
          'Việc': w.role,
          'Ngày công': w.days_worked,
          'Lương/ngày': w.daily_wage,
          'Phụ cấp': w.allowance,
          'Tổng lương': w.total_wage,
        })),
      });
    }
    exportToExcel('cong-trinh', sheets);
  };

  const handlePrint = () => {
    if (!currentProject) {
      notify('Chọn 1 công trình để in quyết toán!', 'error');
      return;
    }
    const p = currentProject;
    printTable({
      title: `Quyết toán công trình ${p.code} — ${p.name}`,
      meta: [`Chủ đầu tư: ${p.customer_name}`, `Dự toán: ${formatVND(p.estimated_revenue)}`, `Thực thu: ${formatVND(p.settled_revenue)}`, `Lãi: ${formatVND(p.actual_profit)}`],
      columns: [
        { header: 'Hạng mục' },
        { header: 'Chi tiết' },
        { header: 'Số tiền', align: 'right' },
      ],
      rows: [
        ...p.materials.map((m) => [`Vật tư: ${m.name}`, `${m.quantity} ${m.unit} × ${m.unit_cost.toLocaleString('vi-VN')}`, m.total_cost.toLocaleString('vi-VN')] as (string | number)[]),
        ...p.workers.map((w) => [`Nhân công: ${w.worker_name} (${w.role})`, `${w.days_worked} công`, w.total_wage.toLocaleString('vi-VN')] as (string | number)[]),
      ],
      footer: ['Tổng chi', '', p.total_cost.toLocaleString('vi-VN')],
    });
  };

  return (
    <div id="projects-view" className="flex-1 flex flex-col h-[calc(100dvh-56px)] min-h-0 bg-slate-100 overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span>Dự án & Thi công Công trình (Quy trình 3 Giai đoạn & P&L)</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
            {projects.length} dự án
          </span>
        </div>

        {/* Nút phụ (Excel/In) trước, nút chính sát lề phải */}
        <div className="flex items-center gap-2">
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
          <button
            onClick={() => setIsNewProjectModalOpen(true)}
            className="px-3.5 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Lập dự án công trình mới</span>
          </button>
        </div>
      </div>

      {/* Main workspace — 3 cột: danh sách | hồ sơ + chi phí | P&L & tiền độ */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Left: Tìm kiếm + Danh sách dự án */}
        <aside className="w-full lg:w-[290px] shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-0">
          <div className="p-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[11px] font-bold text-slate-700 tracking-wide flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-blue-600" />
                TÌM KIẾM DỰ ÁN
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                {visibleProjects.length}/{projects.length}
              </span>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="project-list-search"
                type="text"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                placeholder="Tìm theo tên, mã HĐ, chủ nhà..."
                className="w-full h-8 pl-7 pr-2 text-xs bg-white border border-slate-300 rounded-lg focus:border-blue-500 focus:outline-hidden text-slate-800"
              />
            </div>
          </div>

          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
            <span className="text-[11px] font-bold text-slate-700 tracking-wide">DANH SÁCH DỰ ÁN</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-mono font-bold">
              {visibleProjects.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {visibleProjects.map((p) => {
              const isSelected = currentProject?.id === p.id;
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedProject(p)}
                  aria-current={isSelected}
                  className={`w-full text-left p-3 cursor-pointer transition-colors border-l-[3px] ${
                    isSelected ? 'bg-blue-50 border-l-blue-600' : 'border-l-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-blue-700">{p.code}</span>
                  </div>
                  <h4 className="font-bold text-xs text-slate-900 mt-1 line-clamp-1">{p.name}</h4>
                  <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                    Chủ nhà: {p.customer_name}
                    {p.address ? ` · ${p.address}` : ''}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="text-slate-500">Giá trị: {formatVND(p.settled_revenue)}</span>
                    <span className={`font-bold ${p.actual_profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      Lãi: {formatVND(p.actual_profit)}
                    </span>
                  </div>
                </button>
              );
            })}
            {visibleProjects.length === 0 && (
              <p className="p-6 text-center text-xs text-slate-400">Không có dự án nào khớp từ khoá.</p>
            )}
          </div>
        </aside>

        {/* Center: Hồ sơ dự án + 2 bảng chi phí | Right: P&L + tiền độ */}
        {currentProject ? (
          <>
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            {/* Card: Thông tin dự án + 4 ô số tiền chủ đạo */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  THÔNG TIN DỰ ÁN
                </h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                    {currentProject.code}
                  </span>
                  {/* Sửa thông tin tạo sai (tên/chủ đầu tư/địa chỉ) — không đụng số tiền,
                      số tiền sửa ở modal tài chính ([sửa] ở ô quyết toán). */}
                  <button
                    type="button"
                    id="btn-edit-project-info"
                    onClick={openEditInfoModal}
                    title="Sửa tên / chủ đầu tư / địa chỉ công trình"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-lg px-2 py-1 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    Sửa
                  </button>
                  {/* Xoá dự án tạo nhầm — chỉ Admin/Quản lý (server cũng chặn is_manager).
                      Server hoàn kho + giữ audit, không xoá sổ quỹ. */}
                  {canDeleteProject && (
                    <button
                      type="button"
                      id="btn-delete-project"
                      onClick={() => handleDeleteProject(currentProject)}
                      title="Xoá dự án này (vật tư đã xuất sẽ hoàn về kho)"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-300 rounded-lg px-2 py-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Xoá
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 space-y-3">
                <h4 className="text-lg font-extrabold text-slate-900 leading-tight">{currentProject.name}</h4>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Chủ đầu tư: <strong className="text-slate-700">{currentProject.customer_name || '—'}</strong>
                  </span>
                  {customerPhone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {customerPhone}
                    </span>
                  )}
                  {currentProject.address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {currentProject.address}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    Lập ngày {formatDate(currentProject.created_at)}
                  </span>
                </div>

                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">Hợp đồng quyết toán</div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold font-mono text-blue-700">
                        {formatVND(currentProject.settled_revenue)}
                      </span>
                      <button
                        type="button"
                        onClick={openFinModal}
                        className="text-[10px] font-semibold text-blue-600 hover:underline shrink-0"
                        title="Sửa dự toán / quyết toán / chi khác"
                      >
                        [sửa]
                      </button>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">Dự toán dính thước</div>
                    <div className="text-sm font-bold font-mono text-slate-800 mt-0.5">
                      {formatVND(currentProject.estimated_revenue)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">Đã thu (cọc/đợt)</div>
                    <div className="text-sm font-bold font-mono text-emerald-700 mt-0.5">
                      {formatVND(currentProject.deposit_amount || 0)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">Còn phải thu</div>
                    <div className="text-sm font-bold font-mono text-amber-700 mt-0.5">
                      {formatVND(projectRemaining)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Chi phí vật tư (đứng sau nhân công — order-2, thứ tự DOM cũ giữ nguyên để
                không phải di chuyển cả khối bảng) */}
            <div className="order-2 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 min-w-0">
                  <Boxes className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="truncate">CHI PHÍ VẬT TƯ</span>
                  <span className="text-[10px] font-normal text-slate-400 shrink-0">(Xuất kho tự động)</span>
                </h4>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-slate-600">
                    Tổng: <strong className="text-slate-900">{formatVND(currentProject.material_cost_total)}</strong>
                  </span>
                  {/* Xuất vật tư chuyển sang màn POS (tab "Xuất CT") — modal cũ đã bỏ vì
                      mỗi lần chỉ xuất được 1 mặt hàng, thao tác lẹt. */}
                  {canExportMaterials && (
                    <button
                      type="button"
                      id="btn-project-goto-export"
                      onClick={() => goToProjectExport(currentProject)}
                      title={`Mở màn POS → Xuất CT cho công trình ${currentProject.code}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1 hover:bg-amber-100 active:bg-amber-200"
                    >
                      <HardHat className="w-3 h-3" />
                      Xuất vật tư
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <SortableTh className="py-2 px-3" label="Mã SKU" sortKey="sku" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3" label="Tên vật tư" sortKey="name" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-center" label="Số lượng" sortKey="quantity" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Đơn giá vốn" sortKey="unit_cost" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Thành tiền vốn" sortKey="total_cost" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <th className="py-2 px-2 w-10 text-center">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedMaterials.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-blue-700">{m.sku}</td>
                        <td className="py-2 px-3 font-medium text-slate-800">{m.name}</td>
                        <td className="py-2 px-3 text-center font-bold font-mono">
                          {m.quantity} {m.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatVND(m.unit_cost)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {formatVND(m.total_cost)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            onClick={() => handleRemoveLine('material', String(idx), `${m.name} x${m.quantity}`)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Gỡ dòng + hoàn vật tư về kho"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedMaterials.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          Chưa xuất vật tư nào. Bấm “Xuất vật tư” để sang màn POS.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Chi phí nhân công (đứng trước vật tư — order-1) */}
            <div className="order-1 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 min-w-0">
                  <Hammer className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="truncate">CHI PHÍ NHÂN CÔNG</span>
                  <span className="hidden md:inline text-[10px] font-normal text-slate-400 shrink-0">
                    (Chấm công trợ thị công)
                  </span>
                </h4>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-slate-600">
                    Tổng tiền công:{' '}
                    <strong className="text-slate-900">{formatVND(currentProject.labor_cost_total)}</strong>
                  </span>
                  <button
                    type="button"
                    id="btn-add-worker"
                    onClick={() => setIsWorkerModalOpen(true)}
                    title="Thêm thợ vào chấm công công trình"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-2 py-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Thêm thợ
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <SortableTh className="py-2 px-3" label="Họ tên thợ" sortKey="worker_name" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3" label="Công việc đảm nhiệm" sortKey="role" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-center" label="Số công" sortKey="days_worked" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Lương/ngày" sortKey="daily_wage" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Phụ cấp" sortKey="allowance" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Tổng lương" sortKey="total_wage" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <th className="py-2 px-2 w-10 text-center">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedWorkers.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-slate-800">
                          {w.worker_name}
                          {w.employee_code && (
                            <span className="ml-1.5 px-1.5 py-px font-mono text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded" title="Link hồ sơ nhân sự">
                              {w.employee_code}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{w.role}</td>
                        <td className="py-2 px-3 text-center font-bold font-mono text-blue-700">
                          {w.days_worked} công
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatVND(w.daily_wage)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatVND(w.allowance)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {formatVND(w.total_wage)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            onClick={() => handleRemoveLine('worker', w.id, w.worker_name)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Gỡ thợ khỏi công trình"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedWorkers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          Chưa có thợ nào. Bấm “Thêm thợ” để ghi nhận công.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Right: tiến độ thu tiền + cơ cấu chi phí.
              Cùng kiểu "thẻ neo" như cột trái: nền trắng liền mạch, các khối ngăn cách
              bằng đường viền 1px — KHÔNG phải khối nổi (nền xám + thẻ bo góc đổ bóng). */}
          <aside className="w-full xl:w-[330px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
            {/* Tiến độ thu tiền & công nợ chủ đầu tư */}
            <section className="border-b border-slate-200">
              <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  TIỀN ĐỘ THU TIỀN &amp; CÔNG NỢ
                </h3>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[9px] font-bold font-mono">
                  ĐÃ THU {projectReceivedPct.toFixed(0)}%
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="px-3 pt-3">
                  <div
                    className="h-1.5 rounded-full bg-slate-200 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(projectReceivedPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Tiến độ đã thu"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-[width]"
                      style={{ width: `${Math.min(100, projectReceivedPct)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 border-t border-slate-100">
                  <div className="py-2 px-3 border-b border-r border-slate-100">
                    <div className="text-[9px] font-semibold text-slate-500 uppercase">Đã thu trước</div>
                    <div className="text-xs font-bold font-mono text-emerald-700 mt-0.5">
                      {formatVND(currentProject.deposit_amount || 0)}
                    </div>
                  </div>
                  <div className="py-2 px-3 border-b border-slate-100">
                    <div className="text-[9px] font-semibold text-slate-500 uppercase">Còn phải thu</div>
                    <div className="text-xs font-bold font-mono text-amber-700 mt-0.5">
                      {formatVND(projectRemaining)}
                    </div>
                  </div>
                </div>

                <div className="px-3">
                  <button
                    type="button"
                    id="btn-project-collect-deposit"
                    onClick={() => {
                      setDepAmount(projectRemaining);
                      setIsDepModalOpen(true);
                    }}
                    disabled={projectRemaining <= 0}
                    title={
                      projectRemaining <= 0
                        ? 'Đã thu đủ giá trị quyết toán'
                        : 'Thu cọc / tạm ứng theo đợt thi công'
                    }
                    className="w-full h-9 rounded-lg bg-emerald-800 hover:bg-emerald-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Banknote className="w-4 h-4" />
                    Thu cọc / Thu tiền đợt mới
                  </button>
                </div>

                {/* Lịch sử thu tiền lấy từ sổ quỹ thật (category 'deposit', ref = mã CT) */}
                <div className="px-3 pb-3">
                  <div className="text-[10px] font-semibold text-slate-500 mb-1 pt-1 border-t border-slate-100">
                    Lịch sử thu tiền ({projectDeposits.length} phiếu)
                  </div>
                  {projectDeposits.length === 0 ? (
                    <p className="text-[10px] text-slate-400">Chưa thu khoản nào cho công trình này.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {projectDeposits.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2 text-[10px] text-slate-600 py-1">
                          <span className="truncate">{d.note || `Thu ${formatVND(d.amount)}`}</span>
                          <span className="font-mono font-semibold text-emerald-700 shrink-0">
                            {formatVND(d.amount)}
                            {currentProject.settled_revenue > 0 && (
                              <span className="text-slate-400 font-normal ml-1">
                                ({((d.amount / currentProject.settled_revenue) * 100).toFixed(0)}%)
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* Cơ cấu chi phí */}
            <section>
              <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                  <PieChart className="w-4 h-4 text-blue-600" />
                  CƠ CẤU CHI PHÍ DỰ ÁN
                </h3>
                <span className="text-[10px] font-mono text-slate-500">
                  TỔNG: <strong className="text-slate-800">{formatVND(currentProject.total_cost)}</strong>
                </span>
              </div>
              <ul className="py-1.5 text-[11px]">
                {[
                  { label: 'Chi phí vật tư', value: currentProject.material_cost_total, dot: 'bg-rose-500' },
                  { label: 'Chi phí nhân công', value: currentProject.labor_cost_total, dot: 'bg-amber-500' },
                ].map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100"
                  >
                    <span className="flex items-center gap-1.5 text-slate-600 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="font-mono font-semibold text-slate-800 shrink-0">{formatVND(row.value)}</span>
                  </li>
                ))}
                {currentProject.other_costs > 0 && (
                  <li className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100">
                    <span className="flex items-center gap-1.5 text-slate-600 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                      <span className="truncate">Chi phí khác</span>
                    </span>
                    <span className="font-mono font-semibold text-slate-800 shrink-0">
                      {formatVND(currentProject.other_costs)}
                    </span>
                  </li>
                )}
                <li className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50">
                  <span className="font-bold text-slate-800">Lợi nhuận gộp:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      currentProject.actual_profit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    {formatVND(currentProject.actual_profit)}
                  </span>
                </li>
              </ul>
            </section>
          </aside>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            Vui lòng chọn hoặc tạo dự án công trình
          </div>
        )}
      </div>

      {/* Modal: Thêm thợ (tổng lương = ngày × lương + phụ cấp) */}
      {isWorkerModalOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleAddWorker}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Thêm thợ cho {currentProject.code}</h3>
              <button type="button" onClick={() => setIsWorkerModalOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Thợ (chọn từ nhân sự) *</label>
                <SearchableSelect
                  value={wEmployeeId}
                  allowCustom
                  placeholder="Gõ để tìm NV… (thợ ngoài thì gõ tên trực tiếp)"
                  options={activeEmployees.map((e) => ({
                    value: e.id,
                    label: `${e.full_name} (${e.code})`,
                    sub: `${e.position || 'Thợ'} · ${e.salary_type === 'daily' ? `${e.daily_wage.toLocaleString('vi-VN')}đ/ngày` : `${e.monthly_salary.toLocaleString('vi-VN')}đ/tháng`}`,
                  }))}
                  onChange={handlePickWorker}
                />
                {pickedEmployee ? (
                  <p className="mt-1 text-[11px] text-emerald-700 font-medium">
                    Đã link hồ sơ {pickedEmployee.code} — lương/việc tự điền theo hồ sơ.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">Thợ ngoài: tự nhập việc + lương tay.</p>
                )}
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Công việc đảm nhiệm</label>
                <input
                  type="text"
                  value={wRole}
                  onChange={(e) => setWRole(e.target.value)}
                  placeholder="Vd: Thợ kính"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Ngày công *</label>
                  <NumberInput min={0} value={wDays} onChange={(v) => setWDays(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lương/ngày</label>
                  <NumberInput min={0} value={wWage} onChange={(v) => setWWage(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phụ cấp</label>
                  <NumberInput min={0} value={wAllow} onChange={(v) => setWAllow(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
                </div>
              </div>
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between font-mono font-bold">
                <span className="text-slate-700 font-sans font-semibold">Tổng lương:</span>
                <span className="text-blue-700">{formatVND(wPreviewTotal)}</span>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsWorkerModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">
                Thêm thợ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal tài chính: dự toán / quyết toán / chi khác độc lập */}
      {isFinModalOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleSaveFinance}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Số tài chính {currentProject.code}</h3>
              <button type="button" onClick={() => setIsFinModalOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Giá trị dự toán ban đầu (đ)</label>
                <NumberInput min={0} value={finEstimated} onChange={(v) => setFinEstimated(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Giá trị hợp đồng quyết toán (đ)</label>
                <NumberInput min={0} value={finSettled} onChange={(v) => setFinSettled(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
                <p className="mt-1 text-[11px] text-slate-400">Báo giá chưa sát giá chốt thì sửa riêng ở đây, không ảnh hưởng dự toán.</p>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Chi phí khác (đ)</label>
                <NumberInput min={0} value={finOther} onChange={(v) => setFinOther(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono" />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setIsFinModalOpen(false)} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded">
                Hủy
              </button>
              <button type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">
                Lưu số
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal thu tiền công trình (cọc/đợt) */}
      {isDepModalOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleCollectDeposit}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">
                Thu cọc/đợt {currentProject.code}
              </h3>
              <button type="button" onClick={() => setIsDepModalOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <p className="text-slate-600">
                Đã thu trước: <strong className="font-mono">{formatVND(currentProject.deposit_amount || 0)}</strong>
                {' '}· Còn phải thu: <strong className="font-mono">{formatVND(Math.max(0, currentProject.settled_revenue - (currentProject.deposit_amount || 0)))}</strong>
              </p>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Số tiền thu (đ) *</label>
                <NumberInput min={0} value={depAmount} onChange={(v) => setDepAmount(v)} className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono font-bold" />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Hình thức</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDepMethod('cash')}
                    className={`py-2 text-xs font-semibold rounded border transition-colors ${depMethod === 'cash' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    Tiền mặt
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepMethod('transfer')}
                    className={`py-2 text-xs font-semibold rounded border transition-colors ${depMethod === 'transfer' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    Chuyển khoản
                  </button>
                </div>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setIsDepModalOpen(false)} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded">
                Hủy
              </button>
              <button type="submit" disabled={!(depAmount > 0)} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-bold">
                Xác nhận thu {formatVND(depAmount)}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Lập dự án thi công mới">
          <form
            onSubmit={handleCreateProject}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Lập Dự Án Thi Công Mới (MÃ CT-YYMMDD-XXXX)</h3>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên công trình *</label>
                <input
                  id="new-project-name-input"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vd: Vách kính tường & Ban công kính Nhà Phố Bách Tây"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Khách hàng / Chủ đầu tư (link công nợ)</label>
                <SearchableSelect
                  value={customerPick}
                  placeholder="Chọn KH có sẵn hoặc gõ tên mới…"
                  allowCustom
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} — nợ ${formatVND(c.current_debt)}`,
                    sub: `${c.code} · ${c.phone || 'không SĐT'}`,
                  }))}
                  onChange={(v) => setCustomerPick(v)}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Chọn đúng KH để ăn theo công nợ và đồng bộ server; gõ tên mới thì lưu chay.
                </p>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Địa chỉ thi công</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Vd: 56 Tên Lửa, Bình Trị Đông B, Bình Tân"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Giá trị dự toán hợp đồng (đ)</label>
                <NumberInput
                  value={estimatedRevenue}
                  min={0}
                  onChange={(val) => setEstimatedRevenue(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipEstimate}
                  onChange={(e) => setSkipEstimate(e.target.checked)}
                  className="w-4 h-4 accent-blue-600"
                />
                Không qua báo giá — vào thẳng Thi công (chỉ quyết toán sau)
              </label>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewProjectModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Tạo dự án
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Info Modal — sửa tên/chủ đầu tư/địa chỉ khi tạo sai (0066).
          Số tiền không sửa ở đây mà ở modal tài chính để tách trách nhiệm. */}
      {isEditInfoOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Sửa thông tin công trình">
          <form
            onSubmit={handleSaveEditInfo}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Sửa thông tin {currentProject.code}</h3>
              <button type="button" onClick={() => setIsEditInfoOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên công trình *</label>
                <input
                  id="edit-project-name-input"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Tên công trình"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Khách hàng / Chủ đầu tư (link công nợ)</label>
                <SearchableSelect
                  value={editCustomerPick}
                  placeholder="Chọn KH có sẵn hoặc gõ tên mới…"
                  allowCustom
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} — nợ ${formatVND(c.current_debt)}`,
                    sub: `${c.code} · ${c.phone || 'không SĐT'}`,
                  }))}
                  onChange={(v) => setEditCustomerPick(v)}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Đổi chủ đầu tư sẽ đổi luôn link công nợ của dự án.
                </p>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Địa chỉ thi công</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Địa chỉ thi công"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditInfoOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                id="btn-save-project-info"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
              >
                Lưu thay đổi
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
