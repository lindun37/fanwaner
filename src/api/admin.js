// 饭碗儿后台 API（ADMIN_KEY 鉴权）
// 免放行模式下：投喂直接 approved 并已计账，后台的「拒了」需要把金额扣回去。
import { ok, fail, ERR, readJson } from "../lib/resp.js";
import { detectLocale, t } from "../lib/i18n.js";
import { toMajor } from "../lib/currency.js";

function auth(request, env) {
  const key = env.ADMIN_KEY;
  // 没配 ADMIN_KEY 时一律拒绝。否则下面的模板串会变成 "Bearer undefined"，
  // 任何人都能拿这个可猜的字符串进后台（fail closed，不要 fail open）。
  if (!key) return false;

  const header = request.headers.get("Authorization") || "";
  const expected = `Bearer ${key}`;
  // 常数时间比较：长度不同也走完整轮循环，避免靠响应时间逐字节试出 key
  let diff = header.length ^ expected.length;
  const n = Math.max(header.length, expected.length);
  for (let i = 0; i < n; i++) {
    diff |= (header.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function fmtDonation(r) {
  const currency = r.currency || "CNY";
  return {
    id: r.id,
    slug: r.slug,
    bowlTitle: r.bowl_title,
    nickname: r.nickname || "anonymous",
    amountMinor: r.amount_cents,
    currency,
    // 兼容旧前端：注意只能按币种换算，JPY/KRW 没有小数位，不能写死 /100
    amountYuan: toMajor(r.amount_cents, currency),
    message: r.message,
    paymentMethod: r.payment_method,
    txid: r.txid,
    anonymous: !!r.is_anonymous,
    status: r.status,
    createdAt: r.created_at,
  };
}

// GET /api/admin/pending —— 待审核投喂 + 最近自动上墙的（供人工复核/撤下）
export async function pendingDonations(request, env) {
  const locale = detectLocale(request, env);
  if (!auth(request, env)) return fail(ERR.UNAUTHORIZED, t(locale, "err.unauthorized"), 401);
  const rows = await env.DB.prepare(
    `SELECT d.*, b.slug, b.title AS bowl_title
     FROM donations d JOIN bowls b ON b.id = d.bowl_id
     WHERE d.status = 'pending'
     ORDER BY d.created_at ASC`
  ).all();
  const recent = await env.DB.prepare(
    `SELECT d.*, b.slug, b.title AS bowl_title
     FROM donations d JOIN bowls b ON b.id = d.bowl_id
     WHERE d.status = 'approved'
     ORDER BY d.created_at DESC LIMIT 30`
  ).all();
  return ok({
    items: rows.results.map(fmtDonation),
    recentApproved: recent.results.map(fmtDonation),
  });
}

// GET /api/admin/bowl/:slug —— 后台查饭碗儿（端走用）
export async function getBowlForAdmin(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!auth(request, env)) return fail(ERR.UNAUTHORIZED, t(locale, "err.unauthorized"), 401);
  const row = await env.DB.prepare("SELECT * FROM bowls WHERE slug=?").bind(slug).first();
  if (!row) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM donations WHERE bowl_id=? AND status='approved'"
  ).bind(row.id).first();
  const cur = row.currency || "CNY";
  return ok({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    currency: cur,
    currentMinor: row.current_cents,
    targetMinor: row.target_cents,
    // 兼容旧前端：按币种换算（JPY/KRW 无小数位）
    currentYuan: toMajor(row.current_cents, cur),
    targetYuan: toMajor(row.target_cents, cur),
    approvedDonations: cnt?.c || 0,
  });
}

// POST /api/admin/approve {id} —— 放他过（幂等：只处理 pending）
export async function approveDonation(request, env) {
  const locale = detectLocale(request, env);
  if (!auth(request, env)) return fail(ERR.UNAUTHORIZED, t(locale, "err.unauthorized"), 401);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDonationId"));

  // 幂等闸门：只有 pending → approved 这一次会累加金额，避免重复审核加两次
  const res = await env.DB.prepare(
    `UPDATE donations SET status='approved', approved_at=datetime('now')
     WHERE id=? AND status='pending'`
  ).bind(id).run();

  if (res.meta.changes === 0) return ok({ id, alreadyHandled: true });

  await env.DB.prepare(
    `UPDATE bowls SET current_cents = current_cents +
       (SELECT amount_cents FROM donations WHERE id=?)
     WHERE id = (SELECT bowl_id FROM donations WHERE id=?)`
  ).bind(id, id).run();

  return ok({ id });
}

// POST /api/admin/reject {id} —— 这个不行
// 若该笔已计账（免放行模式），拒掉时把金额扣回去
export async function rejectDonation(request, env) {
  const locale = detectLocale(request, env);
  if (!auth(request, env)) return fail(ERR.UNAUTHORIZED, t(locale, "err.unauthorized"), 401);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDonationId"));

  const row = await env.DB.prepare("SELECT * FROM donations WHERE id=?").bind(id).first();
  if (!row) return fail(ERR.NOT_FOUND, t(locale, "err.donationNotFound"), 404);
  if (row.status === "rejected") return ok({ id, alreadyHandled: true });

  const wasApproved = row.status === "approved";
  await env.DB.batch([
    env.DB.prepare("UPDATE donations SET status='rejected' WHERE id=?").bind(id),
    ...(wasApproved
      ? [
          env.DB.prepare("UPDATE bowls SET current_cents = MAX(0, current_cents - ?) WHERE id=?")
            .bind(row.amount_cents, row.bowl_id),
        ]
      : []),
  ]);
  return ok({ id, refunded: wasApproved });
}

// POST /api/admin/delete {id, type: 'bowl' | 'donation'} —— 端走
export async function deleteItem(request, env) {
  const locale = detectLocale(request, env);
  if (!auth(request, env)) return fail(ERR.UNAUTHORIZED, t(locale, "err.unauthorized"), 401);
  const body = await readJson(request);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDonationId"));
  const type = body?.type;

  if (type === "bowl") {
    await env.DB.prepare("UPDATE bowls SET status='hidden', updated_at=datetime('now') WHERE id=?")
      .bind(id).run();
    return ok({ id, type });
  }

  if (type === "donation") {
    const row = await env.DB.prepare("SELECT * FROM donations WHERE id=?").bind(id).first();
    if (!row) return fail(ERR.NOT_FOUND, t(locale, "err.donationNotFound"), 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM donations WHERE id=?").bind(id),
      ...(row.status === "approved"
        ? [
            env.DB.prepare("UPDATE bowls SET current_cents = MAX(0, current_cents - ?) WHERE id=?")
              .bind(row.amount_cents, row.bowl_id),
          ]
        : []),
    ]);
    return ok({ id, type });
  }

  return fail(ERR.VALIDATION_ERROR, "type must be bowl or donation.");
}
