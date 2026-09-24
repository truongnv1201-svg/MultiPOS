// P3-tx/projects: công trình/dự án 2 chiều + xuất vật tư/nhân công (tách verbatim).
'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type { Project, ProjectMaterial, ProjectWorker, CashbookEntry, Shift, StockMovement } from '../../types';
import { db, generateOrderCode } from '../../db';
import { asUuidOrNull } from './constants';
import { stableNext } from '../stable';

// Tính lại tổng công trình từ dòng (mirror công thức P&L ở ProjectsView)
function recalcProjectTotals(p: Project): Project {
  const material_cost_total = p.materials.reduce((s, m) => s + (m.total_cost || 0), 0);
  const labor_cost_total = p.workers.reduce((s, w) => s + (w.total_wage || 0), 0);
  const total_cost = material_cost_total + labor_cost_total + (p.other_costs || 0);
  return {
    ...p,
    material_cost_total,
    labor_cost_total,
    total_cost,
    actual_profit: (p.settled_revenue || 0) - total_cost,
  };
}

export interface TxProjectsDeps {
  currentShift: Shift;
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  setCurrentShift: React.Dispatch<React.SetStateAction<Shift>>;
  setStockMovements: React.Dispatch<React.SetStateAction<StockMovement[]>>;
}

export interface TxProjects {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  pushProjectToServer: (project: Project) => Promise<Project | null>;
  refreshServerProjects: () => Promise<boolean>;
  syncProjects: () => Promise<void>;
  addProject: (project: Omit<Project, 'id' | 'code'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  exportProjectMaterial: (projectId: string, productId: string, quantity: number) => Promise<Project | null>;
  exportProjectMaterialBatch: (projectId: string, lines: { productId: string; quantity: number }[]) => Promise<Project | null>;
  addProjectWorker: (
    projectId: string,
    worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
  ) => Promise<Project | null>;
  removeProjectLine: (projectId: string, kind: 'material' | 'worker', lineKey: string) => Promise<Project | null>;
  updateProjectFinance: (
    projectId: string,
    finance: { estimated_revenue?: number; settled_revenue?: number; other_costs?: number }
  ) => Promise<Project | null>;
  collectProjectDeposit: (projectId: string, amount: number, paymentMethod: 'cash' | 'transfer') => Promise<Project | null>;
}

export function useTxProjects({ currentShift, setCashbook, setCurrentShift, setStockMovements }: TxProjectsDeps): TxProjects {
  const { supa, user, setLoginOpen } = useAuth();
  const { products, setProducts, customerMap } = useCatalog();
  const { isOnline } = useNetwork();
  const [projects, setProjects] = useState<Project[]>([]);

  // ---- Đồng bộ Dự án/Công trình 2 chiều (migration 0040) ----
  // Local-first: id `proj-...` = chưa đẩy; sau khi đẩy gắn server_id, giữ id local
  // ổn định cho UI. Server thắng khi kéo, trừ bản local chưa từng đẩy.

  // Đẩy 1 công trình: header upsert trực tiếp + dòng vật tư/thợ qua RPC
  // sync_project_workspace (delta tồn kho, chạy lại không trừ 2 lần).
  // Giữ id local ổn định cho UI, chỉ gắn server_id (mirror customerMap).
  // Lỗi mạng/quyền -> warn + giữ local, trả null.
  const pushProjectToServer = useCallback(
    async (project: Project): Promise<Project | null> => {
      if (!supa || !user || !isOnline) return null;
      try {
        let serverId = asUuidOrNull(project.server_id) ?? asUuidOrNull(project.id);
        const header = {
          code: project.code,
          name: project.name,
          customer_id: customerMap[project.customer_id] ?? asUuidOrNull(project.customer_id),
          customer_name: project.customer_name,
          address: project.address,
          phase: project.phase,
          estimated_revenue: Math.round(project.estimated_revenue || 0),
          settled_revenue: Math.round(project.settled_revenue || 0),
          deposit_amount: Math.round(project.deposit_amount || 0),
          other_costs: Math.round(project.other_costs || 0),
          status: project.status,
        };
        if (serverId) {
          const { error } = await supa.from('projects').update(header).eq('id', serverId);
          if (error) throw error;
        } else {
          const { data, error } = await supa.from('projects').insert(header).select('id').single();
          if (error) {
            // Mã CT đã tồn tại (đẩy từ máy khác) -> dùng bản server rồi update
            if ((error as { code?: string }).code === '23505') {
              const existing = await supa.from('projects').select('id').eq('code', project.code).single();
              if (existing.error || !existing.data) throw error;
              serverId = existing.data.id as string;
              const { error: upErr } = await supa.from('projects').update(header).eq('id', serverId as string);
              if (upErr) throw upErr;
            } else {
              throw error;
            }
          } else {
            serverId = data.id as string;
          }
        }
        const { error: rpcError } = await supa.rpc('sync_project_workspace', {
          p_project_id: serverId as string,
          p_materials: project.materials.map((m) => ({
            product_id: asUuidOrNull(m.product_id),
            sku: m.sku,
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            unit_cost: Math.round(m.unit_cost || 0),
          })),
          p_workers: project.workers.map((w) => ({
            employee_id: asUuidOrNull(w.employee_id),
            employee_code: w.employee_code ?? null,
            worker_name: w.worker_name,
            role: w.role,
            days_worked: w.days_worked,
            daily_wage: Math.round(w.daily_wage || 0),
            allowance: Math.round(w.allowance || 0),
          })),
        });
        if (rpcError) throw rpcError;
        // Gắn server_id vào bản local (giữ nguyên id cho UI đang cầm)
        if (project.server_id !== serverId) {
          await db.projects.update(project.id, { server_id: serverId as string }).catch(() => {});
          setProjects((prev) =>
            prev.map((p) => (p.id === project.id ? { ...p, server_id: serverId as string } : p))
          );
          return { ...project, server_id: serverId as string };
        }
        return project;
      } catch (err) {
        console.warn('Project push failed (giữ local):', err);
        return null;
      }
    },
    [supa, user, isOnline, customerMap]
  );

  // Kéo công trình từ server (server thắng), giữ bản local chưa từng đẩy.
  const refreshServerProjects = useCallback(async (): Promise<boolean> => {
    if (!supa || !user) return false;
    try {
      const [projRes, matRes, workRes] = await Promise.all([
        supa.from('projects').select('*').order('code'),
        supa.from('project_materials').select('*'),
        supa.from('project_workers').select('*'),
      ]);
      if (projRes.error || matRes.error || workRes.error) return false;
      const matsByProject = new Map<string, unknown[]>();
      for (const m of ((matRes.data || []) as Record<string, unknown>[])) {
        const pid = String(m.project_id || '');
        if (!matsByProject.has(pid)) matsByProject.set(pid, []);
        matsByProject.get(pid)?.push(m);
      }
      const worksByProject = new Map<string, unknown[]>();
      for (const w of ((workRes.data || []) as Record<string, unknown>[])) {
        const pid = String(w.project_id || '');
        if (!worksByProject.has(pid)) worksByProject.set(pid, []);
        worksByProject.get(pid)?.push(w);
      }
      const serverToLocalCustomer = new Map(
        Object.entries(customerMap).map(([localId, serverId]) => [serverId, localId])
      );
      const num = (v: unknown) => Number(v) || 0;
      const mapped: Project[] = ((projRes.data || []) as Record<string, unknown>[]).map((row) => {
        const materials: ProjectMaterial[] = (matsByProject.get(String(row.id)) || []).map((rm) => {
          const r = rm as Record<string, unknown>;
          const qty = num(r.quantity);
          const unitCost = num(r.unit_cost);
          return {
            product_id: typeof r.product_id === 'string' ? r.product_id : '',
            sku: typeof r.sku === 'string' ? r.sku : '',
            name: typeof r.name === 'string' && r.name ? r.name : 'Vật tư',
            quantity: qty,
            unit: typeof r.unit === 'string' ? r.unit : '',
            unit_cost: Math.round(unitCost),
            total_cost: Math.round(qty * unitCost),
          };
        });
        const workers: ProjectWorker[] = (worksByProject.get(String(row.id)) || []).map((rw) => {
          const r = rw as Record<string, unknown>;
          const days = num(r.days_worked);
          const wage = Math.round(num(r.daily_wage));
          const allow = Math.round(num(r.allowance));
          return {
            id: String(r.id),
            employee_id: typeof r.employee_id === 'string' ? r.employee_id : undefined,
            employee_code: typeof r.employee_code === 'string' ? r.employee_code : undefined,
            worker_name: typeof r.worker_name === 'string' ? r.worker_name : '',
            role: typeof r.role === 'string' && r.role ? r.role : 'Thợ',
            days_worked: days,
            daily_wage: wage,
            allowance: allow,
            total_wage: Math.round(days * wage + allow),
          };
        });
        const serverCustomerId = typeof row.customer_id === 'string' ? row.customer_id : '';
        const base: Project = {
          id: String(row.id),
          code: typeof row.code === 'string' ? row.code : '',
          name: typeof row.name === 'string' ? row.name : '',
          customer_id: (serverCustomerId && serverToLocalCustomer.get(serverCustomerId)) || serverCustomerId,
          customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
          address: typeof row.address === 'string' ? row.address : '',
          phase: row.phase === 2 ? 2 : row.phase === 3 ? 3 : 1,
          estimated_revenue: Math.round(num(row.estimated_revenue)),
          settled_revenue: Math.round(num(row.settled_revenue)),
          deposit_amount: Math.round(num(row.deposit_amount)),
          materials,
          workers,
          other_costs: Math.round(num(row.other_costs)),
          material_cost_total: 0,
          labor_cost_total: 0,
          total_cost: 0,
          actual_profit: 0,
          status:
            row.status === 'completed' || row.status === 'in_progress'
              ? row.status
              : 'planning',
          created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        };
        return recalcProjectTotals(base);
      });
      const localRows = await db.projects.toArray().catch(() => [] as Project[]);
      const localByServerId = new Map(
        localRows.filter((p) => p.server_id).map((p) => [p.server_id as string, p])
      );
      const withLocalIds = mapped.map((m) => {
        const local = localByServerId.get(m.id);
        return { ...m, id: local ? local.id : m.id, server_id: m.id };
      });
      const pushedCodes = new Set(withLocalIds.map((m) => m.code));
      const neverPushed = localRows.filter((p) => !p.server_id && !pushedCodes.has(p.code));
      const next = [...withLocalIds, ...neverPushed];
      setProjects((prev) => stableNext(prev, next));
      await db.projects.clear().catch(() => {});
      await db.projects.bulkAdd(next).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Project pull failed (giữ local):', err);
      return false;
    }
  }, [supa, user, customerMap]);

  // Đồng bộ đầy đủ khi online: kéo trước, đẩy nốt bản local chưa lên.
  const syncProjects = useCallback(async (): Promise<void> => {
    if (!supa || !user || !isOnline) return;
    await refreshServerProjects();
    const locals = await db.projects.toArray().catch(() => [] as Project[]);
    for (const p of locals.filter((x) => !x.server_id)) {
      await pushProjectToServer(p);
    }
  }, [supa, user, isOnline, refreshServerProjects, pushProjectToServer]);

  const addProject = useCallback(
    async (data: Omit<Project, 'id' | 'code'>): Promise<Project> => {
      const code = generateOrderCode('CT');
      const newProj: Project = {
        ...data,
        id: `proj-${Date.now()}`,
        code,
      };
      setProjects((prev) => [...prev, newProj]);
      await db.projects.add(newProj);
      // Đẩy lên server để remap id local -> uuid (thất bại vẫn giữ local)
      const synced = await pushProjectToServer(newProj);
      return synced ?? newProj;
    },
    [pushProjectToServer]
  );

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    await db.projects.update(id, updates);
    const row = await db.projects.get(id).catch(() => undefined);
    if (row) void pushProjectToServer(row as Project);
  }, [pushProjectToServer]);

  // Phase 2: xuất vật tư cho công trình — trừ tồn kho thật + thẻ kho export_project.
  // Chỉ hàng goods/area (service/combo chặn); đơn giá vốn = avg_cost hiện tại.
  const exportProjectMaterial = useCallback(
    async (projectId: string, productId: string, quantity: number): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi xuất vật tư!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const product = products.find((x) => x.id === productId);
      if (!product) return null;
      if (product.product_type === 'service' || product.product_type === 'combo') {
        alert('Hàng dịch vụ/combo không xuất trực tiếp cho công trình! Chọn hàng hóa hoặc hàng diện tích.');
        return null;
      }
      if (!(quantity > 0)) {
        alert('Số lượng xuất phải lớn hơn 0!');
        return null;
      }
      if (product.stock_quantity < quantity) {
        alert(`Tồn kho không đủ: ${product.sku} (tồn ${product.stock_quantity} ${product.unit}, cần ${quantity}).`);
        return null;
      }
      const unit_cost = product.avg_cost || 0;
      const line: ProjectMaterial = {
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        quantity,
        unit: product.unit,
        unit_cost,
        total_cost: Math.round(quantity * unit_cost),
      };
      const nextStock = Math.round((product.stock_quantity - quantity) * 1000) / 1000;
      setProducts((prev) => prev.map((x) => (x.id === productId ? { ...x, stock_quantity: nextStock } : x)));
      db.products.update(productId, { stock_quantity: nextStock }).catch(console.warn);
      const movement: StockMovement = {
        id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        reference_code: project.code,
        product_id: product.id,
        product_name: product.name,
        movement_type: 'export_project',
        quantity: -quantity,
        previous_stock: product.stock_quantity,
        new_stock: nextStock,
        note: `Xuất cho công trình ${project.code} (${project.name})`,
        created_at: new Date().toISOString(),
      };
      setStockMovements((prev) => [movement, ...prev]);
      const updated = recalcProjectTotals({ ...project, materials: [...project.materials, line] });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts, setStockMovements]
  );

  // Phase 2 (batch): xuất 1 phiếu nhiều dòng — validate hết trước, 1 lần trừ kho + 1 lần chốt đơn
  const exportProjectMaterialBatch = useCallback(
    async (projectId: string, lines: { productId: string; quantity: number }[]): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi xuất vật tư!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      // Gộp dòng trùng + validate toàn phiếu trước khi trừ (1 dòng lỗi -> hủy cả phiếu)
      const merged = new Map<string, number>();
      for (const l of lines) merged.set(l.productId, (merged.get(l.productId) || 0) + (l.quantity || 0));
      const errors: string[] = [];
      const items: { product: NonNullable<ReturnType<typeof products.find>>; quantity: number }[] = [];
      for (const [pid, qty] of merged) {
        const product = products.find((x) => x.id === pid);
        if (!product) {
          errors.push('Mặt hàng không tồn tại trong kho.');
          continue;
        }
        if (product.product_type === 'service' || product.product_type === 'combo') {
          errors.push(`${product.sku}: dịch vụ/combo không xuất trực tiếp.`);
          continue;
        }
        if (!(qty > 0)) {
          errors.push(`${product.sku}: số lượng phải lớn hơn 0.`);
          continue;
        }
        if (product.stock_quantity < qty) {
          errors.push(`${product.sku}: tồn ${product.stock_quantity} ${product.unit}, cần ${qty}.`);
          continue;
        }
        items.push({ product, quantity: qty });
      }
      if (items.length === 0) {
        alert('Phiếu xuất chưa có dòng hợp lệ!' + (errors.length > 0 ? `\n${errors.join('\n')}` : ''));
        return null;
      }
      if (errors.length > 0) {
        alert(`Phiếu có dòng lỗi, chưa xuất:\n${errors.join('\n')}`);
        return null;
      }
      const now = new Date().toISOString();
      const newLines: ProjectMaterial[] = [];
      const movements: StockMovement[] = [];
      const stockAfter = new Map(products.map((p) => [p.id, p.stock_quantity]));
      for (const { product, quantity } of items) {
        const prevStock = stockAfter.get(product.id) || 0;
        const nextStock = Math.round((prevStock - quantity) * 1000) / 1000;
        stockAfter.set(product.id, nextStock);
        newLines.push({
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          unit: product.unit,
          unit_cost: product.avg_cost || 0,
          total_cost: Math.round(quantity * (product.avg_cost || 0)),
        });
        movements.push({
          id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          reference_code: project.code,
          product_id: product.id,
          product_name: product.name,
          movement_type: 'export_project',
          quantity: -quantity,
          previous_stock: prevStock,
          new_stock: nextStock,
          note: `Xuất cho công trình ${project.code} (${project.name})`,
          created_at: now,
        });
      }
      setProducts((prev) =>
        prev.map((x) => {
          const ns = stockAfter.get(x.id);
          if (ns !== undefined && ns !== x.stock_quantity) {
            db.products.update(x.id, { stock_quantity: ns }).catch(console.warn);
            return { ...x, stock_quantity: ns };
          }
          return x;
        })
      );
      setStockMovements((prev) => [...movements.reverse(), ...prev]);
      const updated = recalcProjectTotals({ ...project, materials: [...project.materials, ...newLines] });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts, setStockMovements]
  );

  // Phase 3: đưa chi phí nhân công vào công trình (thợ lấy từ hồ sơ nhân sự, link employee_id)
  const addProjectWorker = useCallback(
    async (
      projectId: string,
      worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi thêm thợ!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (!worker.worker_name.trim()) {
        alert('Vui lòng nhập tên thợ!');
        return null;
      }
      if (!(worker.days_worked > 0)) {
        alert('Số ngày công phải lớn hơn 0!');
        return null;
      }
      const line: ProjectWorker = {
        id: `pw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        employee_id: worker.employee_id || undefined,
        employee_code: worker.employee_code || undefined,
        worker_name: worker.worker_name.trim(),
        role: worker.role.trim() || 'Thợ',
        days_worked: worker.days_worked,
        daily_wage: Math.max(0, Math.round(worker.daily_wage)),
        allowance: Math.max(0, Math.round(worker.allowance)),
        total_wage: 0,
      };
      line.total_wage = Math.round(line.days_worked * line.daily_wage + line.allowance);
      // Trùng thợ (cùng mã NV, hoặc thợ ngoài cùng tên+việc+lương) -> cộng dồn ngày công
      // vào dòng cũ thay vì tách dòng mới
      const dupIdx = project.workers.findIndex((w) =>
        line.employee_id
          ? w.employee_id === line.employee_id
          : !w.employee_id &&
            w.worker_name.trim().toLowerCase() === line.worker_name.trim().toLowerCase() &&
            w.role === line.role &&
            w.daily_wage === line.daily_wage
      );
      const workers =
        dupIdx >= 0
          ? project.workers.map((w, i) => {
              if (i !== dupIdx) return w;
              const days_worked = Math.round((w.days_worked + line.days_worked) * 1000) / 1000;
              return {
                ...w,
                days_worked,
                allowance: Math.max(w.allowance, line.allowance),
                total_wage: Math.round(days_worked * w.daily_wage + Math.max(w.allowance, line.allowance)),
              };
            })
          : [...project.workers, line];
      const updated = recalcProjectTotals({ ...project, workers });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        workers: updated.workers,
        labor_cost_total: updated.labor_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, setLoginOpen, pushProjectToServer]
  );

  // Sửa số tài chính (dự toán/quyết toán/chi khác độc lập nhau) + tính lại lãi
  const updateProjectFinance = useCallback(
    async (
      projectId: string,
      finance: { estimated_revenue?: number; settled_revenue?: number; other_costs?: number }
    ): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi sửa công trình!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const patch: Partial<Project> = {};
      if (finance.estimated_revenue !== undefined)
        patch.estimated_revenue = Math.max(0, Math.round(finance.estimated_revenue));
      if (finance.settled_revenue !== undefined)
        patch.settled_revenue = Math.max(0, Math.round(finance.settled_revenue));
      if (finance.other_costs !== undefined) patch.other_costs = Math.max(0, Math.round(finance.other_costs));
      const updated = recalcProjectTotals({ ...project, ...patch });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        estimated_revenue: updated.estimated_revenue,
        settled_revenue: updated.settled_revenue,
        other_costs: updated.other_costs,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, setLoginOpen, pushProjectToServer]
  );

  // Thu cọc/tạm ứng chủ đầu tư: phiếu thu deposit theo mã CT + cộng dồn deposit_amount.
  // (Cọc không trừ vào lãi — lãi = quyết toán − tổng chi; còn phải thu = quyết toán − đã cọc.)
  const collectProjectDeposit = useCallback(
    async (projectId: string, amount: number, paymentMethod: 'cash' | 'transfer'): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi thu cọc!');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        alert('Ca đã đóng! Mở ca mới (F12) trước khi thu cọc công trình.');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project || !(amount > 0)) return null;
      const entry: CashbookEntry = {
        id: `cb-${Date.now()}-projdep`,
        code: generateOrderCode('PT'),
        type: 'receipt',
        fund_type: paymentMethod === 'cash' ? 'cash' : 'bank',
        category: 'deposit',
        amount: Math.round(amount),
        reference_order_code: project.code,
        partner_name: project.customer_name,
        note: `Thu cọc công trình ${project.code} (${project.name})`,
        created_at: new Date().toISOString(),
      };
      setCashbook((prev) => [entry, ...prev]);
      db.cashbook.add(entry).catch(console.warn);
      if (paymentMethod === 'cash') {
        setCurrentShift((prev) => {
          const updatedShift: Shift = {
            ...prev,
            cash_sales: prev.cash_sales + Math.round(amount),
            expected_cash: prev.expected_cash + Math.round(amount),
          };
          db.shifts.put(updatedShift).catch(console.warn);
          return updatedShift;
        });
      }
      const updated: Project = {
        ...project,
        deposit_amount: (project.deposit_amount || 0) + Math.round(amount),
      };
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, { deposit_amount: updated.deposit_amount });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, supa, user, currentShift, setLoginOpen, setCashbook, setCurrentShift, pushProjectToServer]
  );

  const removeProjectLine = useCallback(
    async (projectId: string, kind: 'material' | 'worker', lineKey: string): Promise<Project | null> => {
      if (supa && !user) {
        alert('Vui lòng đăng nhập trước khi sửa công trình!');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (kind === 'material') {
        if (currentShift.status !== 'open') {
          alert('Ca đã đóng! Mở ca mới (F12) trước khi hoàn vật tư về kho.');
          return null;
        }
        const idx = Number(lineKey);
        const line = project.materials[idx];
        if (!line) return null;
        const product = products.find((x) => x.id === line.product_id);
        if (product) {
          const nextStock = Math.round((product.stock_quantity + line.quantity) * 1000) / 1000;
          setProducts((prev) => prev.map((x) => (x.id === product.id ? { ...x, stock_quantity: nextStock } : x)));
          db.products.update(product.id, { stock_quantity: nextStock }).catch(console.warn);
          const movement: StockMovement = {
            id: `sm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            reference_code: project.code,
            product_id: product.id,
            product_name: product.name,
            movement_type: 'return',
            quantity: line.quantity,
            previous_stock: product.stock_quantity,
            new_stock: nextStock,
            note: `Hoàn vật tư từ công trình ${project.code} (${project.name})`,
            created_at: new Date().toISOString(),
          };
          setStockMovements((prev) => [movement, ...prev]);
        }
      const updated = recalcProjectTotals({
        ...project,
        materials: project.materials.filter((_, i) => i !== idx),
      });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        materials: updated.materials,
        material_cost_total: updated.material_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
      }
      const updated = recalcProjectTotals({
        ...project,
        workers: project.workers.filter((w) => w.id !== lineKey),
      });
      setProjects((prev) => prev.map((x) => (x.id === projectId ? updated : x)));
      await db.projects.update(projectId, {
        workers: updated.workers,
        labor_cost_total: updated.labor_cost_total,
        total_cost: updated.total_cost,
        actual_profit: updated.actual_profit,
      });
      void pushProjectToServer(updated);
      return updated;
    },
    [projects, products, supa, user, currentShift, setLoginOpen, setProducts, setStockMovements, pushProjectToServer]
  );

  return {
    projects,
    setProjects,
    pushProjectToServer,
    refreshServerProjects,
    syncProjects,
    addProject,
    updateProject,
    exportProjectMaterial,
    exportProjectMaterialBatch,
    addProjectWorker,
    removeProjectLine,
    updateProjectFinance,
    collectProjectDeposit,
  };
}
