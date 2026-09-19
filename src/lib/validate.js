// 字段校验规则与工具
// i18n 改造后：金额改为「币种 + 最小单位」，收款方式与通知渠道扩充到海外常用服务。

import { normalizeCurrency, toMinor, isSupportedCurrency } from "./currency.js";

export const LIMITS = {
  titleMax: 50,
  wantMax: 200,
  reasonMax: 500,
  nicknameMax: 30,
  messageMax: 200,
  txidMax: 128,
  amountMaxYuan: 1000, // 兼容旧配置（CNY 元）
  amountMaxCents: 100000, // 兼容旧 CHECK 约束
  pageSizeMax: 20,
};

// 清洗文本：去首尾空白 + 截断
export function clean(s, max) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

// 金额（主单位，字符串/数字）→ 最小单位整数；非法返回 null
// 保留 yuanToCents 这个名字做向后兼容（内部已改为按币种计算）
export function yuanToCents(v, currency = "CNY") {
  return toMinor(v, normalizeCurrency(currency));
}

export const toMinorUnits = yuanToCents;

// 币种校验
export function isValidCurrency(c) {
  return isSupportedCurrency(c);
}

// ---- 收款方式 ----
// 中国：wechat / alipay
// 海外通用：paypal / stripe / kofi / buymeacoffee / wise / revolut
// 加密：usdt(TRC20) / usdt_bep20 / usdt_erc20 / btc / eth / sol
export const PAYMENT_METHODS = [
  "wechat",
  "alipay",
  "paypal",
  "stripe",
  "kofi",
  "buymeacoffee",
  "wise",
  "revolut",
  "usdt",
  "usdt_bep20",
  "usdt_erc20",
  "btc",
  "eth",
  "sol",
  "other",
];

// 纯链上（需要地址，可选填 TXID）
export const CRYPTO_METHODS = ["usdt", "usdt_bep20", "usdt_erc20", "btc", "eth", "sol"];

// 二维码类（依赖上传图片）
export const QR_METHODS = ["wechat", "alipay", "usdt", "usdt_bep20", "usdt_erc20", "btc", "paypal"];

export function isValidPaymentMethod(m) {
  return PAYMENT_METHODS.includes(m);
}

export function isCryptoMethod(m) {
  return CRYPTO_METHODS.includes(m);
}

// PayPal 收款：paypal.me / paypal.com 链接，或者邮箱
export function isValidPayPalLink(u) {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (!s || s.length > 128) return false;
  if (/^https?:\/\/[a-z0-9.-]*(?:paypal\.me|paypal\.com)[a-zA-Z0-9/._?&=%-]*$/i.test(s)) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

// Stripe：payment link / checkout 链接（也可以直接给任意 https 链接）
// 注意：这里同时也接受 Stripe 之外的托管收款页（如 donate.stripe.com 之外的第三方），
//       所以只做「是不是一个像样的 https 地址」的判断，不锁死域名。
export function isValidStripeUrl(u) {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (!s || s.length > 200) return false;
  if (/^https:\/\/(buy|checkout|donate)\.stripe\.com\/[\w\-./?=&%]{1,180}$/i.test(s)) return true;
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/[\w\-./?=&%]{0,180}$/i.test(s);
}

// Ko-fi：https://ko-fi.com/xxx
export function isValidKofiUrl(u) {
  return typeof u === "string" && /^https?:\/\/(www\.)?ko-fi\.com\/[A-Za-z0-9_/-]{1,60}$/.test(u.trim());
}

// Buy Me a Coffee：https://buymeacoffee.com/xxx
export function isValidBmcUrl(u) {
  return typeof u === "string" && /^https?:\/\/(www\.)?buymeacoffee\.com\/[A-Za-z0-9_/-]{1,60}$/.test(u.trim());
}

// Revolut：https://revolut.me/xxx
export function isValidRevolutUrl(u) {
  return typeof u === "string" && /^https?:\/\/(www\.)?revolut\.me\/[A-Za-z0-9_/-]{1,60}$/.test(u.trim());
}

// Wise：邮箱（Wise 收款主要靠 email / 用户名）
export function isValidWiseRecipient(s) {
  return typeof s === "string" && s.trim().length <= 128 &&
    (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim()) || /^https?:\/\/wise\.com\/[\w\-./?=&%]{0,120}$/.test(s.trim()));
}

