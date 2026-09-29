-- Migration 64 — Điều chỉnh tồn kho / hao hụt (vật tư tồn lâu ngày bị hao mòn).
--
-- Vấn đề: app KHÔNG có đường nào sửa products.stock_quantity có kiểm soát. Tồn chỉ tăng
-- khi nhập, giảm khi bán/xuất. Sau nhiều tháng, hao hụt (vỡ, hết hạn, thất lạc, đếm sai)
-- làm tồn hệ thống lệch dần, và hậu quả nặng nhất là: tồn hệ thống về 0 trong khi kho
-- thực tế vẫn còn hàng -> POS chặn bán ("Tồn kho không đủ", lib/store/tx/checkout.tsx:285)
-- và server cũng từ chối (0003: "Tồn kho không đủ (Invariant #2)").
--
-- Ba thứ cần bổ sung, mọi thứ đều có dấu vết:
-- 1) stock_movements.movement_type — trước đây CỐT BẢNG KHÔNG CÓ cột này, client phải
--    đoán loại thẻ kho bằng regex trên `note` (lib/store/tx/shift-stock.tsx:93-99):
--    đoán sai là hỏng lịch sử kho. Cột thật + backfill cho dòng cũ.
-- 2) stock_adjustments: 1 phiếu điều chỉnh = 1 dòng audit (ai, lúc nào, lý do, tồn
--    trước/sau, chênh lệch, gán công trình hay chưa, giá trị hao hụt).
-- 3) project_materials: cột is_adjust + adjust_id + note + created_at. Dòng điều chỉnh
--    KHÔNG trừ kho thêm (đã trừ trong adjust_stock) nhưng VẪN cộng vào
--    material_cost_total vì recalcProjectTotals (lib/store/tx/projects.tsx:18) cộng hết
--    mọi dòng -> lợi nhuận công trình giảm đúng, công thức P&L không phải sửa.
--    adjust_id là khóa liên kết 1-1, để gán bổ sung công trình sau KHÔNG phải đoán dòng
--    nào cần xoá (đoán theo sku là cách chắc chắn xoá nhầm dòng của công trình khác).
--
-- Quyết định nghiệp vụ đã chốt với chủ app:
-- - KHÔNG ghi hao hụt vào sổ quỹ. Tiền mua vật tư đã ghi "Chi" lúc nhập kho
--   (shift-stock.tsx:489-501, category='material'); ghi thêm khoản Chi là tính 2 lần.
--   Hao hụt là khoản ghi giảm GIÁ TRỊ TỒN, không phải dòng tiền.
-- - Chọn công trình là TÙY CHỌN, mặc định kho. Bắt buộc chọn sẽ khiến người dùng chọn
--   bừa cho có (mất khả năng truy vết) — nên thay bằng cảnh báo "còn N mục chưa gán".
-- - avg_cost KHÔNG đổi khi điều chỉnh: giá vốn đã chốt lúc nhập, hao mòn không tạo giá
--   vốn mới (khác hẳn nhập kho nối tiếp MAC).
--
-- Kiểm soát (server là chân lý, không tin client):
-- 1) Chỉ Admin/Quản lý qua is_manager() — thu ngân/worker không sửa được tồn.
-- 2) REVOKE PUBLIC (mặc định PostgreSQL cấp EXECUTE cho PUBLIC; chỉ revoke anon là
--    KHÔNG đủ — 0063 đã dính lỗi này).
-- 3) Khoá FOR UPDATE trước khi ghi để 2 phiếu điều chỉnh song song không lệch tồn.
-- 4) Chặn tồn âm sau khi điều chỉnh.
-- 5) Gán bổ sung công trình (assign_adjust_project) KHÔNG đụng tồn kho: chỉ chuyển
--    chi phí hao hụt sang một công trình, tiền đã ghi lúc nhập nên không phát sinh chi mới.

-- ---------------------------------------------------------------- 1) movement_type
alter table public.stock_movements
  add column if not exists movement_type text;

-- Backfill dòng cũ theo đúng regex client đang dùng, để không đổi hành vi hiển thị cũ.
update public.stock_movements
set movement_type = case
  when note ~* 'nhập|nhap|trả|tra|restock' then 'return'
  when note ~* 'công trình|project' then 'export_project'
  when note ~* 'bán|checkout|sales' then 'export_sales'
  else 'import'
end
where movement_type is null;

