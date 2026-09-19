// 饭碗儿 API：列表 / 创建 / 详情 / 编辑
import { ok, fail, ERR, readJson } from "../lib/resp.js";
import {
  clean,
  yuanToCents,
  isLocalImageUrl,
  isValidSlug,
  isValidTrc20Address,
  isValidBep20Address,
  isValidEthAddress,
  isValidBtcAddress,
  isValidSolAddress,
  isValidPayPalLink,
  isValidStripeUrl,
  isValidKofiUrl,
  isValidBmcUrl,
  isValidWiseRecipient,
  isValidRevolutUrl,
  isValidWecomWebhook,
  isValidTelegramChatId,
  isValidServerChanKey,
  isValidDiscordWebhook,
  isValidSlackWebhook,
  isValidNtfyTopic,
  isValidPushoverKey,
  isValidGenericWebhook,
  isValidEmail,
  isValidEmailApiUrl,
  isValidEmailApiKey,
  isValidEmailFrom,
  RESERVED_SLUGS,
  LIMITS,
} from "../lib/validate.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { getIp, computeDailyKey } from "../lib/ip.js";
import { randomSlug, randomToken } from "../lib/slug.js";
import { getBowlBySlug, formatBowl, formatDonation, isUniqueConflict } from "../lib/db.js";
import { detectLocale, t } from "../lib/i18n.js";
import { SUPPORTED_LOCALES } from "../lib/locales.js";
import { normalizeCurrency, CURRENCY_CODES, DEFAULT_CURRENCY, MAX_MINOR } from "../lib/currency.js";
import { PAYMENT_METHODS } from "../lib/validate.js";
import { autoApprove as autoApproveMode } from "./donations.js";

export async function handleConfig(env) {
  // 单笔金额上限（按「所选币种的主单位」理解：USD 就是 1000 美元、JPY 就是 1000 日元）
  const maxAmount = Number(env.MAX_AMOUNT_YUAN) || LIMITS.amountMaxYuan;
  return ok({
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    maxAmount,
    maxAmountYuan: maxAmount, // 兼容旧前端字段名
    amountMaxMinor: MAX_MINOR, // 库里 CHECK 的硬上限（最小单位）
    // i18n：给前端填充币种下拉与支付方式
    defaultLocale: env.DEFAULT_LOCALE || "en",
    defaultCurrency: env.DEFAULT_CURRENCY || DEFAULT_CURRENCY,
    currencies: CURRENCY_CODES,
    paymentMethods: PAYMENT_METHODS,
    // 免放行直接上墙
    autoApprove: autoApproveMode(env),
  });
}

