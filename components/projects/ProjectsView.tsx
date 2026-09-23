'use client';

import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { toast } from '@/lib/notify';
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
} from 'lucide-react';
import { SortableTh, useSortState } from '@/components/common/SortableTh';
import { NumberInput } from '@/components/common/NumberInput';
import { TableTools } from '@/components/common/TableTools';
import { exportToExcel, printTable } from '@/lib/excel';
import { sortRows } from '@/lib/sort';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';

export function ProjectsView() {
  const { projects, addProject, updateProject, products } = useStore();
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null);

  // New project modal
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [estimatedRevenue, setEstimatedRevenue] = useState(30000000);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const created = await addProject({
      name: name.trim(),
      customer_id: 'cust-new',
      customer_name: customerName || 'Chủ đầu tư',
      address,
      phase: 1,
      estimated_revenue: estimatedRevenue,
      settled_revenue: estimatedRevenue,
      materials: [],
      workers: [],
      other_costs: 0,
      material_cost_total: 0,
      labor_cost_total: 0,
      total_cost: 0,
      actual_profit: estimatedRevenue,
      status: 'planning',
      created_at: new Date().toISOString(),
    });

    setSelectedProject(created);
    setIsNewProjectModalOpen(false);
    setName('');
  };

  const handleAdvancePhase = async (project: Project, nextPhase: ProjectPhase) => {
    let status = project.status;
    if (nextPhase === 2 || nextPhase === 3) status = 'in_progress';
    if (nextPhase === 4) status = 'completed';

    const updated = {
      ...project,
      phase: nextPhase,
      status,
    };

    await updateProject(project.id, updated);
    setSelectedProject(updated);
    toast(`Dự án đã được chuyển sang Giai đoạn ${nextPhase}!`, 'success');
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
      toast('Không có dữ liệu để xuất!', 'error');
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
      toast('Chọn 1 công trình để in quyết toán!', 'error');
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
    <div id="projects-view" className="flex-1 flex flex-col h-[calc(100vh-56px)] bg-slate-100 overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span>Dự án & Thi công Công trình (Quy trình 4 Giai đoạn & P&L)</span>
          </h2>
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
            {projects.length} dự án
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => setIsNewProjectModalOpen(true)}
          >
            <Plus className="w-4 h-4" />
            <span>Lập dự án công trình mới</span>
          </Button>
          <TableTools onExportExcel={handleExportExcel} onPrint={handlePrint} />
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Project List */}
        <div className="w-full lg:w-80 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
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
                    <Badge tone={p.phase >= 4 ? 'emerald' : p.phase <= 1 ? 'slate' : 'blue'}>
                      Giai đoạn {p.phase}/4
                    </Badge>
                  </div>
                  <h4 className="font-bold text-xs text-slate-800 mt-1 line-clamp-1">{p.name}</h4>
                  <div className="text-[11px] text-slate-500 mt-0.5">{p.customer_name}</div>
                  <div className="mt-2 flex items-center justify-between text-xs font-mono tnum">
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
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 4-Phase Progress Tracker Banner */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <span>{currentProject.name}</span>
                    <span className="font-mono text-xs text-blue-600 font-normal">({currentProject.code})</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chủ đầu tư: <strong>{currentProject.customer_name}</strong> • Địa điểm: {currentProject.address}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Giá trị hợp đồng quyết toán:</div>
                  <div className="text-base font-extrabold text-blue-700 font-mono tnum">
                    {formatVND(currentProject.settled_revenue)}
                  </div>
                </div>
              </div>

              {/* 4 Step Tracker */}
              <div className="grid grid-cols-4 gap-2 pt-2">
                {[
                  { phase: 1, title: '1. Báo giá dự toán', desc: 'Khảo sát & Lập bảng giá' },
                  { phase: 2, title: '2. Xuất kho vật tư', desc: 'Trừ kho kính & phụ kiện' },
                  { phase: 3, title: '3. Chấm công thợ', desc: 'Quản lý thợ & nhật trình' },
                  { phase: 4, title: '4. Nghiệm thu & P&L', desc: 'Quyết toán & Hạch toán lãi' },
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

            {/* Phase 2: Materials Outward (Trigger trg_project_material_stock - INV-ERR-03) */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-amber-600" />
                  <span>Vật tư Xuất Kho Theo Dự Án (Đã Trừ Kho Tự Động)</span>
                </h4>
                <span className="text-xs font-mono tnum font-bold text-slate-700">
                  Tổng chi phí vật tư: {formatVND(currentProject.material_cost_total)}
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <SortableTh className="py-2 px-3" label="Mã SKU" sortKey="sku" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3" label="Tên vật tư" sortKey="name" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-center" label="Số lượng" sortKey="quantity" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Đơn giá vốn" sortKey="unit_cost" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Thành tiền vốn" sortKey="total_cost" activeKey={matSortKey} dir={matSortDir} onSort={toggleMatSort} />
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
                        <td className="py-2 px-3 text-right font-mono tnum text-slate-600">
                          {formatVND(m.unit_cost)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum font-bold text-slate-900">
                          {formatVND(m.total_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phase 3: Workers & Labor Timesheet (SEC-ERR-03) */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                  <Hammer className="w-4 h-4 text-blue-600" />
                  <span>Chấm Công Thợ & Chi Phí Nhân Công Công Trình</span>
                </h4>
                <span className="text-xs font-mono tnum font-bold text-slate-700">
                  Tổng tiền công thợ: {formatVND(currentProject.labor_cost_total)}
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <SortableTh className="py-2 px-3" label="Họ tên thợ" sortKey="worker_name" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3" label="Công việc đảm nhiệm" sortKey="role" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-center" label="Số ngày công" sortKey="days_worked" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Lương/ngày" sortKey="daily_wage" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Phụ cấp" sortKey="allowance" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                      <SortableTh className="py-2 px-3 text-right" label="Tổng lương" sortKey="total_wage" activeKey={workerSortKey} dir={workerSortDir} onSort={toggleWorkerSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedWorkers.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-slate-800">{w.worker_name}</td>
                        <td className="py-2 px-3 text-slate-600">{w.role}</td>
                        <td className="py-2 px-3 text-center font-bold font-mono text-blue-700">
                          {w.days_worked} công
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum text-slate-600">
                          {formatVND(w.daily_wage)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum text-slate-600">
                          {formatVND(w.allowance)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tnum font-bold text-slate-900">
                          {formatVND(w.total_wage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phase 4: Final Settlement & P&L Card */}
            <div className="bg-slate-900 text-white p-5 rounded-xl shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h4 className="font-bold text-sm flex items-center gap-2 text-emerald-400">
                  <TrendingUp className="w-5 h-5" />
                  BÁO CÁO P&L HẠCH TOÁN LÃI - LỖ THỰC TẾ CÔNG TRÌNH
                </h4>
                <span className="text-xs font-mono text-slate-400">Chuẩn SRS v2.12 §3.4</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tnum">
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
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState message="Vui lòng chọn hoặc tạo dự án công trình" />
          </div>
        )}
      </div>

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
              <Field label="Tên công trình" required>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vd: Vách kính tắm & Ban công kính Nhà Phố Bình Tân"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </Field>
              <Field label="Tên khách hàng / Chủ đầu tư">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Vd: Anh Tuấn"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </Field>
              <Field label="Địa chỉ thi công">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Vd: 56 Tên Lửa, Bình Trị Đông B, Bình Tân"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded"
                />
              </Field>
              <Field label="Giá trị dự toán hợp đồng (đ)">
                <NumberInput
                  value={estimatedRevenue}
                  min={0}
                  onChange={(val) => setEstimatedRevenue(val)}
                  placeholder="0"
                  className="w-full h-8 px-2.5 border border-slate-300 rounded font-mono"
                />
              </Field>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setIsNewProjectModalOpen(false)}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                variant="primary"
              >
                Tạo dự án
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
