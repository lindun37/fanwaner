-- 0007：国际化（i18n）改造
--  1) bowls / donations 增加 currency 字段（原项目写死人民币）
--  2) 放宽金额上限：原来的 CHECK(... <= 100000) 是按「人民币分」定的，
--     JPY / KRW 这类零小数位币种会被卡死，这里放宽到 100000000（最小单位）
--  3) 新增海外常用收款方式字段：Stripe / Ko-fi / Buy Me a Coffee / Wise / Revolut
--     / BTC / ETH(ERC20) / SOL / USDT-ERC20
--  4) 新增海外常用通知渠道字段：Discord / Slack / ntfy / Pushover / 通用 Webhook
--  5) bowls 记录创建时使用的界面语言，供通知与 OG 图复用
--
-- 注意：SQLite 无法修改既有 CHECK 约束，两张表都整体重建（数据原样搬）。
--      执行前建议先备份：wrangler d1 export fanwaner --remote

-- ============ 1. bowls ============

ALTER TABLE bowls ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE bowls ADD COLUMN language TEXT NOT NULL DEFAULT 'zh';

-- 海外收款方式（地址 / 链接类，二维码仍走原有的 *_qr 字段）
ALTER TABLE bowls ADD COLUMN stripe_url    TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN kofi_url      TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN bmc_url       TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN wise_email    TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN revolut_url   TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN btc_address   TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN eth_address   TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN sol_address   TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN usdt_erc20_address TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN usdt_erc20_qr      TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN btc_qr             TEXT NOT NULL DEFAULT '';

-- 海外通知渠道
ALTER TABLE bowls ADD COLUMN notify_discord   TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN notify_slack     TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN notify_ntfy      TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN notify_pushover_user  TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN notify_pushover_token TEXT NOT NULL DEFAULT '';
ALTER TABLE bowls ADD COLUMN notify_webhook_url    TEXT NOT NULL DEFAULT '';