// GET /api/bowl?status=active&sort=newest|hottest|soonest&page=1&pageSize=10
export async function listBowls(request, env) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") || "active";
  const statuses = statusParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ["active", "completed", "expired", "hidden"].includes(s));
  const sort = url.searchParams.get("sort") || "newest";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    LIMITS.pageSizeMax,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || "10", 10) || 10)
  );

  // 懒更新：先把过期的饭碗儿标记为 expired
  await env.DB.prepare(
    `UPDATE bowls SET status='expired', updated_at=datetime('now')
     WHERE status='active' AND deadline IS NOT NULL AND deadline < datetime('now')`
  ).run();

  const where =
    statusParam === "all" ? "" : statuses.length ? `WHERE status IN (${statuses.map(() => "?").join(",")})` : "WHERE 0";
  const params = statusParam === "all" ? [] : statuses;

  let orderBy = "created_at DESC";
  if (sort === "hottest") orderBy = "current_cents DESC";
  else if (sort === "soonest") orderBy = "deadline ASC NULLS LAST";

  const totalRes = await env.DB.prepare(`SELECT COUNT(*) AS c FROM bowls ${where}`)
    .bind(...params)
    .first();
  const rows = await env.DB.prepare(
    `SELECT * FROM bowls ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all();

  // 耿直人人数：approved 投喂去重（匿名按 IP 算、留名的按昵称算）
  const ids = rows.results.map((r) => r.id);
  const donorMap = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const d = await env.DB.prepare(
      `SELECT bowl_id,
              COUNT(DISTINCT CASE WHEN is_anonymous = 1 THEN 'a:' || ip_hash ELSE 'n:' || nickname END) AS donors
       FROM donations
       WHERE status = 'approved' AND bowl_id IN (${ph})
       GROUP BY bowl_id`
    )
      .bind(...ids)
      .all();
    for (const r of d.results) donorMap[r.bowl_id] = Number(r.donors || 0);
  }

  // 首页卡片动态留言：每碗最近 5 条已放行留言 + 没放行(pending)/遭拒(rejected)条数
  const recentMessages = {};
  const pendMap = {};
  const rejMap = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const msgRes = await env.DB.prepare(
      `SELECT bowl_id, nickname, message, is_anonymous FROM (
         SELECT bowl_id, nickname, message, is_anonymous,
                ROW_NUMBER() OVER (PARTITION BY bowl_id ORDER BY created_at DESC) rn
         FROM donations
         WHERE status = 'approved' AND bowl_id IN (${ph})
       ) WHERE rn <= 5`
    )
      .bind(...ids)
      .all();
    for (const r of msgRes.results) {
      (recentMessages[r.bowl_id] ||= []).push({
        nickname: r.nickname,
        message: r.message,
        isAnonymous: !!r.is_anonymous,
      });
    }
    const cntRes = await env.DB.prepare(
      `SELECT bowl_id, status, COUNT(*) AS c FROM donations
       WHERE status IN ('pending','rejected') AND bowl_id IN (${ph})
       GROUP BY bowl_id, status`
    )
      .bind(...ids)
      .all();
    for (const r of cntRes.results) {
      if (r.status === "pending") pendMap[r.bowl_id] = Number(r.c);
      else rejMap[r.bowl_id] = Number(r.c);
    }
  }

  return ok({
    total: totalRes?.c || 0,
    page,
    pageSize,
    items: rows.results.map((r) => ({
      ...formatBowl(r),
      donorCount: donorMap[r.id] || 0,
      recentMessages: recentMessages[r.id] || [],
      pendingCount: pendMap[r.id] || 0,
      rejectedCount: rejMap[r.id] || 0,
    })),
  });
}

// POST /api/bowl 创建饭碗儿
export async function createBowl(request, env) {
  const locale = detectLocale(request, env);
  const ip = getIp(request);
  const body = await readJson(request);
  if (!body) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badJson"));

  // 1. Turnstile 服务端验证
  const tsOk = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!tsOk) return fail(ERR.TURNSTILE_FAILED, t(locale, "err.turnstileFailed"), 403);

  // 2. 字段校验
  const title = clean(body.title, LIMITS.titleMax);
  const want = clean(body.want, LIMITS.wantMax);
  const reason = clean(body.reason, LIMITS.reasonMax);
  const nickname = clean(body.nickname, LIMITS.nicknameMax);

  // 币种：请求里带的 > 部署默认 > 内置默认（USD）
  const currency = normalizeCurrency(body.currency || env.DEFAULT_CURRENCY || DEFAULT_CURRENCY);
  // 摆碗时用的界面语言，存下来给「通知正文」和「OG 分享图」复用
  const language = SUPPORTED_LOCALES.includes(body.language) ? body.language : locale;
  // 金额按所选币种换算（JPY/KRW 没有小数位，必须走 currency.js，不能写死 ×100）
  const targetCents = yuanToCents(body.targetAmount, currency);

  // 自定义后缀（可选）：留空就随机整个 8 位的
  const slugOpt =
    body.slug !== undefined && body.slug !== null
      ? String(body.slug).trim().toLowerCase()
      : "";
  if (slugOpt && !isValidSlug(slugOpt)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSlug"));
  }
  if (slugOpt && RESERVED_SLUGS.has(slugOpt)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.slugReserved"));
  }

  if (!title) return fail(ERR.VALIDATION_ERROR, t(locale, "err.titleRequired"));
  if (!reason) return fail(ERR.VALIDATION_ERROR, t(locale, "err.reasonRequired"));
  if (!nickname) return fail(ERR.VALIDATION_ERROR, t(locale, "err.nicknameRequired"));
  if (targetCents === null) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badAmount"));

  // 收款方式全是可选的：一个都不填照样能摆碗
  // —— 二维码图（一律只收本站 /i/ 开头的相对路径）
  if (body.wechatQr && !isLocalImageUrl(body.wechatQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.alipayQr && !isLocalImageUrl(body.alipayQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtQr && !isLocalImageUrl(body.usdtQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtBep20Qr && !isLocalImageUrl(body.usdtBep20Qr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtErc20Qr && !isLocalImageUrl(body.usdtErc20Qr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.btcQr && !isLocalImageUrl(body.btcQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.paypalQr && !isLocalImageUrl(body.paypalQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  // —— 链上地址
  if (body.usdtAddress && !isValidTrc20Address(body.usdtAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badTrc20"));
  }
  if (body.usdtBep20Address && !isValidBep20Address(body.usdtBep20Address)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBep20"));
  }
  if (body.usdtErc20Address && !isValidBep20Address(body.usdtErc20Address)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badErc20"));
  }
  if (body.ethAddress && !isValidEthAddress(body.ethAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEth"));
  }
  if (body.btcAddress && !isValidBtcAddress(body.btcAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBtc"));
  }
  if (body.solAddress && !isValidSolAddress(body.solAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSol"));
  }
  // —— 海外托管收款链接
  if (body.paypalLink && !isValidPayPalLink(body.paypalLink)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPaypal"));
  }
  if (body.stripeUrl && !isValidStripeUrl(body.stripeUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badStripe"));
  }
  if (body.kofiUrl && !isValidKofiUrl(body.kofiUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badKofi"));
  }
  if (body.bmcUrl && !isValidBmcUrl(body.bmcUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBmc"));
  }
  if (body.wiseEmail && !isValidWiseRecipient(body.wiseEmail)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWise"));
  }
  if (body.revolutUrl && !isValidRevolutUrl(body.revolutUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badRevolut"));
  }

  // 留言通知：填哪条都行，一个都不填就不推
  if (body.notifyWecom && !isValidWecomWebhook(body.notifyWecom)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWecom"));
  }
  if (body.notifyTelegram && !isValidTelegramChatId(body.notifyTelegram)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badTelegram"));
  }
  if (body.notifyServerchan && !isValidServerChanKey(body.notifyServerchan)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badServerchan"));
  }
  if (body.notifyDiscord && !isValidDiscordWebhook(body.notifyDiscord)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDiscord"));
  }
  if (body.notifySlack && !isValidSlackWebhook(body.notifySlack)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSlack"));
  }
  if (body.notifyNtfy && !isValidNtfyTopic(body.notifyNtfy)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badNtfy"));
  }
  if (body.notifyPushoverUser && !isValidPushoverKey(body.notifyPushoverUser)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPushover"));
  }
  if (body.notifyPushoverToken && !isValidPushoverKey(body.notifyPushoverToken)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPushover"));
  }
  if (body.notifyWebhook && !isValidGenericWebhook(body.notifyWebhook)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWebhook"));
  }
  if (body.notifyEmail && !isValidEmail(body.notifyEmail)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmail"));
  }
  // 邮件走碗主人自己配的 HTTP 邮件 API：地址 + Key 是必配套，发件人可选
  if (body.emailApiUrl && !isValidEmailApiUrl(body.emailApiUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailApiUrl"));
  }
  if (body.emailApiKey && !isValidEmailApiKey(body.emailApiKey)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailApiKey"));
  }
  if (body.emailFrom && !isValidEmailFrom(body.emailFrom)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailFrom"));
  }

  const avatarUrl = body.avatarUrl && isLocalImageUrl(body.avatarUrl) ? body.avatarUrl : "";
  let deadline = null;
  if (body.deadline) {
    const d = new Date(body.deadline);
    if (Number.isNaN(d.getTime())) {
      return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDeadline"));
    }
    deadline = d.toISOString();
  }

  // 3. IP 日限：直接 INSERT，靠 UNIQUE 兜底并发
  const { key: dailyKey, date } = await computeDailyKey(ip, env.SERVER_SECRET);
  let limitInserted = false;
  try {
    const r = await env.DB.prepare(
      "INSERT INTO daily_bowl_limits (daily_key, date) VALUES (?, ?)"
    )
      .bind(dailyKey, date)
      .run();
    limitInserted = r.success;
  } catch (err) {
    if (isUniqueConflict(err)) {
      return fail(ERR.RATE_LIMITED, t(locale, "err.dailyLimit"), 429);
    }
    return fail(ERR.SERVER_ERROR, t(locale, "err.createFailed"), 500);
  }

  // 4. 创建用户 + 饭碗儿（slug 冲突重试）
  // 文本字段统一 trim；链上地址再统一转小写（TRC20 是大小写敏感的 base58，保留原样）
  const tx = (v) => (typeof v === "string" ? v.trim() : "");
  const lower = (v) => tx(v).toLowerCase();

  const editToken = randomToken();
  try {
    const userRes = await env.DB.prepare(
      "INSERT INTO users (nickname, avatar_url, ip_hash) VALUES (?, ?, ?)"
    )
      .bind(nickname, avatarUrl, dailyKey.slice(0, 32))
      .run();
    const userId = userRes.meta.last_row_id;

    for (let attempt = 0; attempt < (slugOpt ? 1 : 3); attempt++) {
      const slug = slugOpt || randomSlug();
      try {
        await env.DB.prepare(
          `INSERT INTO bowls
             (slug, user_id, title, want, reason, currency, language, target_cents, deadline,
              wechat_qr, alipay_qr,
              usdt_address, usdt_qr, usdt_bep20_address, usdt_bep20_qr,
              usdt_erc20_address, usdt_erc20_qr, btc_address, btc_qr, eth_address, sol_address,
              stripe_url, kofi_url, bmc_url, wise_email, revolut_url,
              paypal_link, paypal_qr,
              notify_wecom, notify_telegram, notify_serverchan, notify_email,
              notify_discord, notify_slack, notify_ntfy,
              notify_pushover_user, notify_pushover_token, notify_webhook_url,
              email_api_url, email_api_key, email_from,
              nickname, avatar_url, status, edit_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
          .bind(
            slug,
            userId,
            title,
            want,
            reason,
            currency,
            language,
            targetCents,
            deadline,
            tx(body.wechatQr),
            tx(body.alipayQr),
            tx(body.usdtAddress),
            tx(body.usdtQr),
            lower(body.usdtBep20Address),
            tx(body.usdtBep20Qr),
            lower(body.usdtErc20Address),
            tx(body.usdtErc20Qr),
            tx(body.btcAddress),
            tx(body.btcQr),
            lower(body.ethAddress),
            tx(body.solAddress),
            tx(body.stripeUrl),
            tx(body.kofiUrl),
            tx(body.bmcUrl),
            tx(body.wiseEmail),
            tx(body.revolutUrl),
            tx(body.paypalLink),
            tx(body.paypalQr),
            tx(body.notifyWecom),
            tx(body.notifyTelegram),
            tx(body.notifyServerchan),
            tx(body.notifyEmail),
            tx(body.notifyDiscord),
            tx(body.notifySlack),
            tx(body.notifyNtfy),
            tx(body.notifyPushoverUser),
            tx(body.notifyPushoverToken),
            tx(body.notifyWebhook),
            tx(body.emailApiUrl),
            tx(body.emailApiKey),
            tx(body.emailFrom),
            nickname,
            avatarUrl,
            editToken
          )
          .run();
        return ok({ slug, editToken, currency, language }, 201);
      } catch (err) {
        if (!isUniqueConflict(err)) throw err;
        if (slugOpt) {
          // 用户自定的后缀被占了：把日限退掉，莫白占别个一天一次的配额
          await env.DB.prepare("DELETE FROM daily_bowl_limits WHERE daily_key = ? AND date = ?")
            .bind(dailyKey, date)
            .run();
          return fail(ERR.CONFLICT, t(locale, "err.slugTaken"), 409);
        }
        // 随机 slug 撞了，换个再试
      }
    }
    throw new Error("slug conflict after retries");
  } catch (err) {
    // 建失败了，把日限记录退掉，莫白占别个一天一次的配额
    await env.DB.prepare("DELETE FROM daily_bowl_limits WHERE daily_key = ? AND date = ?")
      .bind(dailyKey, date)
      .run();
    return fail(ERR.SERVER_ERROR, t(locale, "err.createFailed"), 500);
  }
}

