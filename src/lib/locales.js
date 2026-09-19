// 服务端文案包：Worker 侧用到的全部可翻译字符串
// 只放「服务端需要」的文案（API 报错、通知正文、OG 图文案、OG meta），
// 前端页面文案放在 static/i18n/*.json，两边互不干扰。
//
// 加语言：复制 en 的结构改一份，再在 SUPPORTED 里登记即可。

export const DEFAULT_LOCALE = "en"; // 面向海外用户，默认英文
export const SUPPORTED_LOCALES = ["en", "zh"];

const zh = {
  // ---- API 报错（fail 的 message）----
  err: {
    badJson: "请求格式有点问题，再试一哈。",
    turnstileFailed: "人机验证没过，刷新一下再来。",
    turnstileMissing: "请先完成人机验证。",
    bowlNotFound: "找不到这个饭碗儿，可能被端走了。",
    slugTaken: "这个地址后缀已经有人用了，换一个嘛。",
    slugReserved: "这个后缀是系统留起的，换一个嘛。",
    badAmount: "你这个金额有点不对头哈。",
    amountTooBig: "金额超上限了，胃口莫太大。",
    amountBelowRaised: "目标不能低于已经收到的，改成更大的嘛。",
    badPaymentMethod: "收款方式不对头。",
    badPaypal: "PayPal 链接或邮箱填得不对。",
    badBep20: "BEP20 地址不对，0x 开头 42 位。",
    badErc20: "ERC20 地址不对，0x 开头 42 位。",
    badBtc: "BTC 地址不对，看清楚再填。",
    badSol: "SOL 地址不对，看清楚再填。",
    badWecom: "企业微信 Webhook 地址不对。",
    badTelegram: "Telegram chat_id 不对，是纯数字。",
    badServerchan: "Server酱 SendKey 不对。",
    badDiscord: "Discord Webhook 地址不对。",
    badSlack: "Slack Webhook 地址不对。",
    badEmail: "邮箱地址不对。",
    badEmailApiUrl: "邮件 API 地址不对，要 https 开头。",
    badEmailApiKey: "邮件 API Key 不对。",
    badEmailFrom: "发件人格式不对。",
    badImage: "图片地址不对头。",
    badUploadType: "只收 jpg / png / webp 图片。",
    uploadTooBig: "图片太大了，压一下再传。",
    uploadFailed: "图片上传失败，再试一哈。",
    dailyLimit: "今天你已经摆过一个饭碗儿了，明天再来嘛。",
    unauthorized: "钥匙不对，进不去。",
    rateLimited: "手速太快了，歇一哈再来。",
    serverError: "服务器打了个嗝，等会儿再来。",
    missingField: "还有必填的没填。",
    badSlug: "地址后缀只能是 3-20 位小写英文、数字、短横杠。",
    bowlClosed: "这个饭碗儿已经收摊了，投不得喽。",
    pickPayment: "啷个投的选一个嘛。",
    donationNotFound: "这笔投喂没找到。",
    donationGone: "这口饭已经被端走了，撤不脱喽。",
    notYours: "这不是你投的那口。",
    notYourBowl: "这个饭碗儿不是你的哈。",
    badDonationId: "id 没传对头。",
    titleRequired: "饭碗儿总得喊个啥子嘛。",
    reasonRequired: "为啥子要吃，总要说两句嘛。",
    nicknameRequired: "叫啥子嘛，总得留个名字。",
    createFailed: "饭碗儿没摆稳，再整一哈嘛。",
    qrInvalid: "收款码图片没传对头。",
    editNotAllowed: "这个饭碗儿已经收摊了，改不得喽。",
  },

  // ---- 通知正文 ----
  notify: {
    title: "🍚 有人在你碗儿头留言了！",
    anonymous: "一个匿名耿直人",
    anonymousFallback: "路过滴耿直人",
    noMessage: "（没说啥子，就是投了一口）",
    said: "说",
    amount: "金额",
    goApprove: "快去放行",
    emailSubject: "🍚 有人在你碗儿头留言了！",
    emailFrom: "饭碗儿 <onboarding@resend.dev>",
    autoNote: "（这笔已经直接上墙了，你要是觉得不对头，进碗里把他拒了就是）",
    pendingNote: "（还没上墙，等你放行）",
  },

  // ---- OG 分享图 ----
  og: {
    brand: "饭碗儿",
    fallbackTitle: "今天想吃口饭",
    statusDone: "吃饱喽！收碗！",
    statusOpen: "还在讨生活",
    state0: "还没吃上一口",
    state30: "开始有饭了",
    state60: "饭有着落了",
    state90: "差最后一口",
    state100: "吃饱喽！",
    metaDesc: (nick, state, cur, goal, pct) =>
      `${nick}摆的饭碗儿，哪个来投喂一口 · ${state}（${cur} / ${goal}，${pct}%）`,
  },
};

