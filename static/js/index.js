/* 🍔 饭碗儿 / Fanwaner —— 首页 */
(() => {
  const { $, get, fmtDate, mealState, T, PICK, MONEY } = FW;

  // 底部口号：从 i18n 包随机轮换（每 8 秒一句）
  // 中文站仍支持用 /tips.md 覆盖（方便非开发者直接往文件里加句子）
  let tips = [];
  let lastTip = -1;
  const sloganEl = $("#slogan");

  function showTip() {
    if (!tips.length || !sloganEl) return;
    let i;
    do {
      i = Math.floor(Math.random() * tips.length);
    } while (tips.length > 1 && i === lastTip);
    lastTip = i;
    sloganEl.textContent = tips[i];
    sloganEl.classList.remove("fade");
    void sloganEl.offsetWidth;
    sloganEl.classList.add("fade");
  }

  async function loadTips() {
    tips = I18N.list("index.tips");
    showTip();
    // 中文站保留 md 覆盖能力
    if (I18N.lang === "zh") {
      try {
        const r = await fetch("/tips.md", { cache: "no-store" });
        if (r.ok) {
          const t = await r.text();
          const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
          if (lines.length) { tips = lines; showTip(); }
        }
      } catch { /* 拉不到就用 i18n 包里的 */ }
    }
    setInterval(showTip, 8000);
  }

  /* 状态标签：走 i18n */
  const STATUS_KEY = {
    active: "bowl.statusActive",
    completed: "bowl.statusCompleted",
    expired: "bowl.statusExpired",
    hidden: "bowl.statusHidden",
  };
  const statusOf = (s) => T(STATUS_KEY[s] || "bowl.statusActive");

  let page = 1;
  let total = 0;
  const pageSize = 9;

  async function load(reset = false) {
    if (reset) { page = 1; $("#bowl-list").innerHTML = ""; }
    const box = $("#bowl-list");
    if (page === 1) box.innerHTML = '<div class="spinner"></div>';

    try {
      const data = await get(`/api/bowl?status=active&sort=newest&page=${page}&pageSize=${pageSize}`);
      total = data.total;
      $("#bowl-count").textContent = total ? T("index.countLabel", { n: total }) : "";

      if (reset) box.innerHTML = "";
      data.items.forEach((b) => renderCard(b));

      if (box.children.length === 0) {
        $("#empty-box").classList.remove("hidden");
      } else {
        $("#empty-box").classList.add("hidden");
      }
      const hasMore = page * pageSize < total;
      $("#load-more").classList.toggle("hidden", !hasMore);
      page++;
    } catch (e) {
      if (page === 1) {
        box.innerHTML = `
          <div class="empty" style="grid-column:1/-1;">
            <img src="/img/bowl.svg" alt="" />
            <h2>${escapeHtml(T("index.errorTitle"))}</h2>
            <p>${escapeHtml(e.message || T("common.networkError"))}</p>
            <button class="btn" data-reload>${escapeHtml(T("index.errorRetry"))}</button>
          </div>`;
        const btn = box.querySelector("[data-reload]");
        if (btn) btn.addEventListener("click", () => location.reload());
      }
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 首页卡片动态留言：没放行的投喂 / 遭拒的留言
  // 文案优先从 i18n 包取（feed.pending / feed.rejected）；中文站支持 /feed-texts.md 覆盖
  let PENDING_TEXTS = [];
  let REJECTED_TEXTS = [];

  function reloadFeedTexts() {
    PENDING_TEXTS = I18N.list("feed.pending");
    REJECTED_TEXTS = I18N.list("feed.rejected");
  }
  reloadFeedTexts();

  async function loadFeedTexts() {
    // 中文站：md 文件覆盖（`## 没放行` / `## 遭拒` 分节，`- ` 开头是条目）
    if (I18N.lang !== "zh") return;
    try {
      const res = await fetch("/feed-texts.md", { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      const pending = [];
      const rejected = [];
      let section = "pending";
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t.startsWith("#")) {
          section = /遭拒|拒绝/.test(t) ? "rejected" : "pending";
        } else if (t.startsWith("- ")) {
          const item = t.slice(2).trim();
          if (item) (section === "rejected" ? rejected : pending).push(item);
        }
      }
      if (pending.length) PENDING_TEXTS = pending;
      if (rejected.length) REJECTED_TEXTS = rejected;
      load(true);
    } catch { /* 拉不到就用 i18n 包里的 */ }
  }

  // 组装一张卡片的动态留言队列：没放行（优先）→ 遭拒 → 已放行的留言内容
  function buildFeed(b) {
    const items = [];
    if (!PENDING_TEXTS.length) reloadFeedTexts();
    if (b.pendingCount > 0 && PENDING_TEXTS.length) {
      items.push({ text: FW.pick(PENDING_TEXTS) });
    } else if (b.rejectedCount > 0 && REJECTED_TEXTS.length) {
      items.push({ text: FW.pick(REJECTED_TEXTS) });
    }
    (b.recentMessages || []).forEach((m) => {
      const who = m.isAnonymous ? T("feed.anonymous") : (m.nickname || T("feed.passerby"));
      items.push({ text: `${who} ${T("feed.said")}: ${m.message || T("feed.noMessage")}` });
    });
    return items;
  }

  // 留言长了就从右到左滚起来
  function applyScroll(itemEl) {
    const win = itemEl.parentElement || itemEl;
    itemEl.classList.remove("scrolling");
    itemEl.style.animationDuration = "";
    if (itemEl.scrollWidth > win.clientWidth) {
      itemEl.classList.add("scrolling");
      const distance = itemEl.scrollWidth * 2;
      itemEl.style.animationDuration = Math.max(10, Math.round(distance / 20)) + "s";
    }
  }

  // 动态留言轮播
  function initFeed(card, queue) {
    const who = card.querySelector(".who-txt");
    if (!who || queue.length <= 1) return;
    let i = 0;
    let timer = null;
    const show = () => {
      who.style.opacity = "0";
      setTimeout(() => {
        who.textContent = queue[i].text;
        applyScroll(who);
        who.style.opacity = "1";
        schedule();
      }, 240);
    };
    const schedule = () => {
      const dur = parseFloat(who.style.animationDuration || "0") || 0;
      const wait = dur > 0 ? dur * 1000 + 2000 : 6000;
      timer = setTimeout(() => { i = (i + 1) % queue.length; show(); }, wait);
    };
    setTimeout(() => {
      applyScroll(who);
      schedule();
    }, 0);
    // 清掉定时器引用，避免切语言重建时叠加
    card._feedTimer = () => { if (timer) clearTimeout(timer); };
  }

  // 金额：后端返回最小单位 + 币种；没升级前用旧的 currentYuan 兜底
  const minorOf = (v, minorKey) => (v[minorKey] != null ? v[minorKey] : Math.round(Number(v[minorKey.replace("Minor", "Yuan")] || 0) * 100));
  const curOf = (b) => b.currency || "CNY";

  function renderCard(b, list) {
    const feed = buildFeed(b);
    const queue = [{ text: T("index.donorCount", { n: b.donorCount || 0 }) }, ...feed];
    const statusTxt = statusOf(b.status);
    const pct = b.percent || 0;
    const deadlineTxt = b.deadline
      ? T("index.deadline", { date: fmtDate(b.deadline) })
      : T("index.noDeadline");

    const el = document.createElement("a");
    el.className = "bowl-card";
    el.href = `/${b.slug}`;
    el.innerHTML = `
      <div class="row">
        ${b.avatarUrl
          ? `<img class="avatar" src="${b.avatarUrl}" alt="" />`
          : `<span class="avatar" style="display:flex;align-items:center;justify-content:center;font-size:20px;">🍔</span>`}
        <h3>${escapeHtml(b.title)}</h3>
        <span class="status-tag">${escapeHtml(statusTxt)}</span>
      </div>
      <div class="meta"><b style="color:var(--gold-deep)">${escapeHtml(mealState(pct))}</b> · ${escapeHtml(MONEY(minorOf(b, "currentMinor"), curOf(b)))} / ${escapeHtml(MONEY(minorOf(b, "targetMinor"), curOf(b)))} · ${escapeHtml(deadlineTxt)}</div>
      <div class="progress">
        <div class="fill ${pct >= 100 ? "full" : ""}" style="width:${pct}%"></div>
        <span class="pct">${pct}%</span>
      </div>
      <div class="foot">
        <div class="foot-main">
          <span class="who-icon">👨‍💻</span>
          <span class="who"><span class="who-txt">${escapeHtml(queue[0].text)}</span></span>
        </div>
        <span class="go-btn">${escapeHtml(T("index.cardGo"))}</span>
      </div>
    `;
    (list || $("#bowl-list")).appendChild(el);
    initFeed(el, queue);
  }

  // 吃饱收摊的碗（completed / expired / hidden），默认折叠
  async function loadDone() {
    const box = $("#done-list");
    try {
      const data = await get(`/api/bowl?status=completed,expired,hidden&sort=newest&page=1&pageSize=50`);
      const items = data.items || [];
      $("#done-count").textContent = items.length ? T("index.doneCountLabel", { n: data.total || items.length }) : "";
      if (!items.length) {
        box.innerHTML = `<div class="empty" style="padding:20px;"><p style="margin:0;">${escapeHtml(T("index.doneEmpty"))}</p></div>`;
        return;
      }
      items.forEach((b) => renderCard(b, box));
    } catch { /* 拉不到就算了，莫影响主页 */ }
  }

  // 切语言：整页重画（静态部分由 i18n.js 处理，这里重画动态部分）
  document.addEventListener("i18n:change", () => {
    tips = I18N.list("index.tips");
    reloadFeedTexts();
    $("#done-list").innerHTML = "";
    load(true);
    loadDone();
  });

  // 等 i18n 包加载完再拉数据，保证首屏就是正确语言
  I18N.onReady(() => {
    loadTips();
    load(true);
    loadDone();
    loadFeedTexts();
  });

  $("#load-more-btn").addEventListener("click", () => load());
})();
