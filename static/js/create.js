/* 🍔 饭碗儿 / Fanwaner —— 摆个饭碗 / 发布求助 */
(() => {
  const { $, $$, post, put, get, upload, toast, alertCenter, T } = FW;

  /* ---------- 所有收款方式 → 面板 id / 字段 ---------- */
  // 三组 tab 互斥：海外通用 / 链上 / 中国
  const PAY_GROUPS = [
    { el: "#pay-tabs", methods: ["paypal", "stripe", "kofi", "buymeacoffee", "wise", "revolut"] },
    { el: "#pay-tabs-crypto", methods: ["btc", "eth", "sol", "usdt", "usdt_bep20", "usdt_erc20"] },
    { el: "#pay-tabs-cn", methods: ["wechat", "alipay"] },
  ];
  const ALL_METHODS = PAY_GROUPS.flatMap((g) => g.methods);
  const panelId = (m) => "#pay-" + m;

  // 收款方式 → 二维码上传 key / 地址字段 id / 链接字段 id
  const QR_KEY = {
    wechat: "wechat_qr", alipay: "alipay_qr", usdt: "usdt_qr", usdt_bep20: "usdt_bep20_qr",
    usdt_erc20: "usdt_erc20_qr", btc: "btc_qr", paypal: "paypal_qr",
  };
  const ADDR_FIELD = {
    usdt: "#usdtAddress", usdt_bep20: "#usdtBep20Address", usdt_erc20: "#usdtErc20Address",
    btc: "#btcAddress", eth: "#ethAddress", sol: "#solAddress",
  };
  const LINK_FIELD = {
    paypal: "#paypalLink", stripe: "#stripeUrl", kofi: "#kofiUrl",
    buymeacoffee: "#bmcUrl", wise: "#wiseEmail", revolut: "#revolutUrl",
  };

  let payMethod = "paypal";
  let maxAmount = 1000;

  /* ---------- 币种下拉 ---------- */
  const CURRENCY_FALLBACK = ["USD", "EUR", "GBP", "CNY", "JPY", "KRW", "HKD", "TWD", "SGD", "AUD", "CAD", "INR", "BRL", "CHF"];
  async function initCurrencies() {
    let codes = CURRENCY_FALLBACK;
    let def = "USD";
    try {
      const cfg = await get("/api/config");
      if (Array.isArray(cfg.currencies) && cfg.currencies.length) codes = cfg.currencies;
      if (cfg.defaultCurrency) def = cfg.defaultCurrency;
      if (cfg.maxAmountYuan) maxAmount = cfg.maxAmountYuan;
    } catch { /* 拿不到就用兜底 */ }
    const sel = $("#currency");
    sel.innerHTML = codes.map((c) => `<option value="${c}">${c}</option>`).join("");
    sel.value = codes.includes(def) ? def : codes[0];
    return codes;
  }

  /* ---------- 编辑模式 ---------- */
  const params = new URLSearchParams(location.search);
  const editSlug = params.get("edit");
  const editToken = params.get("token") || "";
  let editBowl = null;
  const uploads = {
    avatar: "", wechat_qr: "", alipay_qr: "", usdt_qr: "", usdt_bep20_qr: "",
    usdt_erc20_qr: "", btc_qr: "", paypal_qr: "",
  };

  async function initEdit() {
    if (!editSlug || !editToken) return;
    try {
      // 后缀摆起就定死了，改不得（链接都散出去了）
      $("#slug-field").classList.add("hidden");
      const data = await get(`/api/bowl/${editSlug}`);
      editBowl = data.bowl;
      $("#title").value = editBowl.title;
      $("#want").value = editBowl.want;
      $("#reason").value = editBowl.reason;
      $("#nickname").value = editBowl.nickname;
      $("#currency").value = editBowl.currency || $("#currency").value;
      // 金额按币种主单位回显（JPY 等零小数位币种不能简单 /100，统一走 I18N）
      const exp = FW.exponentOf(editBowl.currency);
      $("#targetAmount").value =
        editBowl.targetMinor != null
          ? FW.toMajor(editBowl.targetMinor, editBowl.currency).toFixed(exp)
          : (editBowl.targetYuan || "");
      if (editBowl.deadline) {
        const d = new Date(editBowl.deadline);
        const p = (x) => String(x).padStart(2, "0");
        $("#deadline").value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }
      // 收款方式
      const addrMap = { usdtAddress: editBowl.usdtAddress, usdtBep20Address: editBowl.usdtBep20Address, usdtErc20Address: editBowl.usdtErc20Address, btcAddress: editBowl.btcAddress, ethAddress: editBowl.ethAddress, solAddress: editBowl.solAddress, paypalLink: editBowl.paypalLink, stripeUrl: editBowl.stripeUrl, kofiUrl: editBowl.kofiUrl, bmcUrl: editBowl.bmcUrl, wiseEmail: editBowl.wiseEmail, revolutUrl: editBowl.revolutUrl };
      Object.entries(addrMap).forEach(([id, v]) => { const el = $("#" + id); if (el && v) el.value = v; });
      // 通知渠道
      const notifyMap = { notifyWecom: editBowl.notifyWecom, notifyTelegram: editBowl.notifyTelegram, notifyServerchan: editBowl.notifyServerchan, notifyEmail: editBowl.notifyEmail, notifyDiscord: editBowl.notifyDiscord, notifySlack: editBowl.notifySlack, notifyNtfy: editBowl.notifyNtfy, notifyPushoverUser: editBowl.notifyPushoverUser, notifyWebhook: editBowl.notifyWebhook, emailApiUrl: editBowl.emailApiUrl, emailFrom: editBowl.emailFrom };
      Object.entries(notifyMap).forEach(([id, v]) => { const el = $("#" + id); if (el && v) el.value = v; });
      // API Key 是敏感信息，不回显；不填就保留原来的

      $("#title-count").textContent = editBowl.title.length;
      $("#want-count").textContent = editBowl.want.length;
      $("#reason-count").textContent = editBowl.reason.length;

      $("#submit").textContent = T("create.editSubmit");
      document.querySelector(".card-panel h2").textContent = T("create.editHeading");
      const lead = document.querySelector(".card-panel .lead");
      lead.textContent = T("create.editLead");

      const jump = document.createElement("a");
      jump.className = "btn btn-sm btn-ghost";
      jump.style.marginTop = "10px";
      jump.href = `/${editSlug}?token=${encodeURIComponent(editToken)}`;
      jump.textContent = T("create.editJump");
      lead.after(jump);

      if (editBowl.currentMinor > 0) {
        $("#targetAmount").setAttribute("min", FW.toMajor(editBowl.currentMinor, editBowl.currency));
        const hint = document.createElement("small");
        hint.className = "hint";
        hint.textContent = T("create.editMinHint", { amount: FW.money(editBowl.currentMinor, editBowl.currency) });
        $("label[for='targetAmount']").appendChild(hint);
      }

      // 回显已有的收款图 / 头像
      const fieldOf = { wechat_qr: "wechatQr", alipay_qr: "alipayQr", usdt_qr: "usdtQr", usdt_bep20_qr: "usdtBep20Qr", usdt_erc20_qr: "usdtErc20Qr", btc_qr: "btcQr", paypal_qr: "paypalQr", avatar: "avatarUrl" };
      Object.entries(fieldOf).forEach(([k, field]) => {
        const url = editBowl[field];
        if (!url) return;
        uploads[k] = url;
        const box = document.querySelector(`.upload-box[data-upload="${k}"]`);
        if (!box) return;
        const thumb = box.querySelector("[data-thumb]");
        if (thumb) {
          thumb.innerHTML = "";
          const img = document.createElement("img");
          img.src = url;
          img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:8px;";
          thumb.appendChild(img);
        }
      });
    } catch (e) {
      toast(e.message || T("create.editLoadFailed"));
    }
  }

  /* ---------- 字符计数 ---------- */
  [["#title", "#title-count"], ["#want", "#want-count"], ["#reason", "#reason-count"]].forEach(([input, out]) => {
    $(input).addEventListener("input", () => { $(out).textContent = $(input).value.length; });
  });

  /* ---------- 收款方式切换（三组 tab 互斥） ---------- */
  function showPayPanel(m) {
    ALL_METHODS.forEach((k) => {
      const el = $(panelId(k));
      if (el) el.classList.toggle("hidden", k !== m);
    });
    $$(".pay-tab").forEach((t) => t.classList.toggle("active", t.dataset.pay === m));
  }

  function bindPayTabs() {
    $$(".pay-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        payMethod = tab.dataset.pay;
        showPayPanel(payMethod);
      });
    });
  }

  /* ---------- 图片上传 ---------- */
  async function prepareImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const { width, height } = bmp;
      if (Math.min(width, height) < 300) toast(T("create.imgTooSmall"));
      const scale = Math.min(1, 1500 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return (await new Promise((r) => canvas.toBlob(r, "image/webp", 0.9))) || file;
    } catch {
      return file;
    }
  }

  $$(".upload-box").forEach((box) => {
    const input = box.querySelector('input[type="file"]');
    box.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const kind = box.dataset.upload;
      box.style.opacity = "0.6";
      try {
        const prepared = await prepareImage(file);
        const data = await upload(`/api/upload?kind=${kind}`, prepared);
        uploads[kind] = data.url;
        const thumb = box.querySelector("[data-thumb]");
        thumb.innerHTML = "";
        const img = document.createElement("img");
        img.src = data.url;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:8px;";
        thumb.appendChild(img);
        toast(T("create.imgUploaded"));
      } catch (e) {
        toast(e.message || T("create.imgUploadFailed"));
      } finally {
        box.style.opacity = "1";
      }
    });
  });

  /* ---------- Turnstile ---------- */
  let turnstileToken = "";
  let turnstileWidget = null;
  let turnstileSiteKey = "";
  let turnstileScriptReady = false;

  window.__turnstileOnload = () => {
    turnstileScriptReady = true;
    renderTurnstile();
  };

  function loadTurnstile(retries = 4) {
    return new Promise((resolve) => {
      if (turnstileScriptReady || typeof window.turnstile !== "undefined") return resolve(true);
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnload";
      s.async = true;
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      s.onload = () => finish(true);
      s.onerror = () => {
        if (retries > 0) setTimeout(() => loadTurnstile(retries - 1).then(finish), 800);
        else finish(false);
      };
      document.head.appendChild(s);
    });
  }

  async function fetchSiteKey() {
    for (let i = 0; i < 5 && !turnstileSiteKey; i++) {
      try {
        const cfg = await get("/api/config");
        turnstileSiteKey = cfg.turnstileSiteKey || "";
        if (cfg.maxAmountYuan) maxAmount = cfg.maxAmountYuan;
      } catch { /* 下次再试 */ }
      if (!turnstileSiteKey) await new Promise((r) => setTimeout(r, 400));
    }
  }

  function renderTurnstile() {
    if (turnstileWidget || !turnstileSiteKey || typeof window.turnstile === "undefined") return;
    turnstileWidget = window.turnstile.render($("#turnstile-wrap"), {
      sitekey: turnstileSiteKey,
      callback: (token) => { turnstileToken = token; },
      "error-callback": () => { turnstileToken = ""; },
      "expired-callback": () => { turnstileToken = ""; },
    });
  }

  async function ensureTurnstileToken(timeout = 8000) {
    if (turnstileToken) return turnstileToken;
    await fetchSiteKey();
    await loadTurnstile();
    renderTurnstile();
    if (turnstileToken) return turnstileToken;
    try { if (turnstileWidget) window.turnstile.execute(turnstileWidget); } catch { }
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (turnstileToken) { clearInterval(iv); resolve(turnstileToken); }
        else if (Date.now() - t0 >= timeout) { clearInterval(iv); resolve(""); }
      }, 150);
    });
  }

  /* ---------- 自定义后缀 ---------- */
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
  const slugInput = $("#slug");
  const slugPreview = $("#slug-preview");
  slugInput.addEventListener("input", () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20);
    const v = slugInput.value.trim();
    slugPreview.textContent = v ? `${location.origin}/${v}` : "";
  });

  /* ---------- 校验 ---------- */
  const RE = {
    hex40: /^0x[a-fA-F0-9]{40}$/,
    btc: /^([13][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[qzry9x8gf2tvdw0s3jn54khce6mua7l][a-z0-9]{20,87})$/,
    sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    paypal: /^(https?:\/\/[a-z0-9.-]*(?:paypal\.me|paypal\.com)[a-zA-Z0-9/._?&=%-]*|[^\s@]+@[^\s@]+\.[^\s@]{2,})$/i,
    stripe: /^https:\/\/[\w\-./?=&%]{4,200}$/,
    kofi: /^https?:\/\/(www\.)?ko-fi\.com\/[A-Za-z0-9_/-]{1,60}$/,
    bmc: /^https?:\/\/(www\.)?buymeacoffee\.com\/[A-Za-z0-9_/-]{1,60}$/,
    revolut: /^https?:\/\/(www\.)?revolut\.me\/[A-Za-z0-9_/-]{1,60}$/,
    wise: /^([^\s@]+@[^\s@]+\.[^\s@]{2,}|https?:\/\/wise\.com\/[\w\-./?=&%]{0,120})$/,
    wecom: /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]{1,80}$/,
    discord: /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}$/,
    slack: /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}$/,
    ntfy: /^[A-Za-z0-9_-]{1,64}$/,
    pushover: /^[A-Za-z0-9]{30}$/,
    telegram: /^-?\d{5,15}$/,
    serverchan: /^(SCT\d+[A-Za-z0-9]+|SCU\d{10,}[A-Za-z0-9]*)$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    emailApiUrl: /^https:\/\/[^\s]+\.[^\s]{2,}$/,
    emailFrom: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$|^.{1,60}\s*<[^\s@]+@[^\s@]+\.[^\s@]{2,}>$/,
  };

  // 返回 { key, el }：文案 key + 要高亮的字段
  function validate(v) {
    const val = (id) => (($(id) || {}).value || "").trim();
    if (!v.title) return { key: "create.errTitle", el: "#title" };
    if (!v.want) return { key: "create.errWant", el: "#want" };
    if (!v.reason) return { key: "create.errReason", el: "#reason" };
    if (!v.targetAmount || Number(v.targetAmount) <= 0) return { key: "create.errAmount", el: "#targetAmount" };
    if (Number(v.targetAmount) > maxAmount) return { key: "create.errAmountMax", el: "#targetAmount", vars: { max: maxAmount } };
    if (!v.nickname) return { key: "create.errNickname", el: "#nickname" };

    if (v.usdtBep20Address && !RE.hex40.test(v.usdtBep20Address)) return { key: "create.errBep20", el: "#usdtBep20Address" };
    if (v.usdtErc20Address && !RE.hex40.test(v.usdtErc20Address)) return { key: "create.errErc20", el: "#usdtErc20Address" };
    if (v.ethAddress && !RE.hex40.test(v.ethAddress)) return { key: "create.errErc20", el: "#ethAddress" };
    if (v.btcAddress && !RE.btc.test(v.btcAddress)) return { key: "create.errBtc", el: "#btcAddress" };
    if (v.solAddress && !RE.sol.test(v.solAddress)) return { key: "create.errSol", el: "#solAddress" };

    if (v.paypalLink && !RE.paypal.test(v.paypalLink)) return { key: "create.errPaypal", el: "#paypalLink" };
    if (v.stripeUrl && !RE.stripe.test(v.stripeUrl)) return { key: "create.errStripe", el: "#stripeUrl" };
    if (v.kofiUrl && !RE.kofi.test(v.kofiUrl)) return { key: "create.errKofi", el: "#kofiUrl" };
    if (v.bmcUrl && !RE.bmc.test(v.bmcUrl)) return { key: "create.errBmc", el: "#bmcUrl" };
    if (v.revolutUrl && !RE.revolut.test(v.revolutUrl)) return { key: "create.errRevolut", el: "#revolutUrl" };
    if (v.wiseEmail && !RE.wise.test(v.wiseEmail)) return { key: "create.errWise", el: "#wiseEmail" };

    if (v.notifyWecom && !RE.wecom.test(v.notifyWecom)) return { key: "create.errWecom", el: "#notifyWecom" };
    if (v.notifyDiscord && !RE.discord.test(v.notifyDiscord)) return { key: "create.errDiscord", el: "#notifyDiscord" };
    if (v.notifySlack && !RE.slack.test(v.notifySlack)) return { key: "create.errSlack", el: "#notifySlack" };
    if (v.notifyNtfy && !RE.ntfy.test(v.notifyNtfy)) return { key: "create.errNtfy", el: "#notifyNtfy" };
    if (v.notifyPushoverUser && !RE.pushover.test(v.notifyPushoverUser)) return { key: "create.errPushover", el: "#notifyPushoverUser" };
    if (v.notifyPushoverToken && !RE.pushover.test(v.notifyPushoverToken)) return { key: "create.errPushover", el: "#notifyPushoverToken" };
    if (v.notifyTelegram && !RE.telegram.test(v.notifyTelegram)) return { key: "create.errTelegram", el: "#notifyTelegram" };
    if (v.notifyServerchan && !RE.serverchan.test(v.notifyServerchan)) return { key: "create.errServerchan", el: "#notifyServerchan" };
    if (v.notifyEmail && !RE.email.test(v.notifyEmail)) return { key: "create.errEmail", el: "#notifyEmail" };
    if (v.emailApiUrl && !RE.emailApiUrl.test(v.emailApiUrl)) return { key: "create.errEmailApiUrl", el: "#emailApiUrl" };
    if (v.emailApiKey && v.emailApiKey.length < 6) return { key: "create.errEmailApiKey", el: "#emailApiKey" };
    if (v.emailFrom && !RE.emailFrom.test(v.emailFrom)) return { key: "create.errEmailFrom", el: "#emailFrom" };
    if (v.notifyWebhook && !RE.emailApiUrl.test(v.notifyWebhook)) return { key: "create.errEmailApiUrl", el: "#notifyWebhook" };

    if (v.slugVal && !SLUG_RE.test(v.slugVal)) return { key: "create.errSlug", el: "#slug" };
    return null;
  }

  function highlight(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("field-error");
    setTimeout(() => el.classList.remove("field-error"), 2200);
    const inp = el.querySelector ? el.querySelector("input, textarea") : null;
    if (inp) inp.focus({ preventScroll: true });
    else if (el.focus) el.focus({ preventScroll: true });
  }

  /* ---------- 提交 ---------- */
  const collect = () => {
    const v = (id) => (($(id) || {}).value || "").trim();
    return {
      title: v("#title"), want: v("#want"), reason: v("#reason"),
      targetAmount: $("#targetAmount").value,
      currency: $("#currency").value,
      deadline: v("#deadline") || null,
      nickname: v("#nickname"),
      slugVal: v("#slug").toLowerCase(),
      usdtAddress: v("#usdtAddress"), usdtBep20Address: v("#usdtBep20Address"), usdtErc20Address: v("#usdtErc20Address"),
      btcAddress: v("#btcAddress"), ethAddress: v("#ethAddress"), solAddress: v("#solAddress"),
      paypalLink: v("#paypalLink"), stripeUrl: v("#stripeUrl"), kofiUrl: v("#kofiUrl"),
      bmcUrl: v("#bmcUrl"), wiseEmail: v("#wiseEmail"), revolutUrl: v("#revolutUrl"),
      notifyWecom: v("#notifyWecom"), notifyTelegram: v("#notifyTelegram"), notifyServerchan: v("#notifyServerchan"),
      notifyEmail: v("#notifyEmail"), notifyDiscord: v("#notifyDiscord"), notifySlack: v("#notifySlack"),
      notifyNtfy: v("#notifyNtfy"), notifyPushoverUser: v("#notifyPushoverUser"),
      notifyPushoverToken: v("#notifyPushoverToken"), notifyWebhook: v("#notifyWebhook"),
      emailApiUrl: v("#emailApiUrl"), emailApiKey: v("#emailApiKey"), emailFrom: v("#emailFrom"),
    };
  };

  $("#submit").addEventListener("click", async () => {
    const errBox = $("#form-error");
    const btn = $("#submit");
    errBox.textContent = "";
    const isEdit = !!(editSlug && editToken);

    const v = collect();
    const bad = validate(v);
    if (bad) {
      errBox.textContent = T(bad.key, bad.vars);
      highlight($(bad.el));
      return;
    }

    btn.disabled = true;
    btn.textContent = T("create.submitting");

    const payload = {
      title: v.title, want: v.want, reason: v.reason,
      targetAmount: Number(v.targetAmount),
      currency: v.currency,
      // 记下摆碗时用的界面语言：通知正文和 OG 分享图都按它出文案
      language: FW.lang,
      deadline: v.deadline,
      nickname: v.nickname,
      avatarUrl: uploads.avatar || undefined,
      // 收款方式
      wechatQr: uploads.wechat_qr || undefined,
      alipayQr: uploads.alipay_qr || undefined,
      usdtQr: uploads.usdt_qr || undefined,
      usdtAddress: v.usdtAddress || undefined,
      usdtBep20Qr: uploads.usdt_bep20_qr || undefined,
      usdtBep20Address: v.usdtBep20Address || undefined,
      usdtErc20Qr: uploads.usdt_erc20_qr || undefined,
      usdtErc20Address: v.usdtErc20Address || undefined,
      btcQr: uploads.btc_qr || undefined,
      btcAddress: v.btcAddress || undefined,
      ethAddress: v.ethAddress || undefined,
      solAddress: v.solAddress || undefined,
      paypalLink: v.paypalLink || undefined,
      paypalQr: uploads.paypal_qr || undefined,
      stripeUrl: v.stripeUrl || undefined,
      kofiUrl: v.kofiUrl || undefined,
      bmcUrl: v.bmcUrl || undefined,
      wiseEmail: v.wiseEmail || undefined,
      revolutUrl: v.revolutUrl || undefined,
      // 通知渠道
      notifyWecom: v.notifyWecom || undefined,
      notifyTelegram: v.notifyTelegram || undefined,
      notifyServerchan: v.notifyServerchan || undefined,
      notifyEmail: v.notifyEmail || undefined,
      notifyDiscord: v.notifyDiscord || undefined,
      notifySlack: v.notifySlack || undefined,
      notifyNtfy: v.notifyNtfy || undefined,
      notifyPushoverUser: v.notifyPushoverUser || undefined,
      notifyPushoverToken: v.notifyPushoverToken || undefined,
      notifyWebhook: v.notifyWebhook || undefined,
      emailApiUrl: v.emailApiUrl || undefined,
      emailApiKey: v.emailApiKey || undefined,
      emailFrom: v.emailFrom || undefined,
      slug: v.slugVal || undefined,
      turnstileToken: (await ensureTurnstileToken()) || undefined,
    };

    try {
      if (isEdit) {
        payload.editToken = editToken;
        delete payload.turnstileToken;
        delete payload.slug;
        await put(`/api/bowl/${editSlug}`, payload);
        localStorage.setItem("bowl_edit_token", JSON.stringify({ slug: editSlug, token: editToken }));
        toast(T("create.editToast"));
        location.href = `/${editSlug}?token=${encodeURIComponent(editToken)}`;
        return;
      }

      const data = await post("/api/bowl", payload);
      localStorage.setItem("bowl_edit_token", JSON.stringify({ slug: data.slug, token: data.editToken }));
      $("#goto-bowl").href = `/${data.slug}`;
      $("#success-mask").classList.add("show");
      document.querySelector("#copy-link").dataset.slug = data.slug;
      document.querySelector("#copy-manage").dataset.slug = data.slug;
      document.querySelector("#copy-manage").dataset.token = data.editToken;
    } catch (e) {
      alertCenter(e.message || T("api.e500"));
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? T("create.editSubmit") : T("create.submit");
    }
  });

  /* ---------- 成功弹窗 ---------- */
  const mask = $("#success-mask");

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  $("#copy-link").addEventListener("click", async (e) => {
    await copyText(`${location.origin}/${e.currentTarget.dataset.slug}`);
    $("#copy-tip").style.display = "block";
  });

  $("#copy-manage").addEventListener("click", async (e) => {
    const { slug, token } = e.currentTarget.dataset;
    await copyText(`${location.origin}/${slug}?token=${encodeURIComponent(token)}`);
    $("#manage-tip").style.display = "block";
  });

  $("#another-bowl").addEventListener("click", () => location.reload());

  mask.addEventListener("click", (e) => {
    if (e.target === mask) mask.classList.remove("show");
  });

  /* ---------- 初始化 ---------- */
  bindPayTabs();
  showPayPanel(payMethod);

  I18N.onReady(async () => {
    await initCurrencies();
    initEdit();
    loadTurnstile();
    await fetchSiteKey();
    const t0 = Date.now();
    const iv = setInterval(() => {
      renderTurnstile();
      if (turnstileWidget || Date.now() - t0 > 20000) clearInterval(iv);
    }, 400);
  });

  // 切语言：重画 tab 文案（data-i18n 已处理静态部分），面板状态保持
  document.addEventListener("i18n:change", () => showPayPanel(payMethod));
})();
