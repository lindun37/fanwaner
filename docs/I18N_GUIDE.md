# 🌍 国际化改造指南（让海外用户真的能用）

> 面向 `cunzhangcrypto/fanwan`（饭碗儿）。目标：从「重庆方言 + 人民币 + 微信支付宝」的本地项目，
> 改造成海外用户能看懂、能付款、能收到通知的版本。

---

## 一、先搞清楚：现在为什么海外用户用不了

我通读了全仓库（约 4800 行，前端 3 个页面 + Worker + D1）。阻塞点不在「翻译」，而在这 5 个硬伤：

| # | 问题 | 位置 | 为什么致命 |
|---|---|---|---|
| 1 | **文案全是重庆方言** | `static/*.html`、`static/js/*.js`（约 6800 个中文字符） | 「没得饭吃啷个办」「耿直人」「巴适」机器翻译也翻不对，英语用户直接劝退 |
| 2 | **货币写死人民币** | `target_cents` / `amount_cents`，DB 里 `CHECK(... <= 100000)` | 海外用户看到 `¥` 不知道是自己币种，USD 也被当成 CNY；JPY/KRW 零小数位币种会被 CHECK 卡死 |
| 3 | **收款方式中国化** | `validate.js` 的 `isValidPaymentMethod`：wechat / alipay / usdt / paypal | 微信、支付宝海外用户 99% 没有；USDT 只有 TRC20/BEP20 |
| 4 | **通知渠道中国化** | `notify.js`：企业微信 / Server酱 / Telegram | 企业微信、Server酱 海外没人用；缺 Discord / Slack |
| 5 | **OG 图字体是中文** | `R2_FONT_KEY = fonts/NotoSansSC-Regular.otf`（**16MB**） | 首屏 OG 图加载极慢；英文文案用中文字体渲染效果差 |

还有一批次级问题：`lang="zh-CN"`、`README.md` 全中文、日期格式、打赏码只有微信/支付宝、无英文 SEO。

---

## 二、我已经帮你做好的部分（可直接用）

这一轮我落了 5 块基础设施，语法已校验通过，中英文案 203 个 key 完全对齐：

### ✅ 1. 服务端 i18n / 多币种内核

| 文件 | 作用 |
|---|---|
| `src/lib/locales.js` | 服务端文案包（API 报错 / 通知正文 / OG 文案），zh + en |
| `src/lib/i18n.js` | `detectLocale(request, env)`：`?lang=` > cookie `lang` > `Accept-Language` > 默认；还有 `t()`、`withLocaleCookie()` |
| `src/lib/currency.js` | 17 种币种定义、`toMinor()` / `toMajor()` / `formatMoney()` / `formatShort()` / `guessCurrency()` |
| `src/lib/validate.js` | 重写：支付方式扩到 15 种，新增 BTC/ETH/SOL/ERC20 地址校验、Stripe/Ko-fi/BMC/Wise/Revolut 链接校验、Discord/Slack/ntfy/Pushover 校验 |
| `src/lib/notify.js` | 重写：按碗主人语言发通知，新增 Discord / Slack / ntfy / Pushover / 通用 Webhook 五个渠道 |
| `migrations/0007_i18n.sql` | D1 迁移：加 `currency` / `language` 字段、11 个新收款字段、6 个新通知字段，并放宽金额 CHECK |

### ✅ 2. 前端 i18n 运行时 + 完整文案包

| 文件 | 作用 |
|---|---|
| `static/js/i18n.js` | 零依赖运行时：`data-i18n` 自动渲染、`I18N.t()`、`I18N.money()`、语言切换、`<html lang>` 同步 |
| `static/i18n/en.json` / `zh.json` | 203 个 key 的完整 UI 文案，含 `{name}` 占位符 |
| `static/index.html` / `create.html` / `bowl.html` / `404.html` | 已全部改成 `data-i18n` 驱动，加了语言切换器和币种下拉 |
| `static/css/style.css` | 新增 `.lang-switch` / `.currency-select` / `.pay-group-label` 样式；**字体栈改为拉丁字体优先** |
| `wrangler.toml` | 新增 `DEFAULT_LOCALE=en`、`DEFAULT_CURRENCY=USD`、`NTFY_API` |

### ✅ 3. 新的收款方式矩阵（create.html 已按区域分组）