// GET /api/bowl/:slug
export async function getBowl(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!isValidSlug(slug)) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);

  // 懒更新状态
  let status = bowl.status;
  if (status === "active") {
    if (bowl.deadline && bowl.deadline < new Date().toISOString()) {
      status = "expired";
    } else if (bowl.current_cents >= bowl.target_cents) {
      status = "completed";
    }
    if (status !== bowl.status) {
      await env.DB.prepare("UPDATE bowls SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status, bowl.id)
        .run();
      bowl.status = status;
    }
  }

  const donations = await env.DB.prepare(
    `SELECT * FROM donations WHERE bowl_id = ? AND status = 'approved'
     ORDER BY created_at DESC LIMIT 20`
  )
    .bind(bowl.id)
    .all();

  return ok({
    bowl: formatBowl(bowl),
    donations: donations.results.map((d) => formatDonation(d, locale)),
  });
}

// PUT /api/bowl/:slug（编辑：标题/想吃啥/为啥/金额/币种/截止时间/收款方式/通知渠道/昵称）
export async function updateBowl(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!isValidSlug(slug)) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  if (bowl.status !== "active") {
    return fail(ERR.CONFLICT, t(locale, "err.editNotAllowed"), 409);
  }

  const body = await readJson(request);
  if (!body) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badJson"));
  if (!body.editToken || body.editToken !== bowl.edit_token) {
    return fail(ERR.UNAUTHORIZED, t(locale, "err.notYourBowl"), 401);
  }

  const title = clean(body.title, LIMITS.titleMax);
  const want = clean(body.want, LIMITS.wantMax);
  const reason = clean(body.reason, LIMITS.reasonMax);
  const nickname = clean(body.nickname, LIMITS.nicknameMax);

  // 币种：一旦已经有人投过，就锁死不能换了 ——
  // 库里的 current_cents / amount_cents 都是「该币种的最小单位」，
  // 中途换币种会让已经收到的金额瞬间变成另一个数，是纯粹的账目错乱。
  let currency = bowl.currency || DEFAULT_CURRENCY;
  if (body.currency && normalizeCurrency(body.currency) !== currency) {
    if (bowl.current_cents > 0) {
      return fail(ERR.CONFLICT, t(locale, "err.currencyLocked"), 409);
    }
    currency = normalizeCurrency(body.currency);
  }
  const language = SUPPORTED_LOCALES.includes(body.language) ? body.language : bowl.language || locale;
  const targetCents = yuanToCents(body.targetAmount, currency);

  if (!title) return fail(ERR.VALIDATION_ERROR, t(locale, "err.titleRequired"));
  if (!reason) return fail(ERR.VALIDATION_ERROR, t(locale, "err.reasonRequired"));
  if (!nickname) return fail(ERR.VALIDATION_ERROR, t(locale, "err.nicknameRequired"));
  if (targetCents === null) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badAmount"));
  if (targetCents < bowl.current_cents) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.amountBelowRaised"));
  }

  // —— 二维码图
  if (body.wechatQr && !isLocalImageUrl(body.wechatQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.alipayQr && !isLocalImageUrl(body.alipayQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtQr && !isLocalImageUrl(body.usdtQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtBep20Qr && !isLocalImageUrl(body.usdtBep20Qr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.usdtErc20Qr && !isLocalImageUrl(body.usdtErc20Qr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.btcQr && !isLocalImageUrl(body.btcQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  if (body.paypalQr && !isLocalImageUrl(body.paypalQr)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.qrInvalid"));
  }
  // —— 链上地址（只在填了的时候校验；空着就保留原值）
  if (body.usdtAddress && !isValidTrc20Address(body.usdtAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badTrc20"));
  }
  if (body.usdtBep20Address && !isValidBep20Address(body.usdtBep20Address)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBep20"));
  }
  if (body.usdtErc20Address && !isValidBep20Address(body.usdtErc20Address)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badErc20"));
  }
  if (body.ethAddress && !isValidEthAddress(body.ethAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEth"));
  }
  if (body.btcAddress && !isValidBtcAddress(body.btcAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBtc"));
  }
  if (body.solAddress && !isValidSolAddress(body.solAddress)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSol"));
  }
  // —— 海外托管收款链接
  if (body.paypalLink && !isValidPayPalLink(body.paypalLink)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPaypal"));
  }
  if (body.stripeUrl && !isValidStripeUrl(body.stripeUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badStripe"));
  }
  if (body.kofiUrl && !isValidKofiUrl(body.kofiUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badKofi"));
  }
  if (body.bmcUrl && !isValidBmcUrl(body.bmcUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badBmc"));
  }
  if (body.wiseEmail && !isValidWiseRecipient(body.wiseEmail)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWise"));
  }
  if (body.revolutUrl && !isValidRevolutUrl(body.revolutUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badRevolut"));
  }
  // —— 通知渠道
  if (body.notifyWecom && !isValidWecomWebhook(body.notifyWecom)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWecom"));
  }
  if (body.notifyTelegram && !isValidTelegramChatId(body.notifyTelegram)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badTelegram"));
  }
  if (body.notifyServerchan && !isValidServerChanKey(body.notifyServerchan)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badServerchan"));
  }
  if (body.notifyDiscord && !isValidDiscordWebhook(body.notifyDiscord)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDiscord"));
  }
  if (body.notifySlack && !isValidSlackWebhook(body.notifySlack)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badSlack"));
  }
  if (body.notifyNtfy && !isValidNtfyTopic(body.notifyNtfy)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badNtfy"));
  }
  if (body.notifyPushoverUser && !isValidPushoverKey(body.notifyPushoverUser)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPushover"));
  }
  if (body.notifyPushoverToken && !isValidPushoverKey(body.notifyPushoverToken)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badPushover"));
  }
  if (body.notifyWebhook && !isValidGenericWebhook(body.notifyWebhook)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badWebhook"));
  }
  if (body.notifyEmail && !isValidEmail(body.notifyEmail)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmail"));
  }
  // 邮件 API 三件套（碗主人自配）：地址 + Key 配套，发件人可选；Key 不填就保留原来的
  if (body.emailApiUrl && !isValidEmailApiUrl(body.emailApiUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailApiUrl"));
  }
  if (body.emailApiKey && !isValidEmailApiKey(body.emailApiKey)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailApiKey"));
  }
  if (body.emailFrom && !isValidEmailFrom(body.emailFrom)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badEmailFrom"));
  }
  if (body.avatarUrl && !isLocalImageUrl(body.avatarUrl)) {
    return fail(ERR.VALIDATION_ERROR, t(locale, "err.badAvatar"));
  }

  let deadline = bowl.deadline;
  if (body.deadline) {
    const d = new Date(body.deadline);
    if (Number.isNaN(d.getTime())) return fail(ERR.VALIDATION_ERROR, t(locale, "err.badDeadline"));
    deadline = d.toISOString();
  }

  // 空值一律回落到库里原值（前端传 undefined 表示「这一项没动」）
  const tx = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const lower = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : fallback);

  await env.DB.prepare(
    `UPDATE bowls SET title=?, want=?, reason=?, currency=?, language=?, target_cents=?, deadline=?,
       wechat_qr=?, alipay_qr=?,
       usdt_address=?, usdt_qr=?, usdt_bep20_address=?, usdt_bep20_qr=?,
       usdt_erc20_address=?, usdt_erc20_qr=?, btc_address=?, btc_qr=?, eth_address=?, sol_address=?,
       stripe_url=?, kofi_url=?, bmc_url=?, wise_email=?, revolut_url=?,
       paypal_link=?, paypal_qr=?,
       notify_wecom=?, notify_telegram=?, notify_serverchan=?, notify_email=?,
       notify_discord=?, notify_slack=?, notify_ntfy=?,
       notify_pushover_user=?, notify_pushover_token=?, notify_webhook_url=?,
       email_api_url=?, email_api_key=?, email_from=?,
       nickname=?, avatar_url=?, updated_at=datetime('now')
     WHERE id=?`
  )
    .bind(
      title,
      want,
      reason,
      currency,
      language,
      targetCents,
      deadline,
      body.wechatQr || bowl.wechat_qr,
      body.alipayQr || bowl.alipay_qr,
      tx(body.usdtAddress, bowl.usdt_address),
      body.usdtQr || bowl.usdt_qr,
      lower(body.usdtBep20Address, bowl.usdt_bep20_address),
      body.usdtBep20Qr || bowl.usdt_bep20_qr,
      lower(body.usdtErc20Address, bowl.usdt_erc20_address),
      body.usdtErc20Qr || bowl.usdt_erc20_qr,
      tx(body.btcAddress, bowl.btc_address),
      body.btcQr || bowl.btc_qr,
      lower(body.ethAddress, bowl.eth_address),
      tx(body.solAddress, bowl.sol_address),
      tx(body.stripeUrl, bowl.stripe_url),
      tx(body.kofiUrl, bowl.kofi_url),
      tx(body.bmcUrl, bowl.bmc_url),
      tx(body.wiseEmail, bowl.wise_email),
      tx(body.revolutUrl, bowl.revolut_url),
      tx(body.paypalLink, bowl.paypal_link),
      body.paypalQr || bowl.paypal_qr,
      tx(body.notifyWecom, bowl.notify_wecom),
      tx(body.notifyTelegram, bowl.notify_telegram),
      tx(body.notifyServerchan, bowl.notify_serverchan),
      tx(body.notifyEmail, bowl.notify_email),
      tx(body.notifyDiscord, bowl.notify_discord),
      tx(body.notifySlack, bowl.notify_slack),
      tx(body.notifyNtfy, bowl.notify_ntfy),
      tx(body.notifyPushoverUser, bowl.notify_pushover_user),
      tx(body.notifyPushoverToken, bowl.notify_pushover_token),
      tx(body.notifyWebhook, bowl.notify_webhook_url),
      tx(body.emailApiUrl, bowl.email_api_url),
      tx(body.emailApiKey, bowl.email_api_key),
      tx(body.emailFrom, bowl.email_from),
      nickname,
      body.avatarUrl || bowl.avatar_url,
      bowl.id
    )
    .run();

  return ok({ slug, currency, language });
}

// —— 摆碗的本人（edit_token）查看并放行自家饭碗的投喂 ——

// GET /api/bowl/:slug/pending?token=xxx —— 自家的待放行投喂
// 自动上墙模式下没有 pending，改为返回「最近已上墙」的投喂，碗主人仍可拒掉不实的那笔
export async function getPendingDonations(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!isValidSlug(slug)) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token || token !== bowl.edit_token) {
    return fail(ERR.UNAUTHORIZED, t(locale, "err.notYourBowl"), 401);
  }
  const rows = await env.DB.prepare(
    `SELECT * FROM donations WHERE bowl_id = ? AND status = 'pending'
     ORDER BY created_at ASC`
  ).bind(bowl.id).all();
  const rejected = await env.DB.prepare(
    `SELECT * FROM donations WHERE bowl_id = ? AND status = 'rejected'
     ORDER BY created_at DESC LIMIT 10`
  ).bind(bowl.id).all();
  // 已自动上墙的最近记录（碗主人可在这里把它们拒掉）
  const autoApproved = await env.DB.prepare(
    `SELECT * FROM donations WHERE bowl_id = ? AND status = 'approved'
     ORDER BY created_at DESC LIMIT 20`
  ).bind(bowl.id).all();
  return ok({
    pending: rows.results.map((d) => formatDonation(d, locale)),
    rejected: rejected.results.map((d) => formatDonation(d, locale)),
    approved: autoApproved.results.map((d) => formatDonation(d, locale)),
    autoApprove: autoApproveMode(env),
  });
}

// 校验 edit_token + 这笔投喂确实是投到自家饭碗的
async function ownDonation(env, bowl, body, locale) {
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return { err: fail(ERR.VALIDATION_ERROR, t(locale, "err.badDonationId")) };
  if (!body?.editToken || body.editToken !== bowl.edit_token) {
    return { err: fail(ERR.UNAUTHORIZED, t(locale, "err.notYourBowl"), 401) };
  }
  const row = await env.DB.prepare("SELECT * FROM donations WHERE id = ?").bind(id).first();
  if (!row || row.bowl_id !== bowl.id) {
    return { err: fail(ERR.NOT_FOUND, t(locale, "err.donationNotFound"), 404) };
  }
  return { row };
}

// POST /api/bowl/:slug/approve {id, editToken} —— 放他过（幂等：只处理 pending）
// 自动上墙模式下投喂已经是 approved，这里会返回 no-op，不会重复累加金额。
export async function approveOwnDonation(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!isValidSlug(slug)) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const { row, err } = await ownDonation(env, bowl, await readJson(request), locale);
  if (err) return err;

  const res = await env.DB.prepare(
    `UPDATE donations SET status='approved', approved_at=datetime('now')
     WHERE id=? AND status='pending'`
  ).bind(row.id).run();

  if (res.meta.changes > 0) {
    await env.DB.prepare(
      `UPDATE bowls SET current_cents = current_cents + ?
       WHERE id = ?`
    ).bind(row.amount_cents, bowl.id).run();
  }
  return ok({ id: row.id, changed: res.meta.changes > 0 });
}

// POST /api/bowl/:slug/reject {id, editToken} —— 这个不行
// 自动上墙模式下，被拒的往往是已经计过账的投喂，所以要把金额扣回去。
export async function rejectOwnDonation(request, env, slug) {
  const locale = detectLocale(request, env);
  if (!isValidSlug(slug)) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return fail(ERR.NOT_FOUND, t(locale, "err.bowlNotFound"), 404);
  const { row, err } = await ownDonation(env, bowl, await readJson(request), locale);
  if (err) return err;

  const wasApproved = row.status === "approved";
  const stmts = [
    env.DB.prepare(
      `UPDATE donations SET status='rejected' WHERE id=? AND status IN ('pending','approved')`
    ).bind(row.id),
  ];
  // 之前已经计过账的，拒掉的时候把金额扣回去
  if (wasApproved) {
    stmts.push(
      env.DB.prepare("UPDATE bowls SET current_cents = MAX(0, current_cents - ?) WHERE id = ?")
        .bind(row.amount_cents, bowl.id)
    );
  }
  await env.DB.batch(stmts);
  return ok({ id: row.id, refunded: wasApproved });
}
