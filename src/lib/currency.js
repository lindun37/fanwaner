// 多币种支持
// 原项目把金额写死成「人民币 / 分」（target_cents、amount_cents，上限 100000 分 = 1000 元），
// 海外用户根本没法用。这里把「最小单位整数存储」保留（避免浮点误差），
// 但把币种变成可配置项：每个饭碗儿自己选币种，显示时按币种 + 语言格式化。
//
// 存储约定不变：*_minor 存最小单位整数（USD=cent、JPY=円、EUR=cent…）。
// 只对 JPY / KRW 这类「无小数位」币种，指数 exponent = 0。

export const CURRENCIES = {
  USD: { symbol: "$", exponent: 2, locales: ["en"] },
  EUR: { symbol: "€", exponent: 2, locales: ["de", "fr", "es", "it", "nl"] },
  GBP: { symbol: "£", exponent: 2, locales: ["en-GB"] },
  JPY: { symbol: "¥", exponent: 0, locales: ["ja"] },
  CNY: { symbol: "¥", exponent: 2, locales: ["zh"] },
  KRW: { symbol: "₩", exponent: 0, locales: ["ko"] },
  HKD: { symbol: "HK$", exponent: 2, locales: ["zh-HK"] },
  TWD: { symbol: "NT$", exponent: 2, locales: ["zh-TW"] },
  SGD: { symbol: "S$", exponent: 2, locales: ["en-SG"] },
  AUD: { symbol: "A$", exponent: 2, locales: ["en-AU"] },
  CAD: { symbol: "C$", exponent: 2, locales: ["en-CA"] },
  INR: { symbol: "₹", exponent: 2, locales: ["hi", "en-IN"] },
  BRL: { symbol: "R$", exponent: 2, locales: ["pt-BR"] },
  RUB: { symbol: "₽", exponent: 2, locales: ["ru"] },
  SEK: { symbol: "kr", exponent: 2, locales: ["sv"] },
  CHF: { symbol: "CHF", exponent: 2, locales: ["de-CH", "fr-CH"] },
  MXN: { symbol: "MX$", exponent: 2, locales: ["es-MX"] },
};

export const DEFAULT_CURRENCY = "USD"; // 面向海外，默认美元
export const CURRENCY_CODES = Object.keys(CURRENCIES);

// 单一金额上限（最小单位）。注意：D1 里 donations/bowls 有
//   CHECK(..._cents <= 100000)
// 的旧约束，接入多币种后必须执行 migrations/0007_i18n.sql 放宽/移除它，
// 否则 JPY（exponent=0）会被这条约束卡死。
export const MAX_MINOR = 100000000; // 对应 100 万「元」级，足够宽松

export function isSupportedCurrency(code) {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function normalizeCurrency(code) {
  if (isSupportedCurrency(code)) return code;
  if (typeof code === "string" && isSupportedCurrency(code.toUpperCase())) return code.toUpperCase();
  return DEFAULT_CURRENCY;
}

export function exponentOf(currency) {
  return (CURRENCIES[normalizeCurrency(currency)] || CURRENCIES[DEFAULT_CURRENCY]).exponent;
}

// 「元/美元」输入 → 最小单位整数；非法返回 null
export function toMinor(value, currency = DEFAULT_CURRENCY) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const exp = exponentOf(currency);
  const minor = Math.round(n * 10 ** exp);
  // 不允许超过该币种允许的小数位（USD 不能填 1.234）
  if (Math.abs(n * 10 ** exp - minor) > 1e-6) return null;
  if (minor <= 0 || minor > MAX_MINOR) return null;
  return minor;
}

// 最小单位 → 「元/美元」数字
export function toMajor(minor, currency = DEFAULT_CURRENCY) {
  const n = Number(minor || 0);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** exponentOf(currency);
}

// 按「币种 + 界面语言」格式化，例如 $12.50 / 12,50 € / ￥1,200
export function formatMoney(minor, currency = DEFAULT_CURRENCY, locale = "en") {
  const code = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: exponentOf(code),
      minimumFractionDigits: exponentOf(code),
    }).format(toMajor(minor, code));
  } catch {
    // 老运行时不支持某些币种时，退回「符号 + 数字」
    return `${CURRENCIES[code].symbol}${toMajor(minor, code).toFixed(exponentOf(code))}`;
  }
}

// 只要符号的简写（OG 图 / 通知正文用，避免 Intl 在 Worker 里的体积与兼容问题）
export function formatShort(minor, currency = DEFAULT_CURRENCY) {
  const code = normalizeCurrency(currency);
  const exp = exponentOf(code);
  const n = toMajor(minor, code);
  const digits = exp === 0 ? 0 : Math.min(2, exp);
  return `${CURRENCIES[code].symbol}${n.toFixed(digits)}`;
}

// 从 Accept-Language / 界面语言猜一个默认币种（只作初始值，用户可改）
export function guessCurrency(locale) {
  const l = String(locale || "").toLowerCase();
  for (const [code, meta] of Object.entries(CURRENCIES)) {
    if (meta.locales.some((x) => l.startsWith(x.split("-")[0]))) return code;
  }
  return DEFAULT_CURRENCY;
}