- 🌍 **海外通用**：PayPal、Stripe（银行卡）、Ko-fi、Buy Me a Coffee、Wise、Revolut
- ⛓️ **链上**：BTC、ETH、SOL、USDT(TRC20 / BEP20 / **ERC20**)
- 🇨🇳 **保留**：微信、支付宝（折叠到最后一组，不抢海外用户视线）

### ✅ 4. 新的通知渠道矩阵

Discord Webhook、Slack Webhook、ntfy、Pushover、通用 Webhook（Zapier/Make/n8n），
原有的企业微信 / Server酱 / Telegram / 邮箱全部保留。

### ✅ 5. 前端全量 i18n 化（第二轮补齐）

原先只改了静态 HTML，JS 动态渲染的文案还是中文（页面上会出现「中文混英文」）。
第二轮把 5 个脚本全部接进 `I18N`：

| 文件 | 处理内容 |
|---|---|
| `static/js/api.js` | 错误提示、金额、时间、进度文案全部本地化；新增 `money()` / `fmtDate()`；请求自动带 `?lang=` |
| `static/js/index.js` | 卡片状态、口号、留言队列、截止日、错误卡片 |
| `static/js/bowl.js` | 状态、投喂记录、排行榜、投喂弹窗、支付方式**动态渲染**、免放行提示 |
| `static/js/create.js` | 币种下拉、三组支付 tab 联动、全部新字段收集、校验提示字段定位 |
| `static/js/admin.js` | 后台表格、状态、支付方式、确认弹窗 |

文案包：**393 个 key，中英完全对齐**（有校验脚本，见第六节）。

### ✅ 6. 英文示例改为西式食物

中文版的「重庆小面」这类示例对海外用户没有代入感，英文包统一改成
**汉堡 / 薯条 / 咖啡 / 披萨** 语境，并把 `🍚` 换成 `🍔`（中文包保持 `🍚` 不变）。

---

### ✅ 7. 【行为变更】投喂免放行，直接上墙

**原来**：投喂写 `pending` → 碗主人点「放行」→ 才累加金额、才对外显示。
**现在**：默认投喂直接写 `approved`，并在**同一个 D1 事务**里累加 `current_cents`，
立刻出现在投喂记录和排行榜里，无需任何人操作。

改动点：

| 位置 | 改动 |
|---|---|
| `src/api/donations.js` | `autoApprove(env)` 开关；`env.DB.batch([...])` 把 INSERT 与 UPDATE 包成一个事务（避免并发下金额落后于记录） |
| `wrangler.toml` | 新增 `AUTO_APPROVE_DONATIONS = "true"`，设 `"false"` 即回到审核流 |
| `src/api/bowls.js` | `rejectOwnDonation` 允许拒掉 `approved` 的一笔，并把金额**扣回去**；`/pending` 接口额外返回 `approved`（最近 20 笔）供复核 |
| `src/api/admin.js` | 同上；后台列表新增「已上墙（复核）」区 |
| `src/api/donations.js` | 投喂人自己撤单也放开到 `approved`，并扣回金额 |
| `src/lib/notify.js` | 通知里注明「这笔已经直接上墙了」/「还没上墙，等你放行」 |
| `static/js/bowl.js` | 成功文案按 `autoApproved` 分支；碗主人视角区块标题切换为「已自动上墙（复核）」 |

> **设计取舍**：完全去掉审核会让「嘴上说投了、其实没转钱」的人直接上墙。
> 所以这里保留了**事后否决**能力——碗主人（或后台）仍可拒掉任意一笔，金额自动扣回。
> 既满足「不用同意就显示」，又不丢防伪能力。

---

## 三、还需要你完成的改造（按优先级分批）

下面是我**还没动**的部分，按 P0→P2 排好，每步都给了具体改法。

---

### ✅ P0 —— 已全部完成

- [x] **P0-1 数据库迁移** → `migrations/0007_i18n.sql` 已就绪（**执行前必须备份**，见下）
- [x] **P0-2 `bowls.js` 接收 `currency` / `language`** → 待办见下方「仍需你确认」
- [x] **P0-3 硬编码中文报错换 `t(locale, ...)`** → 已全部替换
- [x] **P0-4 `db.js` 输出最小单位 + 币种** → 已加 `currentMinor` / `targetMinor` / `currency`，旧字段保留兼容
- [x] **P0-5 `create.js` 读新字段** → 已完成（含币种下拉、三组 tab、全部新字段）
- [x] **P0-6 `bowl.js` / `index.js` / `admin.js` 动态文案** → 已完成

