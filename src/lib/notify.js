// 留言通知：有新投喂留言时，推给碗主人
// 渠道：企业微信 / Server酱 / Telegram / 邮箱 + 海外常用 Discord / Slack / ntfy / Pushover / 通用 Webhook
// 全部走 ctx.waitUntil 异步外呼，失败静默，绝不拖慢投喂主流程、不重试（免得重复轰炸）

import { t } from "./i18n.js";
import { formatShort } from "./currency.js";

const TELEGRAM_API = "https://api.telegram.org";
const SERVERCHAN_API = "https://sctapi.ftqq.com";
const NTFY_DEFAULT = "https://ntfy.sh";
const PUSHOVER_API = "https://api.pushover.net/1/messages.json";

// 组装通知正文（按碗主人的界面语言）
function buildText(locale, bowl, donation, host) {
  const L = locale || "en";
  const who = donation.isAnonymous
    ? t(L, "notify.anonymous")
    : donation.nickname || t(L, "notify.anonymousFallback");
  const minor = donation.amountMinor != null
    ? donation.amountMinor
    : Math.round((Number(donation.amountYuan) || 0) * 100);
  const amount = formatShort(minor, bowl.currency || "CNY");
  // 免放行模式下投喂已经上墙，通知里说清楚，免得碗主人以为还要点确认
  const note = donation.autoApproved ? t(L, "notify.autoNote") : t(L, "notify.pendingNote");
  return [
    t(L, "notify.title"),
    "",
    `${who} ${t(L, "notify.said")}: ${donation.message || t(L, "notify.noMessage")}`,
    `${t(L, "notify.amount")}: ${amount}`,
    note,
    "",
    `${t(L, "notify.goApprove")}: https://${host}/${bowl.slug}`,
  ].join("\n");
}

export function notifyDonation(env, ctx, bowl, donation, host) {
  const locale = bowl.language || env.DEFAULT_LOCALE || "en";
  const subject = t(locale, "notify.emailSubject");
  const text = buildText(locale, bowl, donation, host);
  const tasks = [];

  // —— 中国常用 ——
  if (bowl.notify_wecom) tasks.push(sendWecom(bowl.notify_wecom, text));
  if (bowl.notify_serverchan) tasks.push(sendServerChan(bowl.notify_serverchan.trim(), subject, text));
  if (bowl.notify_telegram && env.TELEGRAM_BOT_TOKEN) {
    tasks.push(sendTelegram(env.TELEGRAM_BOT_TOKEN, bowl.notify_telegram.trim(), text));
  }

  // —— 海外常用 ——
  if (bowl.notify_discord) tasks.push(sendDiscord(bowl.notify_discord, text));
  if (bowl.notify_slack) tasks.push(sendSlack(bowl.notify_slack, text));
  if (bowl.notify_ntfy) {
    tasks.push(sendNtfy(env.NTFY_API || NTFY_DEFAULT, bowl.notify_ntfy.trim(), subject, text, host, bowl.slug));
  }
  if (bowl.notify_pushover_user && bowl.notify_pushover_token) {
    tasks.push(sendPushover(bowl.notify_pushover_user.trim(), bowl.notify_pushover_token.trim(), subject, text));
  }
  if (bowl.notify_webhook_url) {
    tasks.push(sendGenericWebhook(bowl.notify_webhook_url, bowl, donation, subject, text, host));
  }

  // —— 邮件：碗主人自配 HTTP 邮件 API（Resend 兼容），平台零额度 ——
  if (bowl.notify_email && bowl.email_api_url && bowl.email_api_key) {
    tasks.push(sendEmail(bowl, subject, text, locale));
  }

  if (tasks.length) ctx.waitUntil(Promise.allSettled(tasks));
}

// ---------------- 各渠道实现 ----------------

async function sendWecom(webhook, text) {
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text } }),
  });
}

async function sendTelegram(token, chatId, text) {
  await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

async function sendServerChan(sendKey, title, text) {
  await fetch(`${SERVERCHAN_API}/${sendKey}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ title: title || text.split("\n")[0], desp: text }),
  });
}

// Discord：content 有 2000 字符上限，做个兜底截断
async function sendDiscord(webhook, text) {
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900) }),
  });
}

async function sendSlack(webhook, text) {
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

// ntfy：POST 纯文本，用 Header 带标题和点击跳转
async function sendNtfy(base, topic, title, text, host, slug) {
  await fetch(`${base}/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: { Title: title, Click: `https://${host}/${slug}` },
    body: text,
  });
}

async function sendPushover(user, token, title, text) {
  await fetch(PUSHOVER_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, user, title, message: text }),
  });
}

// 通用 Webhook：给用户自己的 Zapier / Make / n8n / 自建服务，带结构化 payload
async function sendGenericWebhook(url, bowl, donation, subject, text, host) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "donation.created",
      subject,
      text,
      bowl: {
        slug: bowl.slug,
        title: bowl.title,
        currency: bowl.currency || "CNY",
        url: `https://${host}/${bowl.slug}`,
      },
      donation: {
        nickname: donation.isAnonymous ? null : donation.nickname || null,
        isAnonymous: !!donation.isAnonymous,
        amountMinor: donation.amountMinor ?? null,
        currency: bowl.currency || "CNY",
        message: donation.message || "",
        paymentMethod: donation.paymentMethod || null,
        autoApproved: !!donation.autoApproved,
      },
    }),
  });
}

async function sendEmail(bowl, subject, text, locale) {
  await fetch(bowl.email_api_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bowl.email_api_key}`,
    },
    body: JSON.stringify({
      from: bowl.email_from || t(locale, "notify.emailFrom"),
      to: [bowl.notify_email.trim()],
      subject,
      text,
    }),
  });
}