const en = {
  err: {
    badJson: "Malformed request. Please try again.",
    turnstileFailed: "Human check failed. Refresh and try again.",
    turnstileMissing: "Please complete the human check first.",
    bowlNotFound: "We couldn't find that bowl. It may have been taken away.",
    slugTaken: "That URL handle is already taken. Pick another one.",
    slugReserved: "That handle is reserved by the system. Pick another one.",
    badAmount: "That amount doesn't look right.",
    amountTooBig: "That's above the limit. Try a smaller goal.",
    amountBelowRaised: "Your goal can't be lower than what you already received.",
    badPaymentMethod: "Unsupported payout method.",
    badPaypal: "That PayPal link or email doesn't look right.",
    badBep20: "Invalid BEP20 address — should start with 0x and be 42 characters.",
    badErc20: "Invalid ERC20 address — should start with 0x and be 42 characters.",
    badBtc: "Invalid BTC address. Double-check it.",
    badSol: "Invalid Solana address. Double-check it.",
    badWecom: "Invalid WeCom webhook URL.",
    badTelegram: "Invalid Telegram chat_id — it should be numeric.",
    badServerchan: "Invalid ServerChan SendKey.",
    badDiscord: "Invalid Discord webhook URL.",
    badSlack: "Invalid Slack webhook URL.",
    badEmail: "Invalid email address.",
    badEmailApiUrl: "Invalid email API URL — it must start with https.",
    badEmailApiKey: "Invalid email API key.",
    badEmailFrom: "Invalid sender format.",
    badImage: "Invalid image URL.",
    badUploadType: "Only jpg / png / webp images are accepted.",
    uploadTooBig: "That image is too large. Compress it and retry.",
    uploadFailed: "Upload failed. Please try again.",
    dailyLimit: "You already put out a bowl today. Come back tomorrow.",
    unauthorized: "Wrong key — access denied.",
    rateLimited: "Too many requests. Take a breath and retry.",
    serverError: "Something went wrong on our side. Try again shortly.",
    missingField: "Some required fields are still empty.",
    badSlug: "Handle must be 3-20 chars: lowercase letters, digits, or hyphens.",
    bowlClosed: "This request is already closed — you can't chip in.",
    pickPayment: "Pick how you paid.",
    donationNotFound: "We couldn't find that contribution.",
    donationGone: "It's already been settled — can't undo it now.",
    notYours: "That wasn't your contribution.",
    notYourBowl: "This request isn't yours.",
    badDonationId: "Invalid id.",
    titleRequired: "Your request needs a title.",
    reasonRequired: "Tell people why you need it.",
    nicknameRequired: "You need to leave a name.",
    createFailed: "Couldn't post your request. Try again.",
    qrInvalid: "That QR image URL is invalid.",
    editNotAllowed: "This request is closed — it can't be edited.",
  },

  notify: {
    title: "🍚 Someone just left a note on your bowl!",
    anonymous: "an anonymous supporter",
    anonymousFallback: "a passer-by",
    noMessage: "(no note — they just chipped in)",
    said: "said",
    amount: "Amount",
    goApprove: "Review it here",
    emailSubject: "🍚 Someone just left a note on your bowl!",
    emailFrom: "Fanwaner <onboarding@resend.dev>",
    autoNote: "(This one is already live — if it looks off, reject it from your page.)",
    pendingNote: "(Not live yet — waiting on your approval.)",
  },

  og: {
    brand: "Fanwaner",
    fallbackTitle: "Just trying to get a meal",
    statusDone: "Fully fed — bowl closed!",
    statusOpen: "Still hungry",
    state0: "Nothing yet",
    state30: "Getting there",
    state60: "More than halfway",
    state90: "Almost full",
    state100: "Full!",
    metaDesc: (nick, state, cur, goal, pct) =>
      `${nick} put out a bowl — chip in if you can · ${state} (${cur} / ${goal}, ${pct}%)`,
  },
};

export const LOCALES = { zh, en };

// 按语言取整包，取不到就回落到默认语言
export function localePack(locale) {
  return LOCALES[locale] || LOCALES[DEFAULT_LOCALE];
}
