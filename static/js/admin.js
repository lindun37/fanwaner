/* 🍔 饭碗儿 / Fanwaner —— 后台 */
(() => {
  const { $, toast, money, fmtTime, T, MONEY } = FW;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const payLabel = (m) => (I18N.pack.pay && I18N.pack.pay[m]) ? T("pay." + m) : (m || "—");
  const statusLabel = (s) => T("admin.status" + (s ? s[0].toUpperCase() + s.slice(1) : "Active"));

  const KEY = "admin_key";
  let adminKey = sessionStorage.getItem(KEY) || "";

  /* ---------- 登录 ---------- */
  function tryEnter(showErr) {
    adminKey = $("#admin-key").value.trim();
    if (!adminKey && showErr) {
      $("#login-error").textContent = T("admin.keyRequired");
      return;
    }
    sessionStorage.setItem(KEY, adminKey);
    $("#login-box").classList.add("hidden");
    $("#admin-panel").classList.remove("hidden");
    loadPending();
  }

  $("#btn-login").addEventListener("click", () => tryEnter(true));
  $("#admin-key").addEventListener("keydown", (e) => { if (e.key === "Enter") tryEnter(true); });

  if (adminKey) {
    $("#admin-key").value = adminKey;
    tryEnter(false);
  }

  /* ---------- 待审核 + 已上墙复核 ---------- */
  async function loadPending() {
    const wrap = $("#pending-wrap");
    wrap.innerHTML = '<div class="spinner"></div>';
    try {
      const data = await authGet("/api/admin/pending");
      const items = data.items || [];
      const recent = data.recentApproved || [];
      wrap.innerHTML = "";

      if (!items.length) {
        wrap.innerHTML = `<div class="empty" style="padding:36px 20px;"><h2 style="font-size:20px;">${esc(T("admin.emptyTitle"))}</h2><p style="margin-bottom:0;">${esc(T("admin.emptySub"))}</p></div>`;
      } else {
        wrap.appendChild(buildTable(items, false));
      }

      // 免放行模式下没有 pending，改列最近已上墙的，供人工复核/撤下
      if (!items.length && recent.length) {
        const h = document.createElement("h3");
        h.style.cssText = "margin:22px 0 10px;font-size:16px;";
        h.textContent = T("admin.recentTitle");
        wrap.appendChild(h);
        wrap.appendChild(buildTable(recent, true));
      }
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="padding:36px 20px;"><h2 style="font-size:20px;">${esc(e.message || T("admin.loadFailedTitle"))}</h2><p style="margin-bottom:0;">${esc(T("admin.loadFailedSub"))}</p></div>`;
    }
  }

  function buildTable(items, reviewMode) {
    const table = document.createElement("table");
    table.className = "admin-table";
    table.innerHTML = `
      <thead><tr>
        <th>${esc(T("admin.colTime"))}</th><th>${esc(T("admin.colBowl"))}</th><th>${esc(T("admin.colWho"))}</th>
        <th>${esc(T("admin.colAmount"))}</th><th>${esc(T("admin.colMessage"))}</th>
        <th>${esc(T("admin.colMethod"))}</th><th>${esc(T("admin.colAction"))}</th>
      </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    items.forEach((d) => {
      const amount = MONEY(d.amountMinor != null ? d.amountMinor : Math.round((d.amountYuan || 0) * 100), d.currency || "CNY");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><small>${esc(fmtTime(d.createdAt))}</small></td>
        <td><a href="/${esc(d.slug)}" target="_blank" rel="noopener">${esc(d.bowlTitle)}</a><br/><small>${esc(d.slug)}</small></td>
        <td>${esc(d.nickname)}${d.anonymous ? ` <small>${esc(T("admin.anonymousTag"))}</small>` : ""}</td>
        <td><b style="color:var(--gold-deep);">${esc(amount)}</b></td>
        <td>${esc(d.message) || "<small>—</small>"}</td>
        <td><small>${esc(payLabel(d.paymentMethod))}${d.txid ? "<br/>" + esc(d.txid) : ""}</small></td>
        <td>
          <div class="actions">
            ${reviewMode ? "" : `<button class="btn btn-sm btn-gold" data-act="approve" data-id="${d.id}">${esc(T("admin.approve"))}</button>`}
            <button class="btn btn-sm" data-act="reject" data-id="${d.id}">${esc(T("admin.reject"))}</button>
            <button class="btn btn-sm btn-ghost" data-act="delete" data-id="${d.id}">${esc(T("admin.delete"))}</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

    table.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      btn.disabled = true;
      try {
        if (act === "approve") {
          await authPost("/api/admin/approve", { id: Number(id) });
          toast(T("admin.toastApproved"));
        } else if (act === "reject") {
          await authPost("/api/admin/reject", { id: Number(id) });
          toast(T("admin.toastRejected"));
        } else {
          if (!confirm(T("admin.confirmDelete"))) { btn.disabled = false; return; }
          await authPost("/api/admin/delete", { id: Number(id), type: "donation" });
          toast(T("admin.toastDeleted"));
        }
        loadPending();
      } catch (err) {
        btn.disabled = false;
        toast(err.message || T("admin.actionFailed"));
      }
    });

    return table;
  }

  /* ---------- 查/端走饭碗儿 ---------- */
  $("#btn-find-bowl").addEventListener("click", async () => {
    const slug = $("#bowl-slug").value.trim();
    const box = $("#bowl-result");
    if (!slug) { toast(T("admin.slugRequired")); return; }
    box.innerHTML = '<div class="spinner" style="margin:14px auto;"></div>';
    try {
      const b = await authGet(`/api/admin/bowl/${slug}`);
      const cur = MONEY(b.currentMinor != null ? b.currentMinor : Math.round((b.currentYuan || 0) * 100), b.currency || "CNY");
      const tgt = MONEY(b.targetMinor != null ? b.targetMinor : Math.round((b.targetYuan || 0) * 100), b.currency || "CNY");
      box.innerHTML = `
        <table class="admin-table" style="margin-top:12px;">
          <tr><th>${esc(T("admin.colId"))}</th><td>${b.id}</td></tr>
          <tr><th>${esc(T("admin.colTitle"))}</th><td>${esc(b.title)}</td></tr>
          <tr><th>${esc(T("admin.colStatus"))}</th><td>${esc(statusLabel(b.status))}</td></tr>
          <tr><th>${esc(T("admin.colAmount"))}</th><td>${esc(cur)} / ${esc(tgt)}</td></tr>
          <tr><th>${esc(T("admin.colApprovedCount"))}</th><td>${esc(T("admin.approvedUnit", { n: b.approvedDonations }))}</td></tr>
          <tr><th>${esc(T("admin.colActions"))}</th><td>
            <button class="btn btn-sm" id="btn-remove-bowl">${esc(T("admin.removeBowl"))}</button>
          </td></tr>
        </table>`;
      $("#btn-remove-bowl").addEventListener("click", async () => {
        if (!confirm(T("admin.removeBowlConfirm"))) return;
        try {
          await authPost("/api/admin/delete", { id: b.id, type: "bowl" });
          toast(T("admin.bowlRemoved"));
          box.innerHTML = "";
        } catch (e) {
          toast(e.message || T("admin.removeBowlFailed"));
        }
      });
    } catch (e) {
      box.innerHTML = `<div class="alert alert-red" style="margin-top:12px;">${esc(e.message || T("admin.bowlLookupFailed"))}</div>`;
    }
  });

  /* ---------- 鉴权请求 ---------- */
  function authHeaders() {
    return { Authorization: `Bearer ${adminKey}` };
  }

  async function authGet(path) {
    const res = await fetch(path, { headers: authHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      throw { message: data?.error?.message || T("admin.unauthorizedMsg") };
    }
    return data.data;
  }

  async function authPost(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      throw { message: data?.error?.message || T("admin.unauthorizedMsg") };
    }
    return data.data;
  }

  // 切语言：重画
  document.addEventListener("i18n:change", () => {
    if (!$("#admin-panel").classList.contains("hidden")) loadPending();
  });
})();
