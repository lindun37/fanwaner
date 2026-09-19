/* 🍔 饭碗儿 / Fanwaner —— 饭碗详情页 */
(() => {
  const { $, $$, get, post, toast, money, fmtTime, fmtDate, mealState, progressText, pick, T, MONEY } = FW;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // 兼容两种入口：老式 /bowl.html?slug=xxx 和新式 /cunzhang
  const slug =
    new URLSearchParams(location.search).get("slug") ||
    location.pathname.replace(/^\//, "").split("/")[0] ||
    "";

  let bowl = null;
  let donations = [];
  let payMethod = "paypal";
  let turnstileToken = "";
  let turnstileWidget = null;
  let turnstileSiteKey = "";
  let maxAmount = 1000;

  /* 每种收款方式依赖哪些字段（任一非空即认为「可用」） */
  const METHOD_FIELDS = {
    paypal: ["paypalQr", "paypalLink"],
    stripe: ["stripeUrl"],
    kofi: ["kofiUrl"],
    buymeacoffee: ["bmcUrl"],
    wise: ["wiseEmail"],
    revolut: ["revolutUrl"],
    btc: ["btcQr", "btcAddress"],
    eth: ["ethAddress"],
    sol: ["solAddress"],
    usdt: ["usdtQr", "usdtAddress"],
    usdt_bep20: ["usdtBep20Qr", "usdtBep20Address"],
    usdt_erc20: ["usdtErc20Qr", "usdtErc20Address"],
    wechat: ["wechatQr"],
    alipay: ["alipayQr"],
  };

  // 展示顺序：海外常用在前，中国常用在后
  const METHOD_ORDER = [
    "paypal", "stripe", "kofi", "buymeacoffee", "wise", "revolut",
    "btc", "eth", "sol", "usdt", "usdt_bep20", "usdt_erc20",
    "wechat", "alipay",
  ];

  const payLabel = (m) => T("pay." + m);

  function availableMethods() {
    if (!bowl) return [];
    return METHOD_ORDER.filter((m) =>
      (METHOD_FIELDS[m] || []).some((f) => bowl[f])
    );
  }

  // 金额：优先用最小单位 + 币种；后端没升级时回落到旧字段
  const cur = () => (bowl && bowl.currency) || "CNY";
  const minorOf = (o, key) =>
    o[key + "Minor"] != null ? o[key + "Minor"] : Math.round(Number(o[key + "Yuan"] || 0) * 100);
  const amountText = (o) => MONEY(minorOf(o, "amount"), o.currency || cur());

  /* ---------- 加载数据 ---------- */
  async function load() {
    if (!slug) { location.href = "/"; return; }
    // 金额上限 / 币种等公开配置
    try {
      const cfg = await get("/api/config");
      turnstileSiteKey = cfg.turnstileSiteKey || "";
      if (cfg.maxAmountYuan) maxAmount = cfg.maxAmountYuan;
    } catch { /* 拿不到就用默认值 */ }

    try {
      const data = await get(`/api/bowl/${slug}`);
      bowl = data.bowl;
      donations = data.donations || [];
      render();
      $("#loading").classList.add("hidden");
      $("#detail").classList.remove("hidden");
    } catch (e) {
      $("#loading").classList.add("hidden");
      document.querySelector(".detail-wrap").innerHTML = `
        <div class="empty" style="margin-top:40px;">
          <img src="/img/bowl.svg" alt="${esc(T("bowl.emptyAlt"))}" />
          <h2>${esc(T("bowl.loadFailedTitle"))}</h2>
          <p>${esc(e.message || T("bowl.loadFailedSub"))}</p>
          <div class="btn-row" style="justify-content:center;">
            <a class="btn btn-primary" href="/">${esc(T("bowl.backHome"))}</a>
            <a class="btn" href="/#bowls">${esc(T("bowl.browseOthers"))}</a>
          </div>
        </div>`;
    }
  }

  function render() {
    const pct = bowl.percent;
    $("#d-title").textContent = bowl.title;
    $("#d-state").textContent = mealState(pct);
    $("#d-current").textContent = MONEY(minorOf(bowl, "current"), cur());
    $("#d-target").textContent = MONEY(minorOf(bowl, "target"), cur());

    const stKey = { active: "bowl.statusActive", completed: "bowl.statusCompleted", expired: "bowl.statusExpired", hidden: "bowl.statusHidden" }[bowl.status] || "bowl.statusActive";
    const stCls = { active: "s-active", completed: "s-done", expired: "s-cold", hidden: "s-cold" }[bowl.status] || "s-active";
    const st = $("#d-status");
    st.textContent = T(stKey);
    st.className = `detail-status ${stCls}`;

    $("#d-fill").style.width = `${pct}%`;
    $("#d-fill").classList.toggle("full", pct >= 100);
    $("#d-pct").textContent = `${pct}%`;
    $("#d-progress-text").textContent = progressText(pct);

    $("#d-want").textContent = bowl.want || "";
    $("#d-reason").textContent = bowl.reason || "";

    const kv = [];
    if (bowl.deadline) kv.push(esc(T("bowl.deadlineKv", { date: fmtDate(bowl.deadline) })));
    if (bowl.nickname) kv.push(esc(T("bowl.ownerKv", { name: bowl.nickname })));
    $("#d-kv").innerHTML = kv.join(" · ");

    // 摆碗的本人可见「改一哈」+「复制管理链接」。
    // ⚠️ 必须先让服务端点头，才把后台入口放出来：以前只判 `if (token)`，
    // 地址栏里随便挂个非空 token（?token=deadbeef 也算）就会把「改一哈 /
    // 复制管理链接 / 待放行面板」全渲染出来 —— 看着就像后台被别人推开了。
    // 现在要 /pending 真的返回 200 才认。
    const token = getEditToken(slug);
    if (token) verifyOwner(token);

    renderRecords();
    buildDonateTabs();
  }

  function getEditToken(slug2) {
    const urlToken = new URLSearchParams(location.search).get("token") || "";
    let stored = "";
    try {
      const raw = localStorage.getItem("bowl_edit_token");
      if (raw) {
        const item = JSON.parse(raw);
        if (item.slug === slug2) stored = item.token;
      }
    } catch {}
    const token = urlToken || stored;
    if (token && token !== stored) {
      try { localStorage.setItem("bowl_edit_token", JSON.stringify({ slug: slug2, token })); } catch {}
    }
    return token;
  }

  // 令牌丢了就从本地缓存里清掉，免得以后每次打开都白试一遍
  function forgetEditToken(slug2) {
    try {
      const raw = localStorage.getItem("bowl_edit_token");
      if (!raw) return;
      const item = JSON.parse(raw);
      if (item && item.slug === slug2) localStorage.removeItem("bowl_edit_token");
    } catch {}
  }

  // 服务端认了这个令牌才亮后台入口；不认就什么都不亮，跟普通访客看到的一样
  async function verifyOwner(token) {
    const ok = await renderPending(token);
    if (!ok) {
      forgetEditToken(slug);
      return;
    }
    const btn = $("#btn-edit");
    btn.classList.remove("hidden");
    btn.onclick = () => { location.href = `/create.html?edit=${slug}&token=${encodeURIComponent(token)}`; };
    const btnM = $("#btn-manage-link");
    btnM.classList.remove("hidden");
    btnM.onclick = async () => {
      await copyText(`${location.origin}/${slug}?token=${encodeURIComponent(token)}`);
      toast(T("bowl.manageCopiedToast"));
    };
  }

  /* ---------- 碗主人视角：待放行 + 已自动上墙 + 遭拒 ---------- */
  // 返回 true = 服务端认这个令牌（是碗主人）；false = 不认，后台入口不应该出现
  async function renderPending(token) {
    const section = $("#pending-section");
    const list = $("#pending-list");
    const rejSection = $("#rejected-section");
    const rejList = $("#rejected-list");

    let items = [];
    let rejected = [];
    let approved = [];
    let data;
    try {
      data = await get(`/api/bowl/${slug}/pending?token=${encodeURIComponent(token)}`);
    } catch (e) {
      if (e && e.status === 401) {
        // 令牌不对（伪造的、或者碗被重建过）：一个后台元素都别露出来
        section.classList.add("hidden");
        if (rejSection) rejSection.classList.add("hidden");
        list.innerHTML = "";
        return false;
      }
      // 网络抽风 / 服务端 5xx：令牌本身没毛病，保留入口，把原因写脸上
      section.classList.remove("hidden");
      list.innerHTML = `<p style="color:var(--muted);">${esc(e.message || T("bowl.pendingLoadFailed"))}</p>`;
      return true;
    }

    items = data.pending || [];
    rejected = data.rejected || [];
    approved = data.approved || [];
    section.classList.remove("hidden");
    if (rejList) rejList.innerHTML = "";
    // 已自动上墙时，待放行区块改叫「复核」：仍可把不实的那笔拒了
    const autoMode = !!data.autoApprove;
    $("#pending-title").textContent = autoMode ? T("bowl.reviewTitle") : T("bowl.pendingTitle");
    $("#pending-hint").textContent = autoMode ? "" : T("bowl.pendingHint");

    // 免放行模式下 pending 为空，但列出的 recent approved 同样可以拒
    const reviewList = items.length ? items : approved;
    const reviewMode = !items.length && approved.length > 0;

    if (!reviewList.length) {
      list.innerHTML = `<div class="empty" style="padding:24px 20px;"><h2 style="font-size:18px;">${esc(T("bowl.pendingEmptyTitle"))}</h2><p style="margin-bottom:0;">${esc(T("bowl.pendingEmptySub"))}</p></div>`;
    } else {
      list.innerHTML = "";
      reviewList.forEach((d) => {
        const el = document.createElement("div");
        el.className = "record pending-record";
        el.innerHTML = `
          <div class="r-avatar">${reviewMode ? "✅" : "🍔"}</div>
          <div class="r-main">
            <div class="r-name">${esc(d.nickname)}<span class="amt" style="color:var(--gold-deep);">${esc(T("bowl.donated", { amount: amountText(d) }))}</span><small style="color:var(--muted);">${esc(payLabel(d.paymentMethod))}</small></div>
            ${d.message ? `<div class="r-msg">“${esc(d.message)}”</div>` : ""}
            <div class="r-time">${esc(fmtTime(d.createdAt))}${d.txid ? ` · ${esc(T("bowl.txidLabel", { id: d.txid }))}` : ""}</div>
            <div class="pending-actions">
              ${reviewMode ? "" : `<button class="btn btn-sm btn-gold" data-act="approve" data-id="${d.id}">${esc(T("bowl.approve"))}</button>`}
              <button class="btn btn-sm" data-act="reject" data-id="${d.id}">${esc(T("bowl.reject"))}</button>
            </div>
          </div>`;
        const ap = el.querySelector("[data-act='approve']");
        if (ap) ap.addEventListener("click", async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            await post(`/api/bowl/${slug}/approve`, { id: d.id, editToken: token });
            toast(T("bowl.approveToast"));
            load();
          } catch (err) {
            b.disabled = false;
            toast(err.message || T("bowl.actionFailedToast"));
          }
        });
        el.querySelector("[data-act='reject']").addEventListener("click", async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            await post(`/api/bowl/${slug}/reject`, { id: d.id, editToken: token });
            toast(T("bowl.rejectToast"));
            renderPending(token);
          } catch (err) {
            b.disabled = false;
            toast(err.message || T("bowl.actionFailedToast"));
          }
        });
        list.appendChild(el);
      });
    }

    if (rejSection && rejList) {
      rejSection.classList.toggle("hidden", !rejected.length);
      if (rejected.length) {
        rejList.innerHTML = "";
        rejected.forEach((d) => {
          const el = document.createElement("div");
          el.className = "record pending-record";
          el.innerHTML = `
            <div class="r-avatar">🙅</div>
            <div class="r-main">
              <div class="r-name">${esc(d.nickname)}<small style="color:var(--muted);">${esc(payLabel(d.paymentMethod))}</small></div>
              ${d.message ? `<div class="r-msg">“${esc(d.message)}”</div>` : ""}
              <div class="r-time">${esc(fmtTime(d.createdAt))}</div>
            </div>`;
          rejList.appendChild(el);
        });
      }
    }

    return true;
  }

  /* ---------- 投喂记录 + 排行榜 ---------- */
  function renderRecords() {
    const list = $("#record-list");
    list.innerHTML = "";
    if (donations.length) {
      $("#record-empty").classList.add("hidden");
      $("#r-count").textContent = T("bowl.recordsCount", { n: donations.length });
    } else {
      $("#record-empty").classList.remove("hidden");
      $("#r-count").textContent = "";
    }

    donations.forEach((d) => {
      const el = document.createElement("div");
      el.className = "record";
      const showNet = d.paymentMethod && d.paymentMethod !== "wechat" && d.paymentMethod !== "alipay";
      el.innerHTML = `
        <div class="r-avatar">${d.anonymous ? "🙈" : "🍔"}</div>
        <div class="r-main">
          <div class="r-name">${esc(d.nickname)}<span class="amt">${esc(T("bowl.donated", { amount: amountText(d) }))}</span>${showNet ? ` <small style='color:var(--muted)'>${esc(payLabel(d.paymentMethod))}</small>` : ""}</div>
          ${d.message ? `<div class="r-msg">“${esc(d.message)}”</div>` : ""}
          <div class="r-time">${esc(fmtTime(d.createdAt))}</div>
        </div>`;
      list.appendChild(el);
    });

    // 排行榜：按金额取前 3
    const top = [...donations].sort((a, b) => minorOf(b, "amount") - minorOf(a, "amount")).slice(0, 3);
    const medals = [T("bowl.medal1"), T("bowl.medal2"), T("bowl.medal3")];
    const rank = $("#rank-list");
    rank.innerHTML = "";
    top.forEach((d, i) => {
      const el = document.createElement("div");
      el.className = "rank-item";
      el.innerHTML = `<span>${esc(medals[i])}</span><b>${esc(d.nickname)}</b><span style="color:var(--gold-deep);">${esc(amountText(d))}</span>`;
      rank.appendChild(el);
    });
    if (!top.length) rank.innerHTML = `<p style="color:var(--muted); font-size:14px;">${esc(T("bowl.rankNone"))}</p>`;
  }

  /* ---------- 分享 ---------- */
  const shareMask = $("#share-mask");
  $("#btn-share").addEventListener("click", () => {
    $("#share-url").textContent = `${location.origin}/${slug}`;
    $("#share-copied").classList.add("hidden");
    shareMask.classList.add("show");
  });

  $("#btn-copy-share").addEventListener("click", async () => {
    await copyText($("#share-url").textContent);
    $("#share-copied").classList.remove("hidden");
  });

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
  }

  /* ---------- 投一口 ---------- */
  const donateMask = $("#donate-mask");
  let done = false;

  // 只展示碗主人实际填过的收款方式
  function buildDonateTabs() {
    const host = $("#donate-pay-tabs");
    const methods = availableMethods();
    host.innerHTML = methods
      .map((m, i) => `<button type="button" class="pay-tab${i === 0 ? " active" : ""}" data-pay="${m}">${esc(payLabel(m))}</button>`)
      .join("");
    if (methods.length) payMethod = methods[0];
    host.querySelectorAll(".pay-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        host.querySelectorAll(".pay-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        payMethod = tab.dataset.pay;
      });
    });
  }

  $("#btn-donate").addEventListener("click", () => {
    if (bowl.status !== "active") { toast(T("bowl.closedToast")); return; }
    if (!availableMethods().length) { toast(T("bowl.noPaymentToast")); return; }
    done = false;
    buildDonateTabs();
    showStep("pay");
    donateMask.classList.add("show");
  });

  $("#btn-next").addEventListener("click", () => {
    if (!availableMethods().includes(payMethod)) { toast(T("bowl.methodMissingToast")); return; }
    renderReportStep();
    showStep("report");
  });

  let reportAddr = "";
  let reportQr = "";

  // 链接型收款方式 → 展示「打开收款页」按钮
  const LINK_FIELD = {
    paypal: "paypalLink", stripe: "stripeUrl", kofi: "kofiUrl",
    buymeacoffee: "bmcUrl", revolut: "revolutUrl", wise: "wiseEmail",
  };

  function renderReportStep() {
    const m = payMethod;
    const link = LINK_FIELD[m] ? bowl[LINK_FIELD[m]] : "";
    const isCrypto = ["btc", "eth", "sol", "usdt", "usdt_bep20", "usdt_erc20"].includes(m);
    const qrField = { paypal: "paypalQr", usdt: "usdtQr", usdt_bep20: "usdtBep20Qr", usdt_erc20: "usdtErc20Qr", btc: "btcQr", wechat: "wechatQr", alipay: "alipayQr" }[m];
    const addrField = { usdt: "usdtAddress", usdt_bep20: "usdtBep20Address", usdt_erc20: "usdtErc20Address", btc: "btcAddress", eth: "ethAddress", sol: "solAddress" }[m];
    reportQr = qrField ? bowl[qrField] || "" : "";
    reportAddr = addrField ? bowl[addrField] || "" : "";

    $("#rd-txid-field").classList.toggle("hidden", !isCrypto);

    // 地址展示（链上币种）
    const addrBox = $("#r-usdt-box");
    const addrOnly = isCrypto && !reportQr && !!reportAddr;
    addrBox.classList.toggle("hidden", !addrOnly);
    if (addrOnly) {
      $("#r-usdt-net").textContent =
        m === "usdt" ? T("bowl.netTrc20")
        : m === "usdt_bep20" ? T("bowl.netBep20")
        : m === "usdt_erc20" ? T("bowl.netErc20")
        : payLabel(m);
      $("#r-usdt-addr").textContent = reportAddr;
    }

    // 二维码展示
    const qrBox = $("#r-qr-box");
    if (reportQr) {
      qrBox.classList.remove("hidden");
      qrBox.innerHTML = `<img src="${esc(reportQr)}" alt="${esc(payLabel(m))}" /><p class="qr-tip" style="margin-top:10px;">${esc(T("bowl.scanTip"))}</p>`;
    } else {
      qrBox.classList.add("hidden");
      qrBox.innerHTML = "";
    }

    // 链接型收款方式：给个按钮直接跳过去
    const linkBox = $("#r-link-box");
    const linkBtn = $("#r-pay-link");
    const httpLink = link && /^https?:\/\//i.test(link) ? link : (link ? `mailto:${link}` : "");
    if (httpLink) {
      linkBox.classList.remove("hidden");
      linkBtn.href = httpLink;
    } else {
      linkBox.classList.add("hidden");
    }

    // 都没有（只有邮箱之类）→ 把地址文本直接给出来
    if (!reportQr && !httpLink && !reportAddr) {
      qrBox.classList.remove("hidden");
      qrBox.innerHTML = `<p class="qr-tip">${esc(T("bowl.noQrNoLink"))}</p>`;
    }

    $("#r-report-tip").innerHTML = T("donate.reportTip", { method: `<b>${esc(payLabel(m))}</b>` });
  }

  $("#btn-copy-usdt").addEventListener("click", async () => {
    await copyText(reportAddr);
    toast(T("bowl.addrCopied"));
  });

  /* ---------- 报到（提交投喂） ---------- */
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
      let finished = false;
      const finish = (ok) => { if (!finished) { finished = true; resolve(ok); } };
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

  /* Turnstile 加载不出来时（110200 = 域名没在 CF 后台授权、200500 = 脚本被拦…），
     在控件下方挂一行人话提示，并把错误码原样带出来 —— 不然访客只看到一片空白
     和一个点了没反应的按钮。 */
  function showTurnstileHint(code) {
    const wrap = $("#turnstile-wrap");
    if (!wrap) return;
    let el = wrap.nextElementSibling;
    if (!el || !el.classList || !el.classList.contains("ts-hint")) {
      el = document.createElement("p");
      el.className = "ts-hint";
      wrap.insertAdjacentElement("afterend", el);
    }
    el.textContent = T("common.turnstileHint");
    if (code) {
      const c = document.createElement("span");
      c.className = "ts-code";
      c.textContent = ` (${code})`;
      el.appendChild(c);
    }
  }
  function clearTurnstileHint() {
    const el = document.querySelector(".ts-hint");
    if (el) el.remove();
  }

  function renderTurnstile() {
    if (turnstileWidget || !turnstileSiteKey || typeof window.turnstile === "undefined") return;
    turnstileWidget = window.turnstile.render($("#turnstile-wrap"), {
      sitekey: turnstileSiteKey,
      callback: (t) => { turnstileToken = t; clearTurnstileHint(); },
      "error-callback": (code) => { turnstileToken = ""; showTurnstileHint(code); },
      "expired-callback": () => { turnstileToken = ""; },
    });
  }

  loadTurnstile();
  fetchSiteKey();

  async function ensureTurnstileToken(timeout = 8000) {
    if (turnstileToken) return turnstileToken;
    await fetchSiteKey();
    const scriptOk = await loadTurnstile();
    if (!scriptOk && turnstileSiteKey) showTurnstileHint("");
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

  $("#btn-submit-donation").addEventListener("click", async () => {
    const btn = $("#btn-submit-donation");
    const amount = $("#rd-amount").value;
    const nickname = $("#rd-nickname").value.trim();
    const message = $("#rd-message").value.trim();
    const txid = $("#rd-txid").value.trim();
    const isAnonymous = $("#rd-anon").checked;

    if (!amount || Number(amount) <= 0) { toast(T("bowl.amountRequired")); return; }
    if (Number(amount) > maxAmount) { toast(T("bowl.amountTooBig", { max: maxAmount })); return; }
    if (!isAnonymous && !nickname) { toast(T("bowl.nameRequired")); return; }

    btn.disabled = true;
    const originalLabel = T("donate.submit");
    btn.textContent = T("bowl.submitting");
    try {
      const data = await post("/api/donation", {
        slug, nickname,
        amount: Number(amount),
        message,
        paymentMethod: payMethod,
        txid: txid || undefined,
        isAnonymous,
        turnstileToken: (await ensureTurnstileToken()) || undefined,
      });
      localStorage.setItem(`donation_delete_${data.id}`, data.deleteToken);
      await playDing();
      $("#done-title").textContent = T("bowl.successTitleDone");
      // 免放行模式直接上墙；审核模式则要等碗主人放行
      $("#done-sub").textContent = data.autoApproved ? T("bowl.successSubAuto") : T("bowl.successSubPending");
      showStep("done");
      refresh();
    } catch (e) {
      toast(e.message || T("bowl.actionFailedToast"));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  /* ---------- 投喂成功动画 ---------- */
  function playDing() {
    return new Promise((resolve) => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1568, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(2093, ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
      } catch { /* 没声音就没声音 */ }

      $$("#ding-scene .rice").forEach((r, i) => {
        r.classList.remove("drop");
        void r.offsetWidth;
        setTimeout(() => r.classList.add("drop"), i * 140);
      });
      setTimeout(() => $("#ding-scene").classList.add("wobble"), 320);
      setTimeout(resolve, 850);
    });
  }

  async function refresh() {
    try {
      const data = await get(`/api/bowl/${slug}`);
      bowl = data.bowl;
      donations = data.donations || [];
      render();
    } catch { }
  }

  /* ---------- 弹窗开关 ---------- */
  function showStep(step) {
    ["pay", "report", "done"].forEach((s) => {
      $(`#step-${s}`).classList.toggle("hidden", s !== step);
    });
    if (step === "report") {
      renderTurnstile();
      const t0 = Date.now();
      const iv = setInterval(() => {
        renderTurnstile();
        if (turnstileWidget || Date.now() - t0 > 15000) {
          clearInterval(iv);
          if (!turnstileWidget && turnstileSiteKey) showTurnstileHint("");
        }
      }, 400);
    }
  }

  [shareMask, donateMask].forEach((mask) => {
    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.dataset.close !== undefined) {
        mask.classList.remove("show");
      }
    });
  });

  donateMask.addEventListener("click", (e) => {
    if (e.target === donateMask || e.target.dataset.close !== undefined) {
      if (done) refresh();
    }
  });

  /* ---------- 切语言：重画动态部分 ---------- */
  document.addEventListener("i18n:change", () => {
    if (bowl) render();
  });

  I18N.onReady(() => load());
})();
