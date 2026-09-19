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
import { detectLocale, t, tp } from "../lib/i18n.js";
import { normalizeCurrency } from "../lib/currency.js";

// 是否免放行直接上墙（默认开）
export function autoApprove(env) {
  const v = String(env.AUTO_APPROVE_DONATIONS ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

// ---- 投喂限流 ----
// 免放行模式下投喂会立刻计入金额，所以这里必须有一道闸：不然同一个人可以连着
// 提交几十笔把某个饭碗儿的金额刷起来，顺带把碗主的通知渠道刷爆。
// 口径是「同一 IP + 同一个饭碗儿」而不是全站 —— 运营商大内网共用一个出口 IP 的
// 不同人分别投不同的碗，彼此不受影响；而刷数的人只会盯着一个碗打。
// 两个值都能在 wrangler.toml 的 [vars] 里调，设 0 表示关掉那一档。
const RATE_PER_MINUTE_DEFAULT = 3;
const RATE_PER_DAY_DEFAULT = 10;

export function donateRateLimits(env) {
  const num = (v, fallback) => {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    perMinute: num(env.DONATE_RATE_PER_MINUTE, RATE_PER_MINUTE_DEFAULT),
    perDay: num(env.DONATE_RATE_PER_DAY, RATE_PER_DAY_DEFAULT),
  };
}

// iP_hash 每天天然轮换，所以「今天投了几笔」直接按它数就行，不用算日期。
async function checkDonateRate(env, ipHash, bowlId, locale) {
  const { perMinute, perDay } = donateRateLimits(env);
  const count = async (windowClause) => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM donations WHERE ip_hash = ? AND bowl_id = ?${windowClause}`
    ).bind(ipHash, bowlId).first();
    return row?.c || 0;
  };

  if (perMinute > 0 && (await count(" AND created_at > datetime('now','-60 seconds')")) >= perMinute) {
    const tpl = tp(locale, "err.donateTooFast");
    const msg = (typeof tpl === "function" ? tpl(perMinute) : tpl) || t(locale, "err.rateLimited");
    return fail(ERR.RATE_LIMITED, msg, 429);
  }
  if (perDay > 0 && (await count("")) >= perDay) {
    const tpl = tp(locale, "err.donateDailyLimit");
    const msg = (typeof tpl === "function" ? tpl(perDay) : tpl) || t(locale, "err.rateLimited");
    return fail(ERR.RATE_LIMITED, msg, 429);
  }
  return null;
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
  const ipHash32 = ipHash.slice(0, 32);

  // 3. 限流：同一 IP 对同一个饭碗儿的投喂次数（先挡 60 秒连发，再挡当天累计）
  const rateErr = await checkDonateRate(env, ipHash32, bowl.id, locale);
  if (rateErr) return rateErr;

  // 4. 写入 donations
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
      isAnonymous, status, ipHash32, deleteToken
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

  // 5. 留言通知：异步推给碗主人（失败静默，不影响主流程）
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
