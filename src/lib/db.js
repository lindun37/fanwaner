// D1 查询小工具
import { t } from "./i18n.js";
import { toMajor } from "./currency.js";

// 判断 D1 异常是否为 UNIQUE 约束冲突
export function isUniqueConflict(err) {
  const m = err?.message || "";
  return m.includes("UNIQUE constraint failed") || m.includes("constraint failed");
}

export async function getBowlBySlug(db, slug) {
  return db
    .prepare("SELECT * FROM bowls WHERE slug = ?")
    .bind(slug)
    .first();
}

export function formatBowl(row) {
  if (!row) return null;
  const currency = row.currency || "CNY";
  // 注意：JPY / KRW 这类零小数位币种不能简单 /100，前端一律用 currency + *_Minor 渲染
  return {
    slug: row.slug,
    title: row.title,
    want: row.want,
    reason: row.reason,
    currency,
    language: row.language || "zh",
    // 新：最小单位整数 + 币种，交给前端 Intl 格式化
    targetMinor: row.target_cents,
    currentMinor: row.current_cents,
    // 兼容旧前端：按币种换算（JPY/KRW 零小数位，不能写死 /100）
    targetYuan: toMajor(row.target_cents, currency),
    currentYuan: toMajor(row.current_cents, currency),
    percent: Math.min(100, Math.round((row.current_cents / row.target_cents) * 100)),
    deadline: row.deadline,
    wechatQr: row.wechat_qr,
    alipayQr: row.alipay_qr,
    usdtAddress: row.usdt_address,
    usdtQr: row.usdt_qr,
    usdtBep20Address: row.usdt_bep20_address,
    usdtBep20Qr: row.usdt_bep20_qr,
    usdtErc20Address: row.usdt_erc20_address,
    usdtErc20Qr: row.usdt_erc20_qr,
    btcAddress: row.btc_address,
    btcQr: row.btc_qr,
    ethAddress: row.eth_address,
    solAddress: row.sol_address,
    stripeUrl: row.stripe_url,
    kofiUrl: row.kofi_url,
    bmcUrl: row.bmc_url,
    wiseEmail: row.wise_email,
    revolutUrl: row.revolut_url,
    paypalLink: row.paypal_link,
    paypalQr: row.paypal_qr,
    notifyWecom: row.notify_wecom,
    notifyTelegram: row.notify_telegram,
    notifyServerchan: row.notify_serverchan,
    notifyEmail: row.notify_email,
    notifyDiscord: row.notify_discord,
    notifySlack: row.notify_slack,
    notifyNtfy: row.notify_ntfy,
    notifyPushoverUser: row.notify_pushover_user,
    notifyWebhook: row.notify_webhook_url,
    emailApiUrl: row.email_api_url,
    emailFrom: row.email_from,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function formatDonation(row, locale = "en") {
  if (!row) return null;
  const anon = row.is_anonymous
    ? t(locale, "feed.anonymous") || "Anonymous"
    : row.nickname || t(locale, "feed.passerby") || "Passer-by";
  const currency = row.currency || "CNY";
  return {
    id: row.id,
    // nickname 是「可显示名」：匿名时用本地化的「匿名用户」占位
    nickname: anon,
    rawNickname: row.nickname || "",
    amountMinor: row.amount_cents,
    currency,
    // 兼容旧前端：按币种换算（JPY/KRW 零小数位，不能写死 /100）
    amountYuan: toMajor(row.amount_cents, currency),
    message: row.message,
    paymentMethod: row.payment_method,
    txid: row.txid,
    anonymous: !!row.is_anonymous,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}
