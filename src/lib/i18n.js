// 服务端 i18n：决定「这一请求用哪种语言」
// 优先级：?lang= > cookie `lang` > Accept-Language > 站点默认（DEFAULT_LOCALE）
// 说明：静态页在浏览器里渲染文案，服务端主要用 lang 来翻译 API 报错 / 通知 / OG 图，
//       所以这里解析出来的 locale 会被一路带到 fail() 与 notify。

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localePack } from "./locales.js";

// 解析 Accept-Language：en-US,en;q=0.9,zh-CN;q=0.8 → 按 q 排序取第一个支持的语言
export function parseAcceptLanguage(header) {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((p) => {
      const [tag, ...rest] = p.trim().split(";");
      const qMatch = rest.join(";").match(/q\s*=\s*([\d.]+)/i);
      return { tag: (tag || "").trim().toLowerCase(), q: qMatch ? parseFloat(qMatch[1]) : 1 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of parts) {
    const base = tag.split("-")[0]; // zh-CN → zh
    if (SUPPORTED_LOCALES.includes(tag)) return tag;
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return null;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const kv of raw.split(";")) {
    const idx = kv.indexOf("=");
    if (idx < 0) continue;
    if (kv.slice(0, idx).trim() === name) {
      return decodeURIComponent(kv.slice(idx + 1).trim());
    }
  }
  return null;
}

// 归一化：只接受 SUPPORTED_LOCALES，否则回落默认
export function normalizeLocale(v) {
  if (!v) return DEFAULT_LOCALE;
  const s = String(v).toLowerCase();
  const base = s.split("-")[0];
  if (SUPPORTED_LOCALES.includes(s)) return s;
  if (SUPPORTED_LOCALES.includes(base)) return base;
  return DEFAULT_LOCALE;
}

// 主入口：从请求里判定语言
export function detectLocale(request, env) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("lang");
  if (fromQuery) return normalizeLocale(fromQuery);

  const fromCookie = readCookie(request, "lang");
  if (fromCookie) return normalizeLocale(fromCookie);

  const fromHeader = parseAcceptLanguage(request.headers.get("Accept-Language"));
  if (fromHeader) return fromHeader;

  return normalizeLocale(env?.DEFAULT_LOCALE || DEFAULT_LOCALE);
}

// 轻量取值：t(locale, "err.badAmount") / t(locale, "notify.title")
// 只返回字符串；取不到返回 undefined，调用方用 `|| "兜底"` 处理。
export function t(locale, path) {
  const value = path
    .split(".")
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), localePack(locale));
  return typeof value === "string" ? value : undefined;
}

// 取「任意类型」的文案节点：函数型模板（OG 文案要拼变量）和数组走这个。
// 用法：tp(locale, "og.pageTitle")(nick, title)
export function tp(locale, path) {
  return path
    .split(".")
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), localePack(locale));
}

// 写回 cookie，让后续请求（含静态页首屏）记住用户选的语言
export function withLocaleCookie(response, locale) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
