// OG 分享图接口：GET /og/:slug.png
// 懒生成：首次请求渲染出 PNG 存 R2，之后直接读缓存（10 分钟自然过期）。
import { renderOg } from "../lib/og-render.js";
import { getBowlBySlug } from "../lib/db.js";
import { isValidSlug } from "../lib/validate.js";
import { detectLocale, t, tp } from "../lib/i18n.js";
import { formatShort } from "../lib/currency.js";

export async function handleOg(env, slug, request) {
  if (!isValidSlug(slug)) return notFound();

  // 先读 R2 缓存
  const cached = await env.BUCKET.get(`og/${slug}.png`).catch(() => null);
  if (cached) {
    return new Response(cached.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=600",
      },
    });
  }

  const bowl = await getBowlBySlug(env.DB, slug);
  if (!bowl) return notFound();

  // 语言优先用「摆碗时存下来的语言」—— 这样分享图跟碗主人在页面上看到的一致，
  // 不被爬虫的 Accept-Language 左右；没有记录时才回落到请求头判定。
  const locale = bowl.language || (request ? detectLocale(request, env) : "en");
  const stateOf = tp(locale, "og.stateOf") || (() => "");
  const statusOf = tp(locale, "og.statusOf") || (() => "");

  const percent = Math.min(100, Math.round((bowl.current_cents / bowl.target_cents) * 100));
  const currency = bowl.currency || "CNY";

  const res = await renderOg(env, {
    title: bowl.title,
    // 直接给「已经格式化好、带币种符号」的字符串，OG 图里不再拼 ¥
    amountText: `${formatShort(bowl.current_cents, currency)} / ${formatShort(bowl.target_cents, currency)}`,
    percent,
    stateText: stateOf(percent),
    statusText: statusOf(bowl.status),
    brand: t(locale, "og.brand") || "Fanwaner",
    fallbackTitle: t(locale, "og.fallbackTitle") || "Just trying to get a meal",
  });

  // 存 R2 供后续直接读
  const png = await res.arrayBuffer();
  await env.BUCKET.put(`og/${slug}.png`, png, {
    httpMetadata: { contentType: "image/png" },
  }).catch(() => {});

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=600",
    },
  });
}

function notFound() {
  return new Response(null, { status: 404 });
}