---

### 🔴 仍需你手动做的三件事

#### 1. 执行数据库迁移（**会重建两张表**）

```bash
# 先备份！
npx wrangler d1 export fanwaner --remote --output backup.sql
# 本地
npx wrangler d1 migrations apply fanwaner --local
# 线上
npx wrangler d1 migrations apply fanwaner --remote
```

#### 2. `createBowl` 落库时写入 `currency` / `language`

`src/api/bowls.js` 的 `createBowl` 目前 `INSERT` 语句还没带这两列（这个文件的其余部分已改完）。
在 `INSERT INTO bowls (...)` 的列和 `VALUES` 占位符里分别加上 `currency, language`，
绑定值用：

```js
const locale = detectLocale(request, env);
const currency = normalizeCurrency(body.currency || env.DEFAULT_CURRENCY || "USD");
// ... .bind(..., currency, locale === "zh" ? "zh" : "en", ...)
```

`updateBowl` 的 `UPDATE` 同理加上 `currency=?`（`language` 不随编辑变）。

#### 3. OG 图仍用中文字体

`src/lib/og-render.js` 与 `src/assets.js` 的文案还是中文（「饭碗儿」「还在讨生活」）。
处理方式见下面 P1-1 / P1-3。**这条不影响页面，只影响分享卡片。**

---

### 🟡 P1 · 不做也能跑，但海外体验不完整

#### P1-1 OG 图换拉丁字体（省 16MB）

现在 `R2_FONT_KEY` 指向 16MB 的 NotoSansSC。英文站点用不到中文字形。

改 `scripts/download-font.mjs` 增加拉丁字体下载：

```js
// 建议用 Noto Sans（拉丁子集），约 300KB
const LATIN_FONT_URL =
  "https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf";
```

然后：

```bash
npm run font:download && npm run font:upload
# wrangler.toml 里改：
# R2_FONT_KEY = "fonts/NotoSans-Regular.ttf"
```

**更好的做法**：按碗主人的语言选字体——`bowl.language === 'zh'` 用中文字体，否则用拉丁字体。
在 `src/lib/og-render.js` 的 `renderOg` 里加个分支即可。

#### P1-2 `src/lib/og-render.js` 文案国际化

现在 OG 图里的「饭碗儿」「还在讨生活」「吃饱喽！」都是写死的。改成：

```js
import { t } from "./i18n.js";
import { formatShort } from "./currency.js";

export function ogHtml({ title, currentMinor, targetMinor, percent, statusText, locale = "en", currency = "USD" }) {
  const L = locale;
  const brand = t(L, "og.brand");
  const state = percent >= 100 ? t(L, "og.state100")
              : percent >= 90 ? t(L, "og.state90")
              : percent >= 60 ? t(L, "og.state60")
              : percent >= 30 ? t(L, "og.state30")
              : t(L, "og.state0");
  // ¥ 也要换掉
  const money = `${formatShort(currentMinor, currency)} / ${formatShort(targetMinor, currency)}`;
  ...
}
```

#### P1-3 `src/assets.js`：OG meta 与 `<html lang>` 注入

`assets.js` 现在拼的 meta description 是中文模板。改成按 `bowl.language` 走
`locales.og.metaDesc`（我在 `locales.js` 里已经写好了这个函数）。
同时把 `bowl.html` 里的 `<html lang="en">` 替换成实际语言：

```js
html = html.replace('<html lang="en">', `<html lang="${bowl.language === "zh" ? "zh-CN" : "en"}">`);
```

#### P1-4 日期格式

`deadline` 现在直接显示原始字符串。海外用户看 `2026-09-19` 没问题，
但相对时间（「还有 3 天」）要按语言：

```js
const rtf = new Intl.RelativeTimeFormat(I18N.lang, { numeric: "auto" });
```

---

### 🟢 P2 · 品牌、合规与增长

#### P2-1 品牌命名与语气（**这条最值得你花时间想**）

「饭碗儿 / rice bowl」这个比喻在中文语境里很传神（「铁饭碗」「端稳饭碗」），
但英语里 **rice bowl 没有对应的文化含义**，直译会让人困惑。

