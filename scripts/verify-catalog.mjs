export async function fetchCatalog(url, headers) {
  const response = await fetch(
    `${url}/rest/v1/products?select=sku,name,unit,product_type,retail_price,stock_quantity&order=sku`,
    { headers },
  );
  if (!response.ok) throw new Error(`catalog read failed: HTTP ${response.status}`);
  return response.json();
}

export function pickGoods(catalog) {
  const product = catalog.find((item) => item.product_type === 'goods');
  if (!product) throw new Error('staging catalog has no goods product');
  return product;
}

export function pickArea(catalog) {
  const product = catalog.find((item) => item.product_type === 'area');
  if (!product) throw new Error('staging catalog has no area product');
  return product;
}

export function goodsItem(product, quantity) {
  return {
    sku: product.sku,
    name: product.name,
    item_type: 'goods',
    unit: product.unit,
    quantity,
    unit_price: Number(product.retail_price),
    discount_amount: 0,
    processing_fee: 0,
    waste_factor: 0,
    dimension_details: null,
  };
}

export function areaItem(product, dimensions = { length: 1.5, width: 2, quantity: 1 }) {
  const actualM2 = dimensions.length * dimensions.width * dimensions.quantity;
  return {
    sku: product.sku,
    name: product.name,
    item_type: 'area',
    unit: product.unit,
    quantity: actualM2,
    unit_price: Number(product.retail_price),
    discount_amount: 0,
    processing_fee: 0,
    waste_factor: 0,
    dimension_details: [{
      ...dimensions,
      actual_m2: actualM2,
      perimeter_md: 2 * (dimensions.length + dimensions.width) * dimensions.quantity,
      grinding_type: null,
      grinding_unit_price: 0,
      holes: 0,
      hole_unit_price: 0,
      corners: 0,
      corner_unit_price: 0,
      processing_fee: 0,
    }],
  };
}