-- Khoá NOT NULL sau khi backfill: dòng mới buộc phải nói rõ loại (mọi INSERT server
-- đều đã ghi note rõ ràng nên có thể suy ra).
alter table public.stock_movements
  alter column movement_type set default 'import',
  alter column movement_type set not null;

create index if not exists idx_stock_movements_type
  on public.stock_movements (movement_type, created_at desc);

-- ------------------------------------------------- 2) stock_adjustments (phiếu audit)
create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  product_id uuid not null references public.products(id),
  sku text,
  previous_stock numeric(14,3) not null,
  counted_stock numeric(14,3),         -- tồn thực tế đếm được (NULL khi nhập chênh lệch)
  delta numeric(14,3) not null,        -- = counted - previous, hoặc số nhập trực tiếp
  reason text not null,
  note text,
  project_id uuid references public.projects(id), -- NULL = hao hụt tồn kho chung
  project_assigned_at timestamptz,
  project_assigned_by uuid,
  unit_cost numeric(12,2),             -- chụp avg_cost lúc điều chỉnh
  loss_amount numeric(12,2),           -- giá trị hao hụt = |delta| * unit_cost (delta < 0)
  adjusted_by uuid,
  adjusted_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_adjustments_created
  on public.stock_adjustments (created_at desc);
create index if not exists idx_stock_adjustments_unassigned
  on public.stock_adjustments (created_at desc)
  where project_id is null;

alter table public.stock_adjustments enable row level security;

drop policy if exists "stock_adjustments_read_authenticated" on public.stock_adjustments;
create policy "stock_adjustments_read_authenticated" on public.stock_adjustments
  for select to authenticated using (true);

drop policy if exists "stock_adjustments_write_manager" on public.stock_adjustments;
create policy "stock_adjustments_write_manager" on public.stock_adjustments
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- --------------------------------------------------- 3) project_materials: cột điều chỉnh
alter table public.project_materials
  add column if not exists is_adjust boolean not null default false,
  add column if not exists note text,
  add column if not exists project_id uuid,
  add column if not exists created_at timestamptz;

create index if not exists idx_project_materials_adjust
  on public.project_materials (project_id, created_at desc)
  where is_adjust;

-- Khóa liên kết 1-1 giữa khoản hao hụt và dòng vật tư ghi vào sổ công trình.
-- Thêm sau cùng vì cần tham chiếu stock_adjustments vừa tạo.
alter table public.project_materials
  add column if not exists adjust_id uuid;

alter table public.project_materials
  drop constraint if exists project_materials_adjust_id_fkey;
alter table public.project_materials
  add constraint project_materials_adjust_id_fkey
  foreign key (adjust_id) references public.stock_adjustments(id) on delete cascade;