-- 重建 bowls：去掉 target_cents <= 100000 的旧约束
CREATE TABLE bowls_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  user_id       INTEGER REFERENCES users(id),
  title         TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 50),
  want          TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  currency      TEXT NOT NULL DEFAULT 'CNY',
  language      TEXT NOT NULL DEFAULT 'zh',
  target_cents  INTEGER NOT NULL CHECK(target_cents > 0 AND target_cents <= 100000000),
  current_cents INTEGER NOT NULL DEFAULT 0 CHECK(current_cents >= 0),
  deadline      TEXT,
  wechat_qr     TEXT NOT NULL DEFAULT '',
  alipay_qr     TEXT NOT NULL DEFAULT '',
  usdt_address      TEXT NOT NULL DEFAULT '',
  usdt_qr           TEXT NOT NULL DEFAULT '',
  usdt_bep20_address TEXT NOT NULL DEFAULT '',
  usdt_bep20_qr      TEXT NOT NULL DEFAULT '',
  usdt_erc20_address TEXT NOT NULL DEFAULT '',
  usdt_erc20_qr      TEXT NOT NULL DEFAULT '',
  btc_address        TEXT NOT NULL DEFAULT '',
  btc_qr             TEXT NOT NULL DEFAULT '',
  eth_address        TEXT NOT NULL DEFAULT '',
  sol_address        TEXT NOT NULL DEFAULT '',
  stripe_url         TEXT NOT NULL DEFAULT '',
  kofi_url           TEXT NOT NULL DEFAULT '',
  bmc_url            TEXT NOT NULL DEFAULT '',
  wise_email         TEXT NOT NULL DEFAULT '',
  revolut_url        TEXT NOT NULL DEFAULT '',
  paypal_link        TEXT NOT NULL DEFAULT '',
  paypal_qr          TEXT NOT NULL DEFAULT '',
  notify_wecom       TEXT NOT NULL DEFAULT '',
  notify_telegram    TEXT NOT NULL DEFAULT '',
  notify_serverchan  TEXT NOT NULL DEFAULT '',
  notify_email       TEXT NOT NULL DEFAULT '',
  notify_discord     TEXT NOT NULL DEFAULT '',
  notify_slack       TEXT NOT NULL DEFAULT '',
  notify_ntfy        TEXT NOT NULL DEFAULT '',
  notify_pushover_user  TEXT NOT NULL DEFAULT '',
  notify_pushover_token TEXT NOT NULL DEFAULT '',
  notify_webhook_url    TEXT NOT NULL DEFAULT '',
  email_api_url      TEXT NOT NULL DEFAULT '',
  email_api_key      TEXT NOT NULL DEFAULT '',
  email_from         TEXT NOT NULL DEFAULT '',
  nickname          TEXT NOT NULL DEFAULT '',
  avatar_url        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','completed','expired','hidden')),
  edit_token        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO bowls_new (
  id, slug, user_id, title, want, reason, currency, language,
  target_cents, current_cents, deadline,
  wechat_qr, alipay_qr,
  usdt_address, usdt_qr, usdt_bep20_address, usdt_bep20_qr,
  usdt_erc20_address, usdt_erc20_qr, btc_address, btc_qr,
  eth_address, sol_address,
  stripe_url, kofi_url, bmc_url, wise_email, revolut_url,
  paypal_link, paypal_qr,
  notify_wecom, notify_telegram, notify_serverchan, notify_email,
  notify_discord, notify_slack, notify_ntfy,
  notify_pushover_user, notify_pushover_token, notify_webhook_url,
  email_api_url, email_api_key, email_from,
  nickname, avatar_url, status, edit_token, created_at, updated_at
)
SELECT
  id, slug, user_id, title, want, reason, currency, language,
  target_cents, current_cents, deadline,
  wechat_qr, alipay_qr,
  usdt_address, usdt_qr, usdt_bep20_address, usdt_bep20_qr,
  usdt_erc20_address, usdt_erc20_qr, btc_address, btc_qr,
  eth_address, sol_address,
  stripe_url, kofi_url, bmc_url, wise_email, revolut_url,
  paypal_link, paypal_qr,
  notify_wecom, notify_telegram, notify_serverchan, notify_email,
  notify_discord, notify_slack, notify_ntfy,
  notify_pushover_user, notify_pushover_token, notify_webhook_url,
  email_api_url, email_api_key, email_from,
  nickname, avatar_url, status, edit_token, created_at, updated_at
FROM bowls;

DROP TABLE bowls;
ALTER TABLE bowls_new RENAME TO bowls;

CREATE INDEX idx_bowls_status_created ON bowls(status, created_at DESC);
CREATE INDEX idx_bowls_hot ON bowls(current_cents DESC);
CREATE INDEX idx_bowls_currency ON bowls(currency);

-- ============ 2. donations ============

ALTER TABLE donations ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';

CREATE TABLE donations_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bowl_id        INTEGER NOT NULL REFERENCES bowls(id) ON DELETE CASCADE,
  nickname       TEXT NOT NULL DEFAULT '',
  amount_cents   INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 100000000),
  currency       TEXT NOT NULL DEFAULT 'CNY',
  message        TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK(payment_method IN (
    'wechat','alipay','usdt','usdt_bep20','usdt_erc20','paypal',
    'stripe','kofi','buymeacoffee','wise','revolut','btc','eth','sol','other'
  )),
  txid           TEXT NOT NULL DEFAULT '',
  is_anonymous   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending','approved','rejected')),
  ip_hash        TEXT NOT NULL DEFAULT '',
  delete_token   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT
);

INSERT INTO donations_new (
  id, bowl_id, nickname, amount_cents, currency, message,
  payment_method, txid, is_anonymous, status, ip_hash, delete_token,
  created_at, approved_at
)
SELECT
  id, bowl_id, nickname, amount_cents, currency, message,
  payment_method, txid, is_anonymous, status, ip_hash, delete_token,
  created_at, approved_at
FROM donations;

DROP TABLE donations;
ALTER TABLE donations_new RENAME TO donations;

CREATE INDEX idx_donations_bowl ON donations(bowl_id, status, created_at DESC);
CREATE INDEX idx_donations_pending ON donations(status, created_at) WHERE status = 'pending';
