// 静态资源服务 + bowl.html 的 OG meta 动态注入
import { getBowlBySlug } from "./lib/db.js";
import { isValidSlug } from "./lib/validate.js";
import { detectLocale, t, tp } from "./lib/i18n.js";
import { formatShort } from "./lib/currency.js";

const OG_PLACEHOLDERS = [
  "__TITLE__",
  "__OG_DESC__",
  "__OG_IMAGE__",
  "__OG_URL__",
  "__META_DESC__",
];

// bowl.html 是静态文件，OG meta 写死没用；这里从 D1 取数据替换占位符，
// 让微信/Telegram/X 等爬虫能读到正确的标题和分享图。
// pathSlug 支持两种入口：老式 /bowl.html?slug=xxx（不传）和 新式 /cunzhang（传 slug）。
export async function serveBowHtml(env, request, pathSlug) {
  const url = new URL(request.url);
  const slug = pathSlug || url.searchParams.get("slug") || "";

  // 永远取 bowl.html 静态文件（路径式 /cunzhang 在 ASSETS 里本来就没得这个文件）
  const res = await env.ASSETS.fetch(new Request(new URL("/bowl.html", url), request));
  if (!res.ok) return res;
  const html = await res.text();

  // 带 ?token= 的地址是「后台门票」：
  // - Referrer-Policy 一律 no-referrer，令牌不会顺着 Referer 漏给外站（付款跳转也算）
  // - 带令牌的这一版直接 noindex，免得哪天被谁贴到能被爬的地方收录进搜索结果
  //   （canonical 已经指向不带令牌的干净地址，这里再加一道锁）
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
  };
  if (url.searchParams.has("token")) {
    headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
  }

  if (!isValidSlug(slug)) {
    let out = html;
    for (const p of OG_PLACEHOLDERS) out = out.replaceAll(p, "");
    return new Response(out, { status: res.status, headers });
  }

  const locale = detectLocale(request, env);
  const bowl = await getBowlBySlug(env.DB, slug).catch(() => null);
  // OG 链接用当前请求域名动态拼：爬虫抓的 host 就是部署域名，绑不绑自定义域名都自动正确，
  // 不需要配 SITE_URL。
  const siteUrl = new URL(request.url).origin;
  const percent = bowl
    ? Math.min(100, Math.round((bowl.current_cents / bowl.target_cents) * 100))
    : 0;

  // 文案全部走文案包，按请求语言出 —— 海外爬虫（X / Discord / Slack）看到的是英文
  const stateOf = tp(locale, "og.stateOf") || (() => "");
  const pageTitle = tp(locale, "og.pageTitle") || ((nick, s) => s);
  const bowlMetaDesc = tp(locale, "og.bowlMetaDesc") || (() => "");
  const ogDescTpl = tp(locale, "og.ogDesc") || ((n, s) => s);

  const brand = t(locale, "og.brand") || "Fanwaner";
  const state = stateOf(percent);
  // 页面标题按人生成：alex's meal · Just trying to get a burger
  const title = bowl ? pageTitle(bowl.nickname, bowl.title) : (t(locale, "og.siteTitle") || brand);
  const metaDesc = bowl ? bowlMetaDesc(bowl.nickname) : (t(locale, "og.siteDesc") || "");
  // 金额按饭碗儿自己的币种出（不再写死 ¥）
  const amount = bowl
    ? `${formatShort(bowl.current_cents, bowl.currency)} / ${formatShort(bowl.target_cents, bowl.currency)}`
    : "";
  const ogDesc = bowl
    ? ogDescTpl(bowl.nickname, state, amount, percent)
    : (t(locale, "og.siteDesc") || "");
  const image = bowl ? `${siteUrl}/og/${slug}.png` : `${siteUrl}/favicon.svg`;
  const canonical = `${siteUrl}/${slug}`;

  const replaced = html
    // 让爬虫（不执行 JS）也拿到正确语言：SEO / 读屏软件都依赖这个属性
    .replace(/<html lang="[^"]*"/, `<html lang="${locale === "zh" ? "zh-CN" : locale}"`)
    .replaceAll("__TITLE__", escapeAttr(title))
    .replaceAll("__OG_DESC__", escapeAttr(ogDesc))
    .replaceAll("__OG_IMAGE__", escapeAttr(image))
    .replaceAll("__OG_URL__", escapeAttr(canonical))
    .replaceAll("__META_DESC__", escapeAttr(metaDesc));

  return new Response(replaced, { status: res.status, headers });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 普通静态资源（含 404.html 兜底）
export async function serveStatic(env, request) {
  const url = new URL(request.url);
  // html_handling = "none" 后根路径不会自动映射 index.html，这里手动补
  const target =
    url.pathname === "/"
      ? new URL("/index.html" + url.search, url)
      : new Request(url, request);
  const res = await env.ASSETS.fetch(target);
  if (res.status === 404) {
    const notFound = await env.ASSETS.fetch(new URL("/404.html", request.url));
    if (notFound.ok) {
      return new Response(await notFound.arrayBuffer(), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // 首页 OG meta：index.html 里是占位符，这里注入静态值，莫让爬虫看到 __OG_TITLE__ 字面量
  if (url.pathname === "/" && res.headers.get("Content-Type")?.includes("text/html")) {
    const locale = detectLocale(request, env);
    const html = await res.text();
    const siteUrl = new URL(request.url).origin;
    const out = html
      .replace(/<html lang="[^"]*"/, `<html lang="${locale === "zh" ? "zh-CN" : locale}"`)
      .replaceAll("__OG_TITLE__", escapeAttr(t(locale, "og.siteTitle") || "Fanwaner"))
      .replaceAll("__OG_DESC__", escapeAttr(t(locale, "og.siteDesc") || ""))
      .replaceAll("__OG_IMAGE__", escapeAttr(`${siteUrl}/favicon.svg`))
      .replaceAll("__OG_URL__", escapeAttr(`${siteUrl}/`));
    return new Response(out, {
      status: res.status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return res;
}
