'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Project, ProjectPhase, ProjectMaterial, ProjectWorker } from '@/lib/types';
import { formatVND, formatNumber } from '@/lib/format';
import {
  Building2,
  Plus,
  ArrowRight,
  CheckCircle2,
  Boxes,
  Users,
  DollarSign,
  TrendingUp,
  Clock,
  Hammer,
  FileCheck,
  AlertCircle,
  Trash2,
  X,
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { NumberInput } from '@/components/common/NumberInput';
import { SearchableSelect } from '@/components/common/SearchableSelect';
import { confirmDialog } from '@/components/common/ConfirmDialog';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';

export function ProjectsView() {
  const { projects, addProject, updateProject, products, employees, exportProjectMaterial, addProjectWorker, removeProjectLine, updateProjectFinance, collectProjectDeposit } = useStore();
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null);

  // New project modal
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [estimatedRevenue, setEstimatedRevenue] = useState(0);
  const [skipEstimate, setSkipEstimate] = useState(false);

  // Phase 2: xuất vật tư
  const [isMatModalOpen, setIsMatModalOpen] = useState(false);
  const [matProductId, setMatProductId] = useState('');
  const [matQty, setMatQty] = useState(1);
  const matProduct = products.find((p) => p.id === matProductId);
  const matPreviewTotal = matProduct ? Math.round(matQty * matProduct.avg_cost) : 0;

  // Phase 3: thêm thợ — chọn từ hồ sơ nhân sự (tự điền lương/việc), cho phép thợ ngoài
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

  const handleExportMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !matProductId || !(matQty > 0)) return;
    const updated = await exportProjectMaterial(currentProject.id, matProductId, matQty);
    if (updated) {
      setSelectedProject(updated);
      setIsMatModalOpen(false);
      setMatProductId('');
      setMatQty(1);
      alert(`Đã xuất ${matQty} ${matProduct?.unit} ${matProduct?.name} cho công trình (trừ kho + thẻ kho).`);
    }
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
        { title: currentProject.phase >= 3 ? 'Thu quyết toán' : 'Thu cọc/đợt', confirmLabel: 'Vẫn thu' }
      );
      if (!ok) return;
    }
    const updated = await collectProjectDeposit(currentProject.id, depAmount, depMethod);
    if (updated) {
      setSelectedProject(updated);
      setIsDepModalOpen(false);
      setDepAmount(0);
      alert(`Đã thu ${formatVND(depAmount)} cho công trình ${currentProject.code}.`);
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

    const created = await addProject({
      name: name.trim(),
      customer_id: 'cust-new',
      customer_name: customerName || 'Chủ đầu tư',
      address,
      phase: skipEstimate ? 2 : 1,
      estimated_revenue: estimatedRevenue,
      settled_revenue: estimatedRevenue,
      deposit_amount: 0,
      materials: [],
      workers: [],
      other_costs: 0,
      material_cost_total: 0,
      labor_cost_total: 0,
      total_cost: 0,
      actual_profit: estimatedRevenue,
      status: skipEstimate ? 'in_progress' : 'planning',
      created_at: new Date().toISOString(),
    });

    setSelectedProject(created);
    setIsNewProjectModalOpen(false);
    setName('');
    setSkipEstimate(false);
  };

  const handleAdvancePhase = async (project: Project, nextPhase: ProjectPhase) => {
    let status = project.status;
    if (nextPhase === 2) status = 'in_progress';
    if (nextPhase === 3) status = 'completed';

    const updated = {
      ...project,
      phase: nextPhase,
      status,
    };

    await updateProject(project.id, updated);
    setSelectedProject(updated);
  };

  const currentProject = selectedProject;

  // Sắp xếp 2 bảng vật tư / nhân công của công trình đang xem (bấm header để đảo chiều)
  const { sortKey: matSortKey, sortDir: matSortDir, toggleSort: toggleMatSort } = useSortState();
  const { sortKey: workerSortKey, sortDir: workerSortDir, toggleSort: toggleWorkerSort } = useSortState();
  const sortedMaterials = useMemo(() => {
    const base = currentProject?.materials ?? [];
    if (!matSortKey) return base;
    const getters: Record<string, (m: ProjectMaterial) => unknown> = {
      sku: (m) => m.sku,
      name: (m) => m.name,
      quantity: (m) => m.quantity,
      unit_cost: (m) => m.unit_cost,
      total_cost: (m) => m.total_cost,
    };
    const get = getters[matSortKey];
    if (!get) return base;
    return sortRows(base, get, matSortDir);
  }, [currentProject, matSortKey, matSortDir]);
  const sortedWorkers = useMemo(() => {
    const base = currentProject?.workers ?? [];
    if (!workerSortKey) return base;
    const getters: Record<string, (w: ProjectWorker) => unknown> = {
      worker_name: (w) => w.worker_name,
      role: (w) => w.role,
      days_worked: (w) => w.days_worked,
      daily_wage: (w) => w.daily_wage,
      allowance: (w) => w.allowance,
      total_wage: (w) => w.total_wage,
    };
    const get = getters[workerSortKey];
    if (!get) return base;
    return sortRows(base, get, workerSortDir);
  }, [currentProject, workerSortKey, workerSortDir]);

  // ---- Xuất Excel / In bảng ----
  const handleExportExcel = () => {
    if (projects.length === 0) {
      alert('Không có dữ liệu để xuất!');
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
          'Giai đoạn': p.phase,
          'Dự toán': p.estimated_revenue,
          'Quyết toán': p.settled_revenue,
          'Vật tư': p.material_cost_total,
          'Nhân công': p.labor_cost_total,
          'Chi khác': p.other_costs,
          'Tổng chi': p.total_cost,
          'Lãi thực': p.actual_profit,
          'Trạng thái': p.status,
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
      alert('Chọn 1 công trình để in quyết toán!');
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

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsNewProjectModalOpen(true)}
            className="px-3.5 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Lập dự án công trình mới</span>
          </button>
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Left: Project List */}
        <div className="w-full lg:w-80 bg-white border-r border-slate-200 flex flex-col overflow-y-auto min-h-0">
          <div className="p-3 border-b border-slate-100 font-semibold text-xs text-slate-700">
            Danh sách công trình đang triển khai
          </div>
          <div className="divide-y divide-slate-100">
            {projects.map((p) => {
              const isSelected = currentProject?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProject(p)}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-blue-700">{p.code}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
                      Giai đoạn {p.phase}/3
                    </span>
                  </div>
                  <h4 className="font-bold text-xs text-slate-800 mt-1 line-clamp-1">{p.name}</h4>
                  <div className="text-[11px] text-slate-500 mt-0.5">{p.customer_name}</div>
                  <div className="mt-2 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500">Giá trị: {formatVND(p.estimated_revenue)}</span>
                    <span className="text-emerald-700 font-bold">Lãi: {formatVND(p.actual_profit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: 4-Phase Step Tracker & Detailed Management */}
        {currentProject ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* 4-Phase Progress Tracker Banner */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3 gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <span>{currentProject.name}</span>
                    <span className="font-mono text-xs text-blue-600 font-normal">({currentProject.code})</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chủ đầu tư: <strong>{currentProject.customer_name}</strong> • Địa điểm: {currentProject.address}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Dự toán: <strong className="font-mono">{formatVND(currentProject.estimated_revenue)}</strong>
                    {' '}· Đã thu trước: <strong className="font-mono text-emerald-700">{formatVND(currentProject.deposit_amount || 0)}</strong>
                    {' '}· Còn phải thu: <strong className="font-mono text-rose-600">{formatVND(Math.max(0, currentProject.settled_revenue - (currentProject.deposit_amount || 0)))}</strong>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <button
                    onClick={openFinModal}
                    className="text-xs text-slate-500 hover:text-blue-700"
                    title="Sửa dự toán / quyết toán / chi khác"
                  >
                    Giá trị hợp đồng quyết toán (bấm để sửa):
                  </button>
                  <div className="text-base font-extrabold text-blue-700 font-mono">
                    {formatVND(currentProject.settled_revenue)}
                  </div>
                  <button
                    onClick={() => {
                      setDepAmount(Math.max(0, currentProject.settled_revenue - (currentProject.deposit_amount || 0)));
                      setIsDepModalOpen(true);
                    }}
                    className="mt-1 px-3 h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors"
                    title={currentProject.phase >= 3 ? 'Thu nốt phần quyết toán còn lại' : 'Thu cọc / tạm ứng theo đợt thi công'}
                  >
                    {currentProject.phase >= 3 ? 'Thu quyết toán' : 'Thu cọc/đợt'}
                  </button>
                </div>
              </div>

              {/* 3 Step Tracker */}
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  { phase: 1, title: '1. Báo giá dự toán', desc: 'Khảo sát & Lập bảng giá' },
                  { phase: 2, title: '2. Thi công', desc: 'Xuất kho vật tư & chấm công thợ' },
                  { phase: 3, title: '3. Nghiệm thu & P&L', desc: 'Quyết toán & Hạch toán lãi' },
                ].map((st) => {
                  const isCurrent = currentProject.phase === st.phase;
                  const isPassed = currentProject.phase > st.phase;
  return (
                    <div
                      key={st.phase}
                      onClick={() => handleAdvancePhase(currentProject, st.phase as ProjectPhase)}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                        isCurrent
                          ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                          : isPassed
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-xs">
                        <span>{st.title}</span>
                        {isPassed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                      </div>
                      <div className="text-[10px] mt-0.5 opacity-80">{st.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Thi công: Vật tư xuất kho (trừ kho tự động) */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-amber-600" />
                  <span>Vật tư Xuất Kho Theo Dự Án (Đã Trừ Kho Tự Động)</span>
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-700">
                    Tổng chi phí vật tư: {formatVND(currentProject.material_cost_total)}
                  </span>
                  <button
                    onClick={() => setIsMatModalOpen(true)}
                    className="px-3 h-8 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Xuất vật tư</span>
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
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
                  </tbody>
                </table>
              </div>
            </div>

            {/* Thi công: Chấm công thợ & chi phí nhân công */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                  <Hammer className="w-4 h-4 text-blue-600" />
                  <span>Chấm Công Thợ & Chi Phí Nhân Công Công Trình</span>
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-700">
                    Tổng tiền công thợ: {formatVND(currentProject.labor_cost_total)}
                  </span>
                  <button
                    onClick={() => setIsWorkerModalOpen(true)}
                    className="px-3 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm thợ</span>
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <SortableTh className="py-2 px-3" label="Họ tên thợ" sortKey="worker_name" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3" label="Công việc đảm nhiệm" sortKey="role" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-center" label="Số ngày công" sortKey="days_worked" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
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
                  </tbody>
                </table>
              </div>
            </div>

            {/* Nghiệm thu: Quyết toán & P&L */}
            <div className="bg-slate-900 text-white p-5 rounded-xl shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h4 className="font-bold text-sm flex items-center gap-2 text-emerald-400">
                  <TrendingUp className="w-5 h-5" />
                  BÁO CÁO P&L HẠCH TOÁN LÃI - LỖ THỰC TẾ CÔNG TRÌNH
                </h4>
                <span className="text-xs font-mono text-slate-400">Chuẩn SRS v2.12 §3.4</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[11px]">GIÁ TRỊ QUYẾT TOÁN:</div>
                  <div className="text-base font-bold text-blue-400 mt-1">
                    {formatVND(currentProject.settled_revenue)}
                  </div>
                </div>

                <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[11px]">CHI PHÍ VẬT TƯ:</div>
                  <div className="text-base font-bold text-rose-400 mt-1">
                    -{formatVND(currentProject.material_cost_total)}
                  </div>
                </div>

                <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 text-[11px]">CHI PHÍ NHÂN CÔNG:</div>
                  <div className="text-base font-bold text-amber-400 mt-1">
                    -{formatVND(currentProject.labor_cost_total)}
                  </div>
                </div>

                <div className="bg-emerald-950/80 p-3 rounded-lg border border-emerald-700">
                  <div className="text-emerald-300 text-[11px] font-bold">LỢI NHUẬN THỰC TẾ:</div>
                  <div className="text-lg font-extrabold text-emerald-400 mt-1">
                    {formatVND(currentProject.actual_profit)}
                  </div>
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">
                    Tỷ suất: {((currentProject.actual_profit / currentProject.settled_revenue) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 italic font-sans">
                * Công thức P&L: Lợi Nhuận Công Trình = Giá Trị Quyết Toán - (Chi Phí Vật Tư + Chi Phí Nhân Công + Chi Phí Khác)
              </p>
              <p className="text-[11px] font-sans text-slate-300">
                Đã thu trước: <strong className="font-mono">{formatVND(currentProject.deposit_amount || 0)}</strong>
                {' '}· Còn phải thu chủ đầu tư: <strong className="font-mono">{formatVND(Math.max(0, currentProject.settled_revenue - (currentProject.deposit_amount || 0)))}</strong>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            Vui lòng chọn hoặc tạo dự án công trình
          </div>
        )}
      </div>

      {/* Modal Phase 2: Xuất vật tư (trừ kho thật + thẻ kho export_project) */}
      {isMatModalOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleExportMaterial}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Xuất vật tư cho {currentProject.code}</h3>
              <button type="button" onClick={() => setIsMatModalOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Vật tư trong kho *</label>
                <SearchableSelect
                  value={matProductId}
                  placeholder="Gõ để tìm hàng hóa / hàng m²…"
                  options={products
                    .filter((p) => p.product_type === 'goods' || p.product_type === 'area')
                    .map((p) => ({
                      value: p.id,
                      label: `${p.name} — tồn ${p.stock_quantity} ${p.unit}`,
                      sub: `${p.sku} · vốn ${formatVND(p.avg_cost)}`,
                    }))}
                  onChange={(v) => setMatProductId(v)}
                />
                {matProduct && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Tồn: <strong className="font-mono">{matProduct.stock_quantity} {matProduct.unit}</strong>
                    {' '}· Đơn giá vốn áp dụng: <strong className="font-mono">{formatVND(matProduct.avg_cost)}</strong>
                  </p>
                )}
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Số lượng xuất *</label>
                <NumberInput
                  min={0}
                  value={matQty}
                  onChange={(v) => setMatQty(v)}
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono"
                />
              </div>
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between font-mono font-bold">
                <span className="text-slate-700 font-sans font-semibold">Chi phí vốn:</span>
                <span className="text-amber-700">{formatVND(matPreviewTotal)}</span>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsMatModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={!matProductId || !(matQty > 0)}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-xs font-bold"
              >
                Xác nhận xuất kho
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Phase 3: Thêm thợ (tổng lương = ngày × lương + phụ cấp) */}
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

      {/* Modal thu tiền công trình: phase thi công = cọc/đợt, phase nghiệm thu = quyết toán */}
      {isDepModalOpen && currentProject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleCollectDeposit}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">
                {currentProject.phase >= 3 ? 'Thu quyết toán' : 'Thu cọc/đợt'} {currentProject.code}
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3">
          <form
            onSubmit={handleCreateProject}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95"
          >
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Lập Dự Án Thi Công Mới (Mã CT-YYMMDD-XXXX)</h3>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên công trình *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vd: Vách kính tắm & Ban công kính Nhà Phố Bình Tân"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Tên khách hàng / Chủ đầu tư</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Vd: Anh Tuấn"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
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
    </div>
  );
}
