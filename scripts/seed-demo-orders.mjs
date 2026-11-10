/**
 * Seed demo: 50 đơn hàng đa dạng trên D1 local (đầy đủ trạng thái, nguồn, giảm giá, gửi sau...).
 * Địa chỉ ghép đúng format form thật: `${số nhà}, ${xã/phường}, ${tỉnh/TP}` từ address-select.json.
 * Chỉ chạy local — từ chối --remote.
 *
 *   npm run db:seed:demo-orders
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORDER_COUNT = 50;
const WEIGHTS = ['Chưa sinh', '3kg', '4kg', '5kg', '6kg', '7kg', '8kg', '9kg', '10kg', '11kg', '12kg', '13kg', '14kg', '15kg'];
const STATUSES = ['new', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled'];
const SOURCES = ['zalo', 'facebook', 'tiktok', 'web'];
const PAY_STATES = ['cod', 'paid', 'deposit'];
const FIRST = ['An', 'Bình', 'Chi', 'Dũng', 'Em', 'Giang', 'Hà', 'Hùng', 'Khoa', 'Lan', 'Minh', 'Nam', 'Oanh', 'Phúc', 'Quân', 'Trang', 'Uyên', 'Vân', 'Yến', 'Đạt'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương'];
const STREETS = [
  'ngõ 3',
  'hẻm 12',
  'đường Nguyễn Thị Định',
  'đường Lê Lợi',
  'tổ 7',
  'ấp Tân Trang',
  'số 910/10',
  'đường Sơn Tây 2',
  'khu phố 3',
  'thôn Quyết Tiến',
];

const extraArgs = process.argv.slice(2);
if (extraArgs.some((arg) => arg === '--remote' || arg.startsWith('--remote'))) {
  console.error('Seed demo đơn chỉ chạy D1 local. Không dùng --remote.');
  process.exit(1);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptsDir, '..');
const wranglerJs = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const addressSelectPath = path.join(projectDir, 'public', 'data', 'address-select.json');
/** @type {[string, string, [string, string][]][]} */
const addressRows = JSON.parse(fs.readFileSync(addressSelectPath, 'utf8'));
if (!Array.isArray(addressRows) || addressRows.length < 10) {
  console.error('Thiếu public/data/address-select.json hợp lệ.');
  process.exit(1);
}

function composeAddress(index) {
  const province = addressRows[index % addressRows.length];
  const wards = province[2] ?? [];
  if (wards.length === 0) throw new Error(`Tỉnh ${province[1]} không có xã/phường.`);
  const ward = wards[(index * 7) % wards.length];
  const house = `${10 + (index % 80)} ${pick(STREETS, index)}`;
  // Khớp AddressField: `${house}, ${wardName}, ${provinceName}`
  return `${house}, ${ward[1]}, ${province[1]}`;
}

function fulfillOf(status, index) {
  if (status === 'completed' || status === 'cancelled') return null;
  if (status === 'shipped') return 'shipped';
  if (index % 13 === 0) return 'reship';
  return 'unshipped';
}

function runSql(sql, label) {
  const file = path.join(os.tmpdir(), `blogvdt-orders-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  const result = spawnSync(process.execPath, [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--file', file], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  fs.unlinkSync(file);
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(label || 'Wrangler D1 execute thất bại.');
  }
  return result.stdout || '';
}

function queryJson(command) {
  const result = spawnSync(
    process.execPath,
    [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--json', '--command', command],
    { cwd: projectDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || '');
    throw new Error(`Query thất bại: ${command}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
}

function sqlStr(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dayKey(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}${read('month')}${read('day')}`;
}

function formatCode(day, sequence) {
  return `VD${day}-${String(sequence).padStart(4, '0')}`;
}

function pick(list, index) {
  return list[index % list.length];
}

function phoneOf(index) {
  return `09${String(10000000 + index).slice(-8)}`;
}

function vnMidnight(now) {
  const day = dayKey(now);
  return Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+07:00`);
}

