// 投喂 API：POST /api/donation、DELETE /api/donation/:id
//
// 【行为变更】「免放行直接上墙」
// 原来：投喂一律写 pending，碗主人放行后才累加金额、才对外显示。
// 现在：默认（AUTO_APPROVE_DONATIONS=true）投喂直接写 approved，
//       并在同一个 D1 事务里把金额累加进 bowls.current_cents，
//       立刻出现在详情页的投喂记录与排行榜里，无需碗主人操作。
//       通知照发，碗主人看到不对仍可「拒了」（会把金额扣回去）。
// 关掉自动上墙：wrangler.toml 里设 AUTO_APPROVE_DONATIONS = "false"，即回到审核流。
import { ok, fail, ERR, readJson } from "../lib/resp.js";
import { clean, yuanToCents, isValidPaymentMethod, isValidSlug, LIMITS } from "../lib/validate.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { getIp, computeDailyKey } from "../lib/ip.js";
import { randomToken } from "../lib/slug.js";
import { getBowlBySlug } from "../lib/db.js";
import { notifyDonation } from "../lib/notify.js";
import { detectLocale, t } from "../lib/i18n.js";
import { normalizeCurrency } from "../lib/currency.js";

// 是否免放行直接上墙（默认开）
export function autoApprove(env) {
  const v = String(env.AUTO_APPROVE_DONATIONS ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

// POST /api/donation —— 投一口
// 平台不碰钱：钱是用户直接给对方的，这里只"记一笔"。
export async function createDonation(request, env, ctx) {
  const locale = detectLocale(request, env);
  const ip = getIp(request);
  const body = await readJson(request);
  if (!body) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badJson"));

  // 1. Turnstile 服务端验证
  const tsOk = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!tsOk) return fail(ERR.TURNSTILE_FAILED, t(locale, "err.turnstileFailed"), 403);

  // 2. 参数检查
  if (!body.slug || !isValidSlug(body.slug)) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSlug"));
  const bowl = await getBowlBySlug(env.DB, body.slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  if (bowl.status !== "active") return fail(ERR.CONFLICT, t(locale, "err.bowlClosed"), 409);

  const currency = normalizeCurrency(bowl.currency || env.DEFAULT_CURRENCY || "USD");
  const amountCents = yuanToCents(body.amount, currency);
  if (amountCents === null) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badAmount"));

  const message = clean(body.message, LIMITS.messageMax);
  const nickname = clean(body.nickname, LIMITS.nicknameMax);
  const paymentMethod = body.paymentMethod;
  if (!isValidPaymentMethod(paymentMethod)) return fail(ERR.VALIDATION_ERROR, t(locale, "err.pickPayment"));

  const txid = clean(body.txid, LIMITS.txidMax);
  const isAnonymous = body.isAnonymous ? 1 : 0;

  // IP 不存明文：投喂记录也只落哈希
  const { key: ipHash } = await computeDailyKey(ip, env.SERVER_SECRET);

  // 3. 写入 donations
  //    自动上墙模式下：直接 approved，并在同一事务里累加金额（避免并发下金额落后于记录）
  const auto = autoApprove(env);
  const status = auto ? "approved" : "pending";
  const deleteToken = randomToken();

  const stmts = [
    env.DB.prepare(
      `INSERT INTO donations
         (bowl_id, nickname, amount_cents, currency, message, payment_method, txid,
          is_anonymous, status, ip_hash, delete_token, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${auto ? "datetime('now')" : "NULL"})`
    ).bind(
      bowl.id, nickname, amountCents, currency, message, paymentMethod, txid,
      isAnonymous, status, ipHash.slice(0, 32), deleteToken
    ),
  ];

  if (auto) {
    stmts.push(
      env.DB.prepare("UPDATE bowls SET current_cents = current_cents + ? WHERE id = ?")
        .bind(amountCents, bowl.id)
    );
  }

  // D1 batch = 单事务：插入与累加要么都成，要么都不成
  const results = await env.DB.batch(stmts);
  const donationId = results[0].meta.last_row_id;

  // 4. 留言通知：异步推给碗主人（失败静默，不影响主流程）
  notifyDonation(
    env, ctx, bowl,
    {
      isAnonymous: !!isAnonymous,
      nickname,
      message,
      amountMinor: amountCents,
      currency,
      paymentMethod,
      autoApproved: auto,
    },
    new URL(request.url).host
  );

  // 前端据此决定提示文案：是「等放行」还是「已经上墙了」
  return ok({ id: donationId, deleteToken, status, autoApproved: auto }, 201);
}

// DELETE /api/donation/:id?token=xxx —— 投喂人自己撤
// 自动上墙后没有 pending 了，所以允许撤 approved，并把金额扣回去。
export async function deleteDonation(request, env, id) {
  const locale = detectLocale(request, env);
  const token = new URL(request.url).searchParams.get("token") || "";
  const row = await env.DB.prepare("SELECT * FROM donations WHERE id = ?").bind(id).first();
  if (!row) return fail(ERR.NOT_FOUND, t(locale, "err.donationNotFound"), 404);
  if (row.status === "rejected") return fail(ERR.CONFLICT, t(locale, "err.donationGone"), 409);
  if (!token || token !== row.delete_token) return fail(ERR.UNAUTHORIZED, t(locale, "err.notYours"), 401);

  const stmts = [env.DB.prepare("DELETE FROM donations WHERE id = ?").bind(id)];
  // 已经计过账的，要把金额扣回去
  if (row.status === "approved") {
    stmts.push(
      env.DB.prepare("UPDATE bowls SET current_cents = MAX(0, current_cents - ?) WHERE id = ?")
        .bind(row.amount_cents, row.bowl_id)
    );
  }
  await env.DB.batch(stmts);
  return ok({ id: Number(id) });
}