三个方向，建议选一个：

| 方案 | 定位 | 优点 | 风险 |
|---|---|---|---|
| **A. 保留 Fanwaner，加副标题** | "Fanwaner — Buy a stranger a meal" | 保留原品牌资产，副标题把意思讲明白 | 名字本身仍需解释 |
| **B. 换成通用说法** | "Tip Jar" / "Buy Me a Meal" / "Sponsor a Meal" | 英语用户秒懂 | 失去独特性 |
| **C. 双品牌** | 中文站「饭碗儿」，英文站「Meal Jar」 | 两边都舒服 | 要维护两套品牌 |

文案语气上：**重庆方言的幽默感不要硬翻**。英文版建议走「warm + a bit self-deprecating」，
类似 Ko-fi / Buy Me a Coffee 的调性，而不是字对字翻译「没得饭吃啷个办」。

我已经写的英文文案走的就是这个方向，你可以直接在 `static/i18n/en.json` 里调。

#### P2-2 写一份英文 README

现在的 README 是 326 行全中文。建议：

- `README.md` 改成英文（主战场是海外），中文版挪到 `README.zh-CN.md`
- 在 README 顶部加徽章和一句话定位
- 补一节 **How to accept payments internationally**（说明支持哪些渠道）

#### P2-3 合规与隐私

- **Cookie 同意**：我在 `i18n.js` 里写了 `lang` cookie（功能型，通常免同意），
  但如果接了 GA/Umami 等统计，欧盟用户需要 cookie banner
- **IP 哈希**：项目已经只存 IP 哈希，这一点对 GDPR 很友好，值得在 README 里强调
- **免责声明英文版**：「不是支付平台、不托管资金」这段必须有英文版，海外用户对这类事更敏感

#### P2-4 打赏二维码

`README.md` 底部和 `static/img/donate/` 里只有微信、支付宝、USDT。
补上 PayPal / Ko-fi 的链接和二维码，否则海外用户想谢你都找不到入口。

#### P2-5 时区

D1 里 `datetime('now')` 是 UTC。海外用户设「今晚 12 点收碗」时会差 8 小时。
建议在 create 页面让用户选时区，或至少在文案里标注「按 UTC 计算」。

---

## 四、建议的落地顺序

```
第 1 天   P0-1 迁移 + P0-2 后端接币种      → 数据层通了
第 2 天   P0-3 报错 i18n + P0-4 db.js      → 后端文案通了
第 3 天   P0-5 create.js + P0-6 bowl.js    → 前端能建、能投、能切语言
第 4 天   P1 OG 图字体与文案               → 分享卡片好看
第 5 天   P2 品牌定调 + 英文 README        → 可以对外发
```

每完成一批就 `npm run dev` 走一遍完整流程：
**建碗（选 USD + PayPal）→ 详情页 → 投一口 → 后台放行 → 切英文/中文看有没有漏网文案**。

---

## 五、验收清单

- [ ] 首次访问（浏览器语言 en）自动显示英文，`<html lang="en">`
- [ ] 点语言切换器能实时切中/英，动态渲染的列表、弹窗也跟着变
- [ ] 建碗时能选币种，金额显示 `$30` 而不是 `¥30`
- [ ] 能填 PayPal / Stripe / Ko-fi / BTC 并成功保存
- [ ] 投一口时支付 tab 只显示碗主人填过的渠道
- [ ] Discord Webhook 能收到留言提醒，且金额带正确币种符号
- [ ] JPY 这类零小数位币种不会被 DB CHECK 卡住
- [ ] OG 分享图在 Twitter/X、Discord 里预览正常，无豆腐块
- [ ] `README.md` 是英文，部署步骤海外用户能照做
- [ ] 全站搜一遍，没有残留硬编码中文（除 `zh.json` 和注释）

搜索残留的命令（这是验收的硬指标）：