const products = queryJson(
  `SELECT p.id, p.name, p.price, c.weight_scale
   FROM products p
   LEFT JOIN product_categories c ON c.id = p.category_id
   WHERE p.status = 'active'
   ORDER BY p.id`,
);
if (products.length < 5) {
  console.error('Cần ít nhất 5 sản phẩm active trên D1 local. Chạy npm run db:seed:demo-products trước.');
  process.exit(1);
}

const costs = queryJson(`SELECT name, kind, value FROM order_costs WHERE active = 1`);
const shipCost = costs.find((row) => String(row.name).toLowerCase().includes('vận chuyển'))?.value ?? 19000;
const fixedExtra = costs
  .filter((row) => row.kind === 'fixed' && !String(row.name).toLowerCase().includes('vận chuyển'))
  .reduce((sum, row) => sum + Number(row.value || 0), 0);

const before = queryJson(`SELECT COUNT(*) AS c FROM orders`);
const oldDemo = queryJson(`SELECT COUNT(*) AS c FROM orders WHERE ip_hash LIKE 'demo:seed:%'`);
console.log(
  `Sản phẩm active: ${products.length}. Đơn hiện có: ${before[0]?.c ?? 0} (demo cũ: ${oldDemo[0]?.c ?? 0}). Sẽ làm mới ${ORDER_COUNT} đơn demo.`,
);

// Chạy lại được: xóa lô demo trước, rồi lấy sequence tiếp theo theo ngày để không trùng code đơn thật/cũ.
runSql(`DELETE FROM orders WHERE ip_hash LIKE 'demo:seed:%';`, 'Xóa đơn demo cũ');

const daySeq = new Map();
for (const row of queryJson(`SELECT code FROM orders WHERE code LIKE 'VD________-____'`)) {
  const code = String(row.code ?? '');
  const match = /^VD(\d{8})-(\d{4})$/.exec(code);
  if (!match) continue;
  const day = match[1];
  const sequence = Number(match[2]);
  if (!Number.isInteger(sequence) || sequence < 1) continue;
  daySeq.set(day, Math.max(daySeq.get(day) ?? 0, sequence));
}

const orderRows = [];
const itemRows = [];
let saleUses = 0;
const now = Date.now();

