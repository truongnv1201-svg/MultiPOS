-- Remove the demo records inserted by migration 0007 and the local mock dataset.
-- Only the known demo identifiers are targeted; user-created records are preserved.

DELETE FROM public.cashbook_entries
WHERE reference_order_code IN ('HD-260914-0001', 'HD-260914-0002', 'CT-260912-0001');

DELETE FROM public.projects
WHERE code = 'CT-260914-0001';

DELETE FROM public.orders
WHERE order_code IN ('HD-260914-0001', 'HD-260914-0002');

DELETE FROM public.combo_items
WHERE combo_product_id IN (SELECT id FROM public.products WHERE sku = 'SP000009')
   OR child_product_id IN (
     SELECT id FROM public.products WHERE sku IN
       ('SP000001','SP000002','SP000003','SP000004','SP000005','SP000006','SP000007','SP000008','SP000009','SP000010','SP000011')
   );

DELETE FROM public.products
WHERE sku IN
  ('SP000001','SP000002','SP000003','SP000004','SP000005','SP000006','SP000007','SP000008','SP000009','SP000010','SP000011');
