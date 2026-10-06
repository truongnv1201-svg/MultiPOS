// P3-tx/projects: công trình/dự án 2 chiều + xuất vật tư/nhân công (tách verbatim).
'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../auth';
import { useCatalog } from '../catalog';
import { useNetwork } from '../network';
import type {
  Project,
  ProjectMaterial,
  ProjectWorker,
  CashbookEntry,
  Shift,
  StockAdjustment,
  StockAdjustReason,
  StockMovement,
} from '../../types';
import { STOCK_ADJUST_REASON_LABEL } from '../../types';
import { db, generateOrderCode } from '../../db';
import { dailyCodeStamp, nextDailyCode } from '../../codes';
import { cacheKeys, mirrorUpsert } from './mirror';
import { asUuidOrNull } from './constants';
import { stableNext } from '../stable';
import { notify } from '@/components/common/Toast';
import { vietnamizeError } from '@/lib/error-vi';

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
  // ---- 0064: điều chỉnh tồn / hao hụt ----
  stockAdjustments: StockAdjustment[];
  refreshServerStockAdjustments: (force?: boolean) => Promise<boolean>;
  adjustStock: (
    lines: StockAdjustLine[],
    reason: StockAdjustReason,
    options?: { note?: string; projectId?: string | null }
  ) => Promise<StockAdjustResult | null>;
  assignAdjustProject: (adjustmentId: string, projectId: string) => Promise<boolean>;
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
  // ---- 0066: xoá dự án tạo nhầm (server hoàn kho + giữ audit, client chỉ mirror) ----
  deleteProject: (projectId: string) => Promise<{ code: string; material_lines: number; worker_lines: number; restored_lines: number; unlinked_adjustments: number } | null>;
}

/** Một dòng phiếu điều chỉnh: chấn lệch (countedStock) HOẶC nhập thẳng chênh lệch (delta). */
export interface StockAdjustLine {
  productId: string;
  countedStock?: number;
  delta?: number;
}

export interface StockAdjustResult {
  code: string;
  adjusted: number;
  lossAmount: number;
}