for (let i = 0; i < ORDER_COUNT; i += 1) {
  const daysAgo = i % 45;
  const createdAt = now - daysAgo * 24 * 60 * 60 * 1000 - (i % 17) * 60 * 60 * 1000;
  const day = dayKey(createdAt);
  const sequence = (daySeq.get(day) ?? 0) + 1;
  daySeq.set(day, sequence);
  const code = formatCode(day, sequence);

  const status = pick(STATUSES, i);
  const source = pick(SOURCES, i * 3 + 1);
  const payState = pick(PAY_STATES, i * 2);
  const paymentMethod = payState === 'cod' ? 'cod' : 'bank';
  const priority = i % 11 === 0 ? 1 : 0;
  const compensation = i % 23 === 0 ? 1 : 0;
  const shipLater = !compensation && status !== 'shipped' && status !== 'completed' && status !== 'cancelled' && i % 7 === 0;
  const shipOn = shipLater ? vnMidnight(createdAt) + (10 + (i % 5) * 5) * 24 * 60 * 60 * 1000 : null;

  const lineCount = i % 5 === 0 ? 2 : i % 9 === 0 ? 3 : 1;
  const lines = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const product = products[(i * 3 + lineIndex * 7) % products.length];
    const quantity = 1 + ((i + lineIndex) % 3);
    const needsWeight = product.weight_scale && product.weight_scale !== 'none';
    const optionLabel = needsWeight ? pick(WEIGHTS, i + lineIndex * 4) : null;
    const unitPrice = Number(product.price);
    lines.push({
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity,
      optionLabel,
      lineTotal: unitPrice * quantity,
      sortOrder: lineIndex,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const useSale = !compensation && subtotal >= 100_000 && i % 4 === 0;
  const discountCode = useSale ? 'SALE' : null;
  const codeDiscount = useSale ? 10_000 : 0;
  const extraDiscount = !compensation && !useSale && i % 6 === 0 ? pick([5_000, 8_000, 10_000, 18_000], i) : 0;
  const discountAmount = compensation ? 0 : Math.min(subtotal, codeDiscount + extraDiscount);
  if (useSale) saleUses += 1;

  const freeShip = compensation || subtotal >= 100_000 || i % 3 === 0;
  const shippingFee = compensation || freeShip ? 0 : Number(shipCost) || 19_000;
  const shippingCost = Number(shipCost) || 19_000;
  const goodsPayable = compensation ? 0 : subtotal - discountAmount;
  const totalPrice = compensation ? 0 : goodsPayable + shippingFee;

  const costGoods = Math.round(subtotal * 0.4);
  const costExtra = fixedExtra + shippingCost + Math.round((totalPrice * 450) / 10_000);
  const costLines = JSON.stringify({
    goods: lines.map((line) => ({
      name: line.productName,
      quantity: line.quantity,
      unitCost: Math.round(line.unitPrice * 0.4),
      amount: Math.round(line.unitPrice * 0.4) * line.quantity,
    })),
    missing: [],
    extra: [
      ...costs
        .filter((row) => row.kind === 'fixed')
        .map((row) => ({ name: row.name, kind: 'fixed', rate: Number(row.value), amount: Number(row.value) })),
      ...costs
        .filter((row) => row.kind === 'percent')
        .map((row) => ({
          name: row.name,
          kind: 'percent',
          rate: Number(row.value),
          amount: Math.round((totalPrice * Number(row.value)) / 10_000),
        })),
    ],
  });

  const head = lines[0];
  const multi = lines.length > 1;
  const customerName = `${pick(LAST, i)} ${pick(FIRST, i * 2)}`;
  const address = composeAddress(i);
  const note = i % 5 === 0 ? 'Giao giờ hành chính' : i % 8 === 0 ? 'Nhắn Zalo trước khi giao' : null;
  const internalNote = i % 10 === 0 ? 'Khách quen' : null;
  const updatedAt = status === 'new' ? createdAt : createdAt + 6 * 60 * 60 * 1000;
  const discountRestored = status === 'cancelled' && discountCode ? 1 : 0;
  const depositAmount =
    payState === 'deposit' && totalPrice > 20_000
      ? Math.min(Math.max(10_000, Math.round(totalPrice * 0.2)), totalPrice - 10_000)
      : 0;
  const fulfillStatus = fulfillOf(status, i);

  orderRows.push({
    code,
    customerName,
    phone: phoneOf(i),
    address,
    note,
    internalNote,
    productId: multi ? null : head.productId,
    productName: multi ? `${lines.length} mẫu` : head.productName,
    unitPrice: multi ? 0 : head.unitPrice,
    quantity: multi ? lines.reduce((sum, line) => sum + line.quantity, 0) : head.quantity,
    optionLabel: multi ? null : head.optionLabel,
    subtotal,
    discountCode: discountAmount > 0 ? discountCode : null,
    discountAmount,
    discountRestored,
    totalPrice,
    paymentMethod,
    source,
    payState,
    depositAmount,
    priority,
    compensation,
    shipOn,
    shippingFee,
    shippingCost,
    costGoods,
    costExtra,
    costLines,
    status,
    fulfillStatus,
    ipHash: `demo:seed:${String(i + 1).padStart(3, '0')}`,
    landingSlug: source === 'web' && i % 2 === 0 ? 'vong-cho-be' : null,
    createdAt,
    updatedAt,
    lines: multi ? lines : [],
  });
}

const batchSize = 20;
for (let start = 0; start < orderRows.length; start += batchSize) {
  const batch = orderRows.slice(start, start + batchSize);
  const values = batch
    .map((order) => {
      return `(${[
        sqlStr(order.code),
        sqlStr(order.customerName),
        sqlStr(order.phone),
        sqlStr(order.address),
        sqlStr(order.note),
        sqlStr(order.internalNote),
        order.productId === null ? 'NULL' : String(order.productId),
        sqlStr(order.productName),
        String(order.unitPrice),
        String(order.quantity),
        sqlStr(order.optionLabel),
        String(order.subtotal),
        sqlStr(order.discountCode),
        String(order.discountAmount),
        String(order.discountRestored),
        String(order.totalPrice),
        sqlStr(order.paymentMethod),
        sqlStr(order.source),
        sqlStr(order.payState),
        String(order.depositAmount),
        String(order.priority),
        String(order.compensation),
        order.shipOn === null ? 'NULL' : String(order.shipOn),
        String(order.shippingFee),
        String(order.shippingCost),
        String(order.costGoods),
        String(order.costExtra),
        sqlStr(order.costLines),
        sqlStr(order.status),
        sqlStr(order.fulfillStatus),
        sqlStr(order.ipHash),
        sqlStr(order.landingSlug),
        String(order.createdAt),
        String(order.updatedAt),
      ].join(', ')})`;
    })
    .join(',\n');

  runSql(
    `INSERT INTO orders (
      code, customer_name, phone, address, note, internal_note,
      product_id, product_name, unit_price, quantity, option_label,
      subtotal, discount_code, discount_amount, discount_restored, total_price,
      payment_method, source, pay_state, deposit_amount, priority, compensation, ship_on,
      shipping_fee, shipping_cost, cost_goods, cost_extra, cost_lines,
      status, fulfill_status, ip_hash, landing_slug, created_at, updated_at
    ) VALUES\n${values};`,
    `Chèn đơn ${start + 1}-${start + batch.length}`,
  );

  for (const order of batch) {
    if (order.lines.length === 0) continue;
    const idRows = queryJson(`SELECT id FROM orders WHERE code = ${sqlStr(order.code)} LIMIT 1`);
    const orderId = idRows[0]?.id;
    if (!orderId) throw new Error(`Không tìm thấy đơn ${order.code}`);
    const itemValues = order.lines
      .map(
        (line) =>
          `(${orderId}, ${line.productId}, ${sqlStr(line.productName)}, ${line.unitPrice}, ${line.quantity}, ${sqlStr(line.optionLabel)}, ${line.lineTotal}, ${line.sortOrder})`,
      )
      .join(',\n');
    itemRows.push(order.lines.length);
    runSql(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, option_label, line_total, sort_order)
       VALUES\n${itemValues};`,
      `Chèn dòng đơn ${order.code}`,
    );
  }
}

runSql(
  `UPDATE discount_codes
   SET used_count = (
     SELECT COUNT(*) FROM orders
     WHERE discount_code = 'SALE' AND discount_amount > 0 AND discount_restored = 0
   ),
   updated_at = ${now}
   WHERE code = 'SALE';`,
  'Đồng bộ lượt dùng mã SALE',
);

const summary = queryJson(`
  SELECT
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%') AS demo_orders,
    (SELECT COUNT(*) FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE ip_hash LIKE 'demo:seed:%')) AS demo_items,
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%' AND status = 'new') AS st_new,
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%' AND status = 'completed') AS st_done,
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%' AND discount_amount > 0) AS with_discount,
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%' AND ship_on IS NOT NULL) AS ship_later,
    (SELECT COUNT(*) FROM orders WHERE ip_hash LIKE 'demo:seed:%' AND compensation = 1) AS compensation
`);

const row = summary[0] ?? {};
console.log('Đã seed đơn demo local.');
console.log(
  JSON.stringify(
    {
      demoOrders: row.demo_orders,
      demoItems: row.demo_items,
      statusNew: row.st_new,
      statusCompleted: row.st_done,
      withDiscount: row.with_discount,
      shipLater: row.ship_later,
      compensation: row.compensation,
      saleUses,
      multiLineOrders: itemRows.length,
    },
    null,
    2,
  ),
);