-- ------------------------------------------------- 4) RPC điều chỉnh tồn (chân lý server)
-- p_items: [{ sku, countedStock?, delta?, projectId?, reason, note? }]
--   - Có countedStock: chấn lệch (cách anh đếm tồn thực tế).
--   - Có delta: nhập thẳng số hao hụt/thừa (delta âm = mất hàng, dương = đếm thừa).
-- Một phiếu là một transaction: hỏng dòng nào thì hủy cả phiếu, không để lọt kẻ âm kho.
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_code TEXT,
  p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sku TEXT;
  v_pid UUID;
  v_name TEXT;
  v_unit TEXT;
  v_type TEXT;
  v_stock NUMERIC;
  v_avg NUMERIC;
  v_counted NUMERIC;
  v_delta NUMERIC;
  v_delta_given NUMERIC;
  v_reason TEXT;
  v_note TEXT;
  v_project_id UUID;
  v_project_code TEXT;
  v_new NUMERIC;
  v_adj_id UUID;
  v_inserted INT := 0;
  v_loss_total NUMERIC := 0;
  v_dupes INT := 0;
  v_actor_name TEXT;
  x JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Phiếu điều chỉnh tồn trống';
  END IF;
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Chỉ Admin/Quản lý được điều chỉnh tồn kho';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Thiếu mã phiếu điều chỉnh';
  END IF;

  -- Cùng SKU 2 dòng trong 1 phiếu sẽ trừ 2 lần -> chặn ngay, client luôn gửi 1 dòng/hàng.
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT e->>'sku' AS sku
    FROM jsonb_array_elements(p_items) e
    GROUP BY e->>'sku'
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Phiếu điều chỉnh có SKU bị lặp, mỗi mặt hàng chỉ được 1 dòng';
  END IF;

  SELECT COALESCE(full_name, email, 'Quản lý') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  -- Khoá toàn bộ dòng kho liên quan TRƯỚC khi ghi (chống 2 phiếu song song lệch tồn).
  PERFORM 1
  FROM public.products p
  WHERE p.sku IN (SELECT e->>'sku' FROM jsonb_array_elements(p_items) e)
  FOR UPDATE;

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := x->>'sku';
    v_reason := btrim(COALESCE(x->>'reason', ''));
    v_note := NULLIF(btrim(COALESCE(x->>'note', '')), '');
    v_project_id := NULLIF(x->>'projectId', '')::UUID;

    SELECT id, name, unit, product_type, stock_quantity, COALESCE(avg_cost, 0)
    INTO v_pid, v_name, v_unit, v_type, v_stock, v_avg
    FROM public.products p WHERE p.sku = v_sku;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'SKU % không tồn tại trong danh mục', v_sku;
    END IF;
    IF v_type IN ('service', 'combo') THEN
      RAISE EXCEPTION '%: hàng dịch vụ/combo không có tồn để điều chỉnh', v_sku;
    END IF;
    IF v_reason = '' THEN
      RAISE EXCEPTION '%: thiếu lý do điều chỉnh tồn', v_sku;
    END IF;

    v_counted := CASE
      WHEN x ? 'countedStock' AND (x->>'countedStock')::NUMERIC >= 0 THEN (x->>'countedStock')::NUMERIC
      ELSE NULL
    END;
    v_delta_given := COALESCE((x->>'delta')::NUMERIC, 0);

    -- Tồn thực tế âm: báo đúng nguyên nhân thay vì rơi xuống nhánh "chưa nhập gì" —
    -- đây là lỗi nhập liệu của người dùng, cần nói rõ chứ không nói chung chung.
    IF x ? 'countedStock' AND (x->>'countedStock')::NUMERIC < 0 THEN
      RAISE EXCEPTION '%: tồn thực tế không thể âm (đã nhập %)', v_sku, x->>'countedStock';
    END IF;

    IF v_counted IS NOT NULL THEN
      v_delta := v_counted - v_stock;
    ELSIF v_delta_given <> 0 THEN
      v_delta := v_delta_given;
    ELSE
      RAISE EXCEPTION '%: chưa nhập tồn thực tế hoặc chênh lệch', v_sku;
    END IF;

    -- Phiếu không làm thay đổi gì thì KHÔNG ghi. Ghi phiếu 0 đơn vị là rác: vẫn sinh
    -- thẻ kho + dòng audit mà tồn không đổi, làm sổ điều chỉnh khó đọc và gây hiểu nhầm.
    IF v_delta = 0 THEN
      RAISE EXCEPTION '%: tồn thực tế khớp hệ thống, không có gì để điều chỉnh', v_sku;
    END IF;

    v_new := v_stock + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION '%: điều chỉnh sẽ làm tồn âm (tồn % %, muốn để %)',
        v_sku, v_stock, v_unit, v_new;
    END IF;

    IF v_project_id IS NOT NULL THEN
      SELECT code INTO v_project_code FROM public.projects WHERE id = v_project_id;
      IF v_project_code IS NULL THEN
        RAISE EXCEPTION '%: công trình không tồn tại', v_sku;
      END IF;
      -- Hao hụt (mất hàng) mới gắn công trình; đếm thừa thì đích là kho.
      IF v_delta >= 0 THEN
        v_project_id := NULL;
        v_project_code := NULL;
      END IF;
    END IF;

    UPDATE public.products SET stock_quantity = v_new WHERE id = v_pid;

    -- Thẻ kho: movement_type 'adjust_loss' (hao hụt) hoặc 'adjust_gain' (đếm thừa).
    INSERT INTO public.stock_movements
      (reference_code, product_id, quantity, previous_stock, new_stock, note, movement_type)
    VALUES (
      p_code, v_pid, v_delta, v_stock, v_new,
      'Điều chỉnh tồn: ' || v_reason
        || CASE WHEN v_project_code IS NOT NULL THEN ' — hao hụt công trình ' || v_project_code
                ELSE ' — kho' END,
      CASE WHEN v_delta < 0 THEN 'adjust_loss' ELSE 'adjust_gain' END
    );

    INSERT INTO public.stock_adjustments
      (code, product_id, sku, previous_stock, counted_stock, delta, reason, note,
       project_id, unit_cost, loss_amount, adjusted_by, adjusted_by_name)
    VALUES (
      p_code, v_pid, v_sku, v_stock, v_counted, v_delta, v_reason, v_note,
      v_project_id, round(v_avg, 2),
      CASE WHEN v_delta < 0 THEN round(-v_delta * v_avg, 2) ELSE 0 END,
      auth.uid(), v_actor_name
    )
    RETURNING id INTO v_adj_id;

    -- Gắn công trình: ghi thêm DÒNG ĐIỀU CHỈNH vào project_materials để P&L công
    -- trình tự giảm (recalcProjectTotals cộng hết dòng). KHÔNG trừ kho ở đây — tồn đã
    -- trừ đúng một lần ở trên, trừ hai lần là sai.
    IF v_project_id IS NOT NULL AND v_delta < 0 THEN
      INSERT INTO public.project_materials
        (project_id, product_id, sku, name, unit, quantity, unit_cost, is_adjust, note, created_at, adjust_id)
      VALUES (
        v_project_id, v_pid, v_sku, v_name, v_unit, -v_delta, round(v_avg, 2),
        true, 'Hao hụt: ' || v_reason || CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END,
        now(), v_adj_id
      );
    END IF;

    IF v_delta < 0 THEN
      v_loss_total := v_loss_total + round(-v_delta * v_avg, 2);
    END IF;
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'code', p_code,
    'adjusted', v_inserted,
    'loss_amount', v_loss_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(TEXT, JSONB) TO authenticated;