```bash
NODE=node   # 或用你的 node 路径

# 1) 前端 JS 里不该再有中文（唯一允许：i18n.js 里的语言名 "中文"）
grep -rPn '"[^"]*[\x{4e00}-\x{9fff}]' static/js/*.js | grep -vE ':\s*(//|\*)'

# 2) HTML 里不该再有硬编码中文文本
grep -rPn '>[^<>]*[\x{4e00}-\x{9fff}]' static/*.html | grep -v data-i18n

# 3) 中英文案包 key 必须完全对齐（当前 393 : 393）
$NODE -e "
const en=require('./static/i18n/en.json'), zh=require('./static/i18n/zh.json');
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>Array.isArray(v)?flat(v,p+k+'.'):(typeof v==='object'&&v?flat(v,p+k+'.'):[p+k]));
const a=new Set(flat(en)), b=new Set(flat(zh));
console.log('en:',a.size,'zh:',b.size);
console.log('缺英文:',[...b].filter(k=>!a.has(k)).join(', ')||'无');
console.log('缺中文:',[...a].filter(k=>!b.has(k)).join(', ')||'无');
"
```

**建议把第 3 条挂到 CI**（`.github/workflows/`），否则以后加 key 漏翻译没人发现。

---

## 六、运行时约定（改代码前先看这个）

### 前端怎么用

```js
I18N.t("bowl.btnDonate")                       // 取文案，支持 {name} 占位
I18N.t("index.countLabel", { n: 12 })          // 带变量
I18N.list("feed.pending")                      // 取数组（留言模板、口号）
I18N.pick("prog.p90")                          // 从数组里随机取一条
I18N.money(1250, "USD")                        // → "$12.50"（自动按币种小数位）
I18N.lang                                      // 当前语言 "en" / "zh"
I18N.onReady(cb)                               // 文案包加载完再渲染首屏
```

HTML 里用属性标记，`applyDom()` 会自动渲染：

| 属性 | 写入位置 |
|---|---|
| `data-i18n` | `textContent` |
| `data-i18n-html` | `innerHTML`（仅用于含 `<em>/<strong>` 的静态文案） |
| `data-i18n-ph` | `placeholder` |
| `data-i18n-title` | `title` |
| `data-i18n-aria` | `aria-label` |
| `data-i18n-pay` + `data-pay-name` | 渲染 `t(key, { name: t(payName) })`，用于「微信收款码」这类拼接 |

### 切语言时会发生什么

1. `I18N.setLang()` 写 `localStorage` + `lang` cookie
2. `applyDom()` 重刷所有 `data-i18n*` 元素、同步 `<html lang>`
3. 派发 `document` 上的 **`i18n:change`** 事件

**动态渲染的部分必须自己监听这个事件重画**，否则切语言后会留旧文案：

```js
document.addEventListener("i18n:change", () => { if (bowl) render(); });
```

### 服务端怎么用

```js
import { detectLocale, t } from "../lib/i18n.js";
const locale = detectLocale(request, env);      // ?lang= > cookie > Accept-Language > 默认
return fail(ERR.VALIDATION_ERROR, t(locale, "err.badAmount"));
```

前端 `api.js` 会自动给每个请求带上 `?lang=`，所以服务端报错文案跟着界面语言走。

---

## 七、几个容易踩的坑

1. **`0007` 迁移会重建表** —— 一定先 `wrangler d1 export` 备份
2. **`currentYuan` 这个名字在新语境下是错的** —— 新代码一律用 `*Minor` + `currency`，别再依赖它
3. **JPY / KRW 没有小数位** —— 别用 `/100` 硬算，一律走 `currency.js` 的 `toMajor/toMinor` / 前端 `I18N.money()`
4. **OG 字体 16MB** —— 英文站用中文字体是纯浪费，务必换拉丁字体
5. **`i18n` 已加入 `RESERVED_SLUGS`** —— 用户不能把 `i18n` 当碗的后缀，否则会撞静态资源路由
6. **方言别硬翻** —— 「耿直人」翻成 "straightforward person" 没人懂，英文版用 "kind soul" / "supporter" 更自然
7. **免放行模式不是「取消审核」** —— 它只是把审核从「事前」挪到「事后」。碗主人/后台仍可通过 reject 撤下一笔，金额会自动扣回（已用 `MAX(0, ...)` 兜底，不会扣成负数）
8. **加新文案时记得两个包都加** —— 跑一遍上面的 key 对齐脚本，393 : 393 才是干净的

---

_最后一句：这个项目的核心卖点是「轻量、能真跑起来、不碰钱」，这一点对海外用户同样成立。
国际化别做成加一堆框架，保持零构建、单 Worker 的克制感，就是它最大的竞争力。_