export function useTxProjects({ currentShift, setCashbook, setCurrentShift, setStockMovements }: TxProjectsDeps): TxProjects {
  const { supa, user, profile, setLoginOpen } = useAuth();
  const { products, setProducts, customerMap } = useCatalog();
  const { isOnline } = useNetwork();
  const [projects, setProjects] = useState<Project[]>([]);
  // 0064: sổ phiếu điều chỉnh tồn (hao hụt / đếm thừa) — nguồn cho cảnh báo
  // "còn N mục chưa gán công trình" và cho báo cáo hao hụt.
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>([]);
  // Watermark kéo delta: phiếu điều chỉnh ít (vài chục/năm) nhưng vẫn không kéo lại
  // toàn bộ mỗi lần mở màn. Khoảng chồng 2s chống bỏ sót dòng trùng giây.
  const adjustWatermarkRef = useRef<string | null>(null);
  const STOCK_ADJUSTMENT_OVERLAP_MS = 2000;
  const STOCK_ADJUSTMENT_LIMIT = 500;

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
          // 0065: không gửi phase/status — cột đã drop, PostgREST báo lỗi cột không tồn tại
          estimated_revenue: Math.round(project.estimated_revenue || 0),
          settled_revenue: Math.round(project.settled_revenue || 0),
          deposit_amount: Math.round(project.deposit_amount || 0),
          other_costs: Math.round(project.other_costs || 0),
        };
        if (serverId) {
          const { error } = await supa.from('projects').update(header).eq('id', serverId);
          if (error) throw error;
        } else {
          const { data, error } = await supa.from('projects').insert(header).select('id').single();
          if (error) {
            // Mã CT đã tồn tại trên server (2 máy cùng orderSeq sinh trùng mã).
            // TUYỆT ĐỐI không PATCH theo id tra từ code — đó là dự án của người
            // khác, đè lên là mất dữ liệu (vật tư/thợ của họ bị thay + local bị
            // gắn nhầm server_id). Sinh mã mới đẩy riêng (tối đa 3 lần), báo rõ
            // để user đối soát trùng mã.
            if ((error as { code?: string }).code === '23505') {
              let retryCode = project.code;
              let retryData = null as null | { id: string };
              for (let attempt = 0; attempt < 3; attempt++) {
                retryCode = generateOrderCode('CT');
                const retry = await supa
                  .from('projects')
                  .insert({ ...header, code: retryCode })
                  .select('id')
                  .single();
                if (!retry.error) {
                  retryData = retry.data as { id: string };
                  break;
                }
                if ((retry.error as { code?: string }).code !== '23505') throw retry.error;
              }
              if (!retryData) throw error;
              await db.projects.update(project.id, { code: retryCode }).catch(() => {});
              setProjects((prev) =>
                prev.map((p) => (p.id === project.id ? { ...p, code: retryCode } : p))
              );
              notify(
                `Mã ${project.code} đã có trên máy chủ (trùng mã) — dự án này đã đẩy với mã mới ${retryCode}, không đè lên dự án của người khác.`,
                'info'
              );
              serverId = retryData.id as string;
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
      // Khoá cache trước khi gọi server (xem lib/store/tx/mirror.ts).
      const staleProjectIds = await cacheKeys(db.projects).catch(() => [] as string[]);
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
            // 0064: dòng hao hụt (điều chỉnh tồn) — cần giữ cờ để sổ vật tư hiển thị
            // đúng và để không ai hiểu nhầm là xuất vật tư bình thường.
            is_adjust: r.is_adjust === true,
            note: typeof r.note === 'string' && r.note ? r.note : undefined,
            created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
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
          // 0065: bỏ hẳn phase/status — chỉ để hiển thị, không điều khiển nghiệp vụ nào.
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
      // Upsert + dọn theo khoá có từ trước: dự án vừa tạo cục bộ trong lúc chờ server
      // không bị xoá khỏi cache (trước đây clear() rồi bulkAdd bản chụp cũ).
      await mirrorUpsert(db.projects, next, staleProjectIds).catch(() => {});
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

  // Xuất vật tư cho công trình — trừ tồn kho thật + thẻ kho export_project.
  // Chỉ hàng goods/area (service/combo chặn); đơn giá vốn = avg_cost hiện tại.
  const exportProjectMaterial = useCallback(
    async (projectId: string, productId: string, quantity: number): Promise<Project | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi xuất vật tư!', 'error');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.', 'error');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      const product = products.find((x) => x.id === productId);
      if (!product) return null;
      if (product.product_type === 'service' || product.product_type === 'combo') {
        notify('Hàng dịch vụ/combo không xuất trực tiếp cho công trình! Chọn hàng hóa hoặc hàng diện tích.', 'error');
        return null;
      }
      if (!(quantity > 0)) {
        notify('Số lượng xuất phải lớn hơn 0!', 'error');
        return null;
      }
      if (product.stock_quantity < quantity) {
        notify(`Tồn kho không đủ: ${product.sku} (tồn ${product.stock_quantity} ${product.unit}, cần ${quantity}).`, 'error');
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

  // Xuất vật tư (batch): xuất 1 phiếu nhiều dòng — validate hết trước, 1 lần trừ kho + 1 lần chốt đơn
  const exportProjectMaterialBatch = useCallback(
    async (projectId: string, lines: { productId: string; quantity: number }[]): Promise<Project | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi xuất vật tư!', 'error');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Mở ca mới (F12) trước khi xuất vật tư cho công trình.', 'error');
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
        notify('Phiếu xuất chưa có dòng hợp lệ!' + (errors.length > 0 ? `\n${errors.join('\n')}` : ''), 'error');
        return null;
      }
      if (errors.length > 0) {
        notify(`Phiếu có dòng lỗi, chưa xuất:\n${errors.join('\n')}`, 'error');
        return null;
      }

      // 0063: ghi THẬT lên server trước khi cập nhật local. Trước đây hàm này chỉ ghi
      // local/Dexie -> lần syncProjects kéo bản server về là mất sạch dòng vừa xuất
      // (đã tái hiện: xuất xong tải lại trang là trống). Server chặn âm kho + chốt giá
      // vốn; local chỉ là mirror để UI phản hồi tức thì.
      if (supa && user) {
        const rpcItems = items.map((i) => ({ sku: i.product.sku, quantity: i.quantity }));
        const { data, error } = await supa.rpc('issue_project_materials', {
          p_project_id: project.server_id || project.id,
          p_items: rpcItems,
        });
        if (error || !data) {
          notify(`Không xuất được: ${vietnamizeError(error) || 'lỗi server'}`, 'error');
          // Kéo lại tồn kho từ server để UI không lệch với thực tế
          void db.products.toArray().then((rows) => setProducts(rows));
          return null;
        }
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

  // ================================================================
  // 0064 — ĐIỀU CHỈNH TỒN / HAO HỤT
  //
  // Vì sao có: vật tư tồn lâu ngày hao mòn (vỡ, hết hạn, thất lạc, đếm sai) nhưng trước
  // đây KHÔNG có đường nào sửa tồn có kiểm soát. Hệ quả nặng: tồn hệ thống về 0 trong
  // khi kho thực tế còn hàng -> POS chặn bán và server từ chối (Invariant #2).
  //
  // Nguyên tắc đã chốt với chủ app:
  // 1) KHÔNG ghi sổ quỹ. Tiền mua đã ghi "Chi" lúc nhập kho; ghi thêm là tính 2 lần.
  //    adjustStock cố tình KHÔNG đụng cashbook.
  // 2) avg_cost KHÔNG đổi (giá vốn đã chốt lúc nhập, hao mòn không tạo giá vốn mới).
  // 3) Công trình là TÙY CHỌN. Có chọn -> ghi thêm dòng hao hụt vào sổ vật tư công trình
  //    (P&L giảm đúng, tồn KHÔNG trừ thêm); không chọn -> hao hụt tồn kho chung + cảnh báo.
  // 4) Server là chân lý: gọi RPC adjust_stock TRƯỚC, thành công mới cập nhật local.
  // ================================================================

  const refreshServerStockAdjustments = useCallback(
    async (force = false): Promise<boolean> => {
      if (!supa || !user) return false;
      try {
        // Số phiếu điều chỉnh ít (vài chục/năm) nên kéo delta theo watermark, không cần cache.
        let query = supa
          .from('stock_adjustments')
          .select('id, client_ref, code, product_id, sku, previous_stock, counted_stock, delta, reason, note, project_id, unit_cost, loss_amount, adjusted_by_name, project_assigned_at, created_at')
          .order('created_at', { ascending: false })
          .limit(STOCK_ADJUSTMENT_LIMIT);
        if (adjustWatermarkRef.current && !force) {
          query = query.gte('created_at', new Date(new Date(adjustWatermarkRef.current).getTime() - STOCK_ADJUSTMENT_OVERLAP_MS).toISOString());
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows = (data || []) as Record<string, unknown>[];
        const productById = new Map(products.map((p) => [p.id, p]));
        const projectById = new Map(projects.map((p) => [p.id, p]));
        const mapped: StockAdjustment[] = rows.map((row) => {
          const pid = String(row.project_id || '');
          const proj = projectById.get(pid);
          return {
            // ƯU TIÊN client_ref: dòng local vừa ghi có id = clientRef, nên dùng client_ref
            // làm khoá gộp thì dòng optimistic trong UI và dòng này là MỘT dòng, không phải hai.
            // Dòng cũ (client_ref NULL) rơi về id server như trước.
            id: String(row.client_ref || row.id),
            code: String(row.code || ''),
            product_id: String(row.product_id || ''),
            product_name: productById.get(String(row.product_id || ''))?.name || String(row.sku || ''),
            sku: String(row.sku || ''),
            previous_stock: Number(row.previous_stock || 0),
            counted_stock: row.counted_stock == null ? null : Number(row.counted_stock),
            delta: Number(row.delta || 0),
            reason: (String(row.reason || 'other') as StockAdjustReason) in STOCK_ADJUST_REASON_LABEL
              ? (String(row.reason) as StockAdjustReason)
              : 'other',
            note: String(row.note || ''),
            project_id: pid || null,
            project_code: proj?.code || '',
            project_name: proj?.name || '',
            project_assigned_at: row.project_assigned_at ? String(row.project_assigned_at) : null,
            unit_cost: Number(row.unit_cost || 0),
            loss_amount: Number(row.loss_amount || 0),
            adjusted_by_name: String(row.adjusted_by_name || ''),
            created_at: String(row.created_at || ''),
          };
        });
        if (mapped.length > 0) {
          adjustWatermarkRef.current = mapped[0].created_at;
          setStockAdjustments((prev) => {
            const byId = new Map(prev.map((a) => [a.id, a]));
            for (const a of mapped) byId.set(a.id, a);
            return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          });
        }
        return true;
      } catch (err) {
        console.warn('Stock adjustments refresh failed:', err);
        return false;
      }
    },
    [supa, user, products, projects]
  );

  const adjustStock = useCallback(
    async (
      lines: StockAdjustLine[],
      reason: StockAdjustReason,
      options?: { note?: string; projectId?: string | null }
    ): Promise<StockAdjustResult | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi điều chỉnh tồn kho!', 'error');
        setLoginOpen(true);
        return null;
      }
      // Server cũng chặn is_manager() (0064) — đây chỉ để chặn sớm và báo rõ.
      if (supa && profile && profile.role !== 'admin' && profile.role !== 'manager') {
        notify('Chỉ Admin/Quản lý được điều chỉnh tồn kho!', 'error');
        return null;
      }
      if (supa && !isOnline) {
        notify('Đang offline — cần mạng để ghi phiếu điều chỉnh lên server. Thử lại khi có mạng.', 'error');
        return null;
      }
      if (!supa) {
        notify('Điều chỉnh tồn cần kết nối máy chủ (chưa cấu hình Supabase).', 'error');
        return null;
      }

      // Validate toàn phiếu trước: 1 dòng sai -> hủy cả phiếu (server cũng vậy).
      const errors: string[] = [];
      const items: { product: (typeof products)[number]; countedStock?: number; delta?: number }[] = [];
      for (const l of lines) {
        const product = products.find((x) => x.id === l.productId);
        if (!product) {
          errors.push('Mặt hàng không tồn tại trong kho.');
          continue;
        }
        if (product.product_type === 'service' || product.product_type === 'combo') {
          errors.push(`${product.sku}: dịch vụ/combo không có tồn để điều chỉnh.`);
          continue;
        }
        if (l.countedStock !== undefined) {
          if (!(l.countedStock >= 0)) {
            errors.push(`${product.sku}: tồn thực tế phải >= 0.`);
            continue;
          }
          if (l.countedStock === product.stock_quantity) continue; // không lệch -> bỏ dòng
          items.push({ product, countedStock: l.countedStock });
          continue;
        }
        if (l.delta === undefined || !Number.isFinite(l.delta) || l.delta === 0) continue;
        if (product.stock_quantity + l.delta < 0) {
          errors.push(`${product.sku}: điều chỉnh sẽ làm tồn âm (tồn ${product.stock_quantity} ${product.unit}).`);
          continue;
        }
        items.push({ product, delta: l.delta });
      }
      if (items.length === 0) {
        notify(
          errors.length > 0
            ? `Phiếu điều chỉnh chưa hợp lệ:\n${errors.join('\n')}`
            : 'Không có dòng nào chênh lệch — tồn hệ thống khớp tồn thực tế.',
          errors.length > 0 ? 'error' : 'info'
        );
        return null;
      }
      if (errors.length > 0) {
        notify(`Phiếu có dòng lỗi, chưa điều chỉnh:\n${errors.join('\n')}`, 'error');
        return null;
      }

      const project = options?.projectId ? projects.find((p) => p.id === options.projectId) : null;
      // Mã phiếu PQ-YYMMDD-NNNN nối tiếp (lib/codes.ts): max local (đã kéo) + max server
      // để 2 máy không trùng số đầu ngày. Mã cọc không unique phía server nên khỏi retry.
      const stamp = dailyCodeStamp();
      let serverCodes: string[] = [];
      try {
        const { data } = await supa
          .from('stock_adjustments')
          .select('code')
          .like('code', `PQ-${stamp}-%`)
          .order('code', { ascending: false })
          .limit(5);
        serverCodes = ((data as any[]) || []).map((r) => String(r.code || ''));
      } catch {
        /* offline-first: rớt mạng thì dùng local (hàm này vốn đã cần mạng) */
      }
      const code = nextDailyCode(
        [...stockAdjustments.map((a) => a.code), ...serverCodes],
        'PQ',
        stamp
      );
      const rpcProjectId = project ? project.server_id || project.id : null;

      // clientRef khớp 1-1 với dòng audit server -> server bỏ qua dòng đã ghi (bấm Ghi 2
      // lần / retry mạng KHÔNG sinh dòng thứ 2), và client gộp được dòng local với dòng
      // server khi kéo lại (trước đây id local giả "adj-..." != id server uuid nên mỗi
      // phiếu hiện 2 dòng giống nhau trong sổ điều chỉnh).
      const clientRefs = new Map<string, string>();
      const { data, error } = await supa.rpc('adjust_stock', {
        p_code: code,
        p_items: items.map((i) => {
          const ref = `adj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          clientRefs.set(i.product.id, ref);
          return {
            sku: i.product.sku,
            ...(i.countedStock !== undefined ? { countedStock: i.countedStock } : { delta: i.delta }),
            projectId: rpcProjectId,
            reason,
            note: options?.note || '',
            clientRef: ref,
          };
        }),
      });
      if (error || !data) {
        const msg = vietnamizeError(error) || 'lỗi server';
        notify(
          msg.includes('điều chỉnh tồn') || msg.includes('function')
            ? `Không điều chỉnh được: ${msg}`
            : `Không điều chỉnh được tồn: ${msg}`,
          'error'
        );
        // Kéo lại tồn từ local DB để UI không lệch với server
        void db.products.toArray().then((rows) => setProducts(rows));
        return null;
      }

      // ---- Server đã ghi thật. Cập nhật local để UI phản hồi tức thì. ----
      const now = new Date().toISOString();
      const reasonLabel = STOCK_ADJUST_REASON_LABEL[reason];
      const movements: StockMovement[] = [];
      const adjustments: StockAdjustment[] = [];
      const wasteLinesBySku = new Map<string, number>();
      const stockAfter = new Map(products.map((p) => [p.id, p.stock_quantity]));
      for (const i of items) {
        const prevStock = stockAfter.get(i.product.id) || 0;
        const delta = i.countedStock !== undefined ? i.countedStock - prevStock : (i.delta as number);
        const nextStock = Math.round((prevStock + delta) * 1000) / 1000;
        stockAfter.set(i.product.id, nextStock);
        movements.push({
          id: `sm-adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          reference_code: code,
          product_id: i.product.id,
          product_name: i.product.name,
          movement_type: delta < 0 ? 'adjust_loss' : 'adjust_gain',
          quantity: delta,
          previous_stock: prevStock,
          new_stock: nextStock,
          note: `Điều chỉnh tồn: ${reasonLabel}${rpcProjectId ? ' — hao hụt công trình' : ' — kho'}`,
          created_at: now,
        });
        adjustments.push({
          // id = clientRef đã gửi lên server: dòng local và dòng server về sau có CÙNG id
          // nên gộp theo id không sinh dòng trùng. (Trước đây id local "adj-Date-random"
          // khác id server uuid nên mỗi lần kéo lại là nhân đôi dòng trong sổ điều chỉnh.)
          id: clientRefs.get(i.product.id) || `adj-${Date.now()}`,
          code,
          product_id: i.product.id,
          product_name: i.product.name,
          sku: i.product.sku,
          previous_stock: prevStock,
          counted_stock: i.countedStock ?? null,
          delta,
          reason,
          note: options?.note || '',
          project_id: project ? project.id : null,
          project_code: project?.code || '',
          project_name: project?.name || '',
          project_assigned_at: rpcProjectId ? now : null,
          unit_cost: i.product.avg_cost || 0,
          loss_amount: delta < 0 ? Math.round(-delta * (i.product.avg_cost || 0)) : 0,
          adjusted_by_name: profile?.full_name || user?.email || 'Quản lý',
          created_at: now,
        });
        if (delta < 0) wasteLinesBySku.set(i.product.id, -delta);
      }

      setProducts((prev) =>
        prev.map((x) => {
          const ns = stockAfter.get(x.id);
          if (ns === undefined || ns === x.stock_quantity) return x;
          db.products.update(x.id, { stock_quantity: ns }).catch(console.warn);
          return { ...x, stock_quantity: ns };
        })
      );
      setStockMovements((prev) => [...movements.reverse(), ...prev]);
      // Gộp theo id thay vì cộng thẳng: dòng local vừa tạo có id = clientRef, và nếu
      // phiếu này đã có trong state (vd bấm Ghi lại, hoặc kéo server vừa rồi) thì thay
      // bản cũ thay vì thêm dòng thứ hai. Cộng thẳng là lý do sổ từng hiện 2 dòng giống nhau.
      setStockAdjustments((prev) => {
        const byId = new Map(prev.map((a) => [a.id, a]));
        for (const a of adjustments) byId.set(a.id, a);
        return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      });

      // Dòng hao hụt trong sổ vật tư công trình: tồn KHÔNG trừ thêm (đã trừ ở trên),
      // nhưng recalcProjectTotals cộng hết dòng -> lợi nhuận công trình giảm đúng.
      if (project && wasteLinesBySku.size > 0) {
        const wasteLines: ProjectMaterial[] = [];
        for (const [pid, qty] of wasteLinesBySku) {
          const p = products.find((x) => x.id === pid);
          if (!p) continue;
          const unitCost = p.avg_cost || 0;
          wasteLines.push({
            product_id: p.id,
            sku: p.sku,
            name: p.name,
            quantity: qty,
            unit: p.unit,
            unit_cost: unitCost,
            total_cost: Math.round(qty * unitCost),
            is_adjust: true,
            note: `Hao hụt: ${reasonLabel}`,
            created_at: now,
          });
        }
        if (wasteLines.length > 0) {
          const updated = recalcProjectTotals({ ...project, materials: [...project.materials, ...wasteLines] });
          setProjects((prev) => prev.map((x) => (x.id === project.id ? updated : x)));
          await db.projects.update(project.id, {
            materials: updated.materials,
            material_cost_total: updated.material_cost_total,
            total_cost: updated.total_cost,
            actual_profit: updated.actual_profit,
          });
        }
      }

      return {
        code,
        adjusted: items.length,
        lossAmount: adjustments.reduce((s, a) => s + a.loss_amount, 0),
      };
    },
    [supa, user, profile, isOnline, products, projects, stockAdjustments, setProducts, setStockMovements, setLoginOpen]
  );

  // Gán bổ sung công trình cho một khoản hao hụt đã ghi "chưa gán" — KHÔNG đụng tồn kho.
  const assignAdjustProject = useCallback(
    async (adjustmentId: string, projectId: string): Promise<boolean> => {
      if (!supa || !user) {
        notify('Cần đăng nhập để gán công trình cho khoản hao hụt!', 'error');
        return false;
      }
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        notify('Công trình không tồn tại.', 'error');
        return false;
      }
      const { data, error } = await supa.rpc('assign_adjust_project', {
        p_adjustment_id: adjustmentId,
        p_project_id: project.server_id || project.id,
      });
      if (error || !data) {
        notify(`Không gán được công trình: ${vietnamizeError(error) || 'lỗi server'}`, 'error');
        return false;
      }
      // Kéo lại công trình để sổ vật tư phản ánh dòng hao hụt vừa gán.
      await refreshServerProjects();
      void refreshServerStockAdjustments(true);
      return true;
    },
    [supa, user, projects, refreshServerProjects, refreshServerStockAdjustments]
  );

  // Đưa chi phí nhân công vào công trình (thợ lấy từ hồ sơ nhân sự, link employee_id)
  const addProjectWorker = useCallback(
    async (
      projectId: string,
      worker: { worker_name: string; role: string; days_worked: number; daily_wage: number; allowance: number; employee_id?: string; employee_code?: string }
    ): Promise<Project | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi thêm thợ!', 'error');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (!worker.worker_name.trim()) {
        notify('Vui lòng nhập tên thợ!', 'error');
        return null;
      }
      if (!(worker.days_worked > 0)) {
        notify('Số ngày công phải lớn hơn 0!', 'error');
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
        notify('Vui lòng đăng nhập trước khi sửa công trình!', 'error');
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
        notify('Vui lòng đăng nhập trước khi thu cọc!', 'error');
        setLoginOpen(true);
        return null;
      }
      if (currentShift.status !== 'open') {
        notify('Ca đã đóng! Mở ca mới (F12) trước khi thu cọc công trình.', 'error');
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

  // ================================================================
  // 0066 — XOÁ DỰ ÁN TẠO NHẦM
  //
  // Nguyên tắc (giống xuất vật tư/điều chỉnh tồn): server là chân lý — gọi RPC
  // delete_project TRƯỚC (nó hoàn kho + giữ audit trong 1 transaction), thành công
  // mới gỡ local. Không ghi local trước vì syncProjects kéo bản server về sẽ dựng
  // lại dự án vừa xoá (đúng lỗi từng gặp ở xuất vật tư).
  // Không yêu cầu mở ca: đây là thao tác sửa sai của Quản lý, không phải nghiệp vụ
  // bán/nhập trong ca. Server vẫn chặn vai trò bằng is_manager().
  // ================================================================
  const deleteProject = useCallback(
    async (
      projectId: string
    ): Promise<{ code: string; material_lines: number; worker_lines: number; restored_lines: number; unlinked_adjustments: number } | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi xoá dự án!', 'error');
        setLoginOpen(true);
        return null;
      }
      // Server cũng chặn is_manager() (0066) — đây chỉ để chặn sớm và báo rõ.
      if (supa && profile && profile.role !== 'admin' && profile.role !== 'manager') {
        notify('Chỉ Admin/Quản lý được xoá dự án!', 'error');
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) {
        notify('Dự án không tồn tại (có thể đã bị xoá).', 'error');
        return null;
      }
      if (!supa) {
        notify('Xoá dự án cần kết nối máy chủ (chưa cấu hình Supabase).', 'error');
        return null;
      }
      if (supa && !isOnline) {
        notify('Đang offline — cần mạng để xoá dự án trên server. Thử lại khi có mạng.', 'error');
        return null;
      }

      const { data, error } = await supa.rpc('delete_project', {
        p_project_id: project.server_id || project.id,
      });
      if (error || !data) {
        notify(`Không xoá được dự án: ${vietnamizeError(error) || 'lỗi server'}`, 'error');
        return null;
      }

      // ---- Server đã xoá thật. Gỡ local để UI phản hồi tức thì. ----
      // Hoàn kho local từ project.materials sẵn có (chỉ dòng thường, giống removeProjectLine;
      // server đã hoàn theo bản server — lần pull catalog sau server thắng nên tự khớp).
      const now = new Date().toISOString();
      // Cộng dồn theo mặt hàng vì 1 dự án có thể xuất cùng hàng nhiều dòng
      const restoreQty = new Map<string, number>();
      for (const m of project.materials) {
        if (m.is_adjust) continue;
        restoreQty.set(m.product_id, (restoreQty.get(m.product_id) || 0) + (m.quantity || 0));
      }
      if (restoreQty.size > 0) {
        const movements: StockMovement[] = [];
        setProducts((prev) =>
          prev.map((x) => {
            const qty = restoreQty.get(x.id) || 0;
            if (!(qty > 0)) return x;
            const ns = Math.round((x.stock_quantity + qty) * 1000) / 1000;
            db.products.update(x.id, { stock_quantity: ns }).catch(console.warn);
            movements.push({
              id: `sm-delproj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              reference_code: project.code,
              product_id: x.id,
              product_name: x.name,
              movement_type: 'return',
              quantity: qty,
              previous_stock: x.stock_quantity,
              new_stock: ns,
              note: `Trả kho khi xoá dự án ${project.code} (${project.name})`,
              created_at: now,
            });
            return { ...x, stock_quantity: ns };
          })
        );
        setStockMovements((prev) => [...movements.reverse(), ...prev]);
      }
      setProjects((prev) => prev.filter((x) => x.id !== projectId));
      db.projects.delete(projectId).catch(console.warn);
      return {
        code: String((data as Record<string, unknown>).code || project.code),
        material_lines: Number((data as Record<string, unknown>).material_lines || 0),
        worker_lines: Number((data as Record<string, unknown>).worker_lines || 0),
        restored_lines: Number((data as Record<string, unknown>).restored_lines || 0),
        unlinked_adjustments: Number((data as Record<string, unknown>).unlinked_adjustments || 0),
      };
    },
    [supa, user, profile, isOnline, projects, setLoginOpen, setProducts, setProjects, setStockMovements]
  );

  const removeProjectLine = useCallback(
    async (projectId: string, kind: 'material' | 'worker', lineKey: string): Promise<Project | null> => {
      if (supa && !user) {
        notify('Vui lòng đăng nhập trước khi sửa công trình!', 'error');
        setLoginOpen(true);
        return null;
      }
      const project = projects.find((x) => x.id === projectId);
      if (!project) return null;
      if (kind === 'material') {
        if (currentShift.status !== 'open') {
          notify('Ca đã đóng! Mở ca mới (F12) trước khi hoàn vật tư về kho.', 'error');
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
    stockAdjustments,
    refreshServerStockAdjustments,
    adjustStock,
    assignAdjustProject,
    addProjectWorker,
    removeProjectLine,
    updateProjectFinance,
    collectProjectDeposit,
    deleteProject,
  };
}