-- ------------------------------- 5) Gán bổ sung công trình SAU (không đụng tồn kho)
-- Dùng khi ban đầu ghi "chưa gán công trình", sau đó công trình xác nhận thì gán vào.
-- Xoá DÒNG ĐIỀU CHỈNH cũ theo adjust_id (chính xác 1 dòng) rồi ghi lại cho công trình
-- mới: tồn kho KHÔNG đụng, sổ vật tư công trình không bị nhân đôi chi phí.
CREATE OR REPLACE FUNCTION public.assign_adjust_project(
  p_adjustment_id UUID,
  p_project_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_delta NUMERIC;
  v_sku TEXT;
  v_name TEXT;
  v_unit TEXT;
  v_pid UUID;
  v_avg NUMERIC;
  v_reason TEXT;
  v_note TEXT;
  v_code TEXT;
  v_project_code TEXT;
  v_old_project UUID;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Chỉ Admin/Quản lý được gán công trình cho khoản hao hụt';
  END IF;

  SELECT delta, sku, product_id, reason, note, code, project_id
  INTO v_delta, v_sku, v_pid, v_reason, v_note, v_code, v_old_project
  FROM public.stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;

  IF v_sku IS NULL THEN
    RAISE EXCEPTION 'Phiếu điều chỉnh không tồn tại';
  END IF;
  IF v_delta >= 0 THEN
    RAISE EXCEPTION 'Chỉ gán công trình cho khoản hao hụt (mất hàng), không phải khoản đếm thừa';
  END IF;

  SELECT name, unit, COALESCE(avg_cost, 0) INTO v_name, v_unit, v_avg
  FROM public.products WHERE id = v_pid;
  SELECT code INTO v_project_code FROM public.projects WHERE id = p_project_id;
  IF v_project_code IS NULL THEN
    RAISE EXCEPTION 'Công trình không tồn tại';
  END IF;

  -- Bỏ dòng điều chỉnh cũ (nếu đang gắn công trình khác) theo adjust_id — chính xác,
  -- không đụng dòng xuất thật hay dòng của công trình khác.
  DELETE FROM public.project_materials WHERE adjust_id = p_adjustment_id;

  INSERT INTO public.project_materials
    (project_id, product_id, sku, name, unit, quantity, unit_cost, is_adjust, note, created_at, adjust_id)
  VALUES (
    p_project_id, v_pid, v_sku, v_name, v_unit, -v_delta, round(v_avg, 2),
    true, 'Hao hụt: ' || v_reason || CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END,
    now(), p_adjustment_id
  );

  UPDATE public.stock_adjustments
  SET project_id = p_project_id, project_assigned_at = now(), project_assigned_by = auth.uid()
  WHERE id = p_adjustment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_code,
    'project_code', v_project_code,
    'moved_from', v_old_project
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_adjust_project(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_adjust_project(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_adjust_project(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