// ---- 地址校验 ----

// BEP20 / ERC20 / ETH 地址：0x + 40 位十六进制
export function isValidBep20Address(u) {
  return typeof u === "string" && /^0x[a-fA-F0-9]{40}$/.test(u.trim());
}
export const isValidErc20Address = isValidBep20Address;
export const isValidEthAddress = isValidBep20Address;

// Solana：base58，32-44 位
export function isValidSolAddress(u) {
  return typeof u === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(u.trim());
}

// BTC：legacy 1/3、bech32 bc1、以及测试网不算
export function isValidBtcAddress(u) {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,39}$/.test(s)) return true;
  if (/^bc1[qzry9x8gf2tvdw0s3jn54khce6mua7l][a-z0-9]{20,87}$/.test(s)) return true;
  return false;
}

// TRC20：T 开头 base58，34 位
export function isValidTrc20Address(u) {
  return typeof u === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(u.trim());
}

// ---- 通知渠道 ----

// 企业微信机器人 webhook
export function isValidWecomWebhook(u) {
  return typeof u === "string" && /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]{1,80}$/.test(u.trim());
}

// Discord Webhook
export function isValidDiscordWebhook(u) {
  return typeof u === "string" && /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}$/.test(u.trim());
}

// Slack Incoming Webhook
export function isValidSlackWebhook(u) {
  return typeof u === "string" && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}$/.test(u.trim());
}

// ntfy 主题名（只存主题，服务器默认 ntfy.sh）
export function isValidNtfyTopic(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s.trim());
}

// Pushover user key / api token：30 位字母数字
export function isValidPushoverKey(s) {
  return typeof s === "string" && /^[A-Za-z0-9]{30}$/.test(s.trim());
}

// 通用 Webhook：任意 https 地址（用户自己接 Zapier / Make / n8n 等）
export function isValidGenericWebhook(u) {
  return typeof u === "string" && u.trim().length <= 200 && /^https:\/\/[^\s]+\.[^\s]{2,}$/.test(u.trim());
}

// Telegram chat_id：纯数字或 -100 开头的群 id
export function isValidTelegramChatId(s) {
  return typeof s === "string" && /^-?\d{5,15}$/.test(s.trim());
}

// Server酱 SendKey
export function isValidServerChanKey(s) {
  return typeof s === "string" && /^(SCT\d+[A-Za-z0-9]+|SCU\d{10,}[A-Za-z0-9]*)$/.test(s.trim());
}

// 邮箱
export function isValidEmail(s) {
  return typeof s === "string" && s.trim().length <= 128 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

// 邮件 API 地址（Resend 兼容）
export function isValidEmailApiUrl(u) {
  return typeof u === "string" && u.trim().length <= 200 && /^https:\/\/[^\s]+\.[^\s]{2,}$/.test(u.trim());
}

export function isValidEmailApiKey(k) {
  return typeof k === "string" && k.trim().length >= 6 && k.trim().length <= 128;
}

export function isValidEmailFrom(f) {
  if (typeof f !== "string") return false;
  const s = f.trim();
  if (s.length > 128) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) || /^.{1,60}\s*<[^\s@]+@[^\s@]+\.[^\s@]{2,}>$/.test(s);
}

// 校验本站图片 URL（只允许 /i/ 开头的相对路径）
export function isLocalImageUrl(u) {
  return typeof u === "string" && /^\/i\/[A-Za-z0-9/_.-]+$/.test(u);
}

// 自定义后缀
export const SLUG_MAX = 20;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,18})[a-z0-9]$/;

export const RESERVED_SLUGS = new Set([
  "api", "i", "og", "css", "js", "img", "fonts", "favicon", "i18n",
  "index", "bowl", "create", "admin", "404", "robots", "tips",
]);

export function isValidSlug(s) {
  return typeof s === "string" && SLUG_RE.test(s);
}
