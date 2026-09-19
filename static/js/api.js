/* 🍚 饭碗儿 / Fanwaner —— 公共前端工具 */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // i18n 兜底：i18n.js 还没加载完时也不能炸
  const T = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key);
  const PICK = (key, vars) => (window.I18N ? window.I18N.pick(key, vars) : "");
  const MONEY = (minor, currency) => (window.I18N ? window.I18N.money(minor, currency) : String(minor));
  const LANG = () => (window.I18N ? window.I18N.lang : "en");

  /* ---------- fetch 封装 ---------- */
  async function request(method, path, body, raw) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.body = raw ? body : JSON.stringify(body);
      if (!raw) {
        opts.headers["Content-Type"] = "application/json";
      } else if (body?.type) {
        // raw 上传（File/Blob）显式带类型，避免个别浏览器不自动带
        opts.headers["Content-Type"] = body.type;
      }
    }
    // 让服务端按当前界面语言回错误文案（API 报错走服务端 i18n）
    const url = path + (path.includes("?") ? "&" : "?") + "lang=" + encodeURIComponent(LANG());
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw { network: true, message: T("common.networkError") };
    }
    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok || !data || data.ok !== true) {
      const msg = data?.error?.message || fallbackMsg(res.status);
      throw { status: res.status, code: data?.error?.code, message: msg };
    }
    return data.data;
  }

  const get = (p) => request("GET", p);
  const post = (p, b) => request("POST", p, b);
  const put = (p, b) => request("PUT", p, b);
  const del = (p) => request("DELETE", p);
  const upload = (p, file) => request("POST", p, file, true);

  function fallbackMsg(status) {
    if (status === 429) return T("api.e429");
    if (status === 401) return T("api.e401");
    if (status === 404) return T("api.e404");
    if (status >= 500) return T("api.e500");
    return T("api.default");
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    let t = $(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ---------- 中间提示弹窗（出问题了一哈就看得到） ---------- */
  let alertMask = null;
  function alertCenter(msg) {
    if (!alertMask || !alertMask.isConnected) {
      alertMask = document.createElement("div");
      alertMask.className = "alert-mask";
      alertMask.innerHTML = `
        <div class="alert-pop">
          <button class="alert-close" data-close>×</button>
          <p class="alert-msg"></p>
          <button class="btn btn-sm btn-primary alert-ok"></button>
        </div>`;
      alertMask.addEventListener("click", (e) => {
        if (e.target === alertMask || e.target.dataset.close !== undefined || e.target.classList.contains("alert-ok")) {
          alertMask.classList.remove("show");
        }
      });
      document.body.appendChild(alertMask);
    }
    alertMask.querySelector(".alert-ok").textContent = T("common.ok");
    alertMask.querySelector(".alert-msg").textContent = msg;
    alertMask.classList.add("show");
  }

  /* ---------- 金额格式化 ---------- */
  // 新接口：I18N.money(最小单位整数, 币种) → "$12.50" / "12,50 €" / "￥1,200"
  const money = (minor, currency) => MONEY(Number(minor || 0), currency || "USD");

  // 兼容旧调用：yuan(元数字) —— 按当前语言格式化，不带币种符号
  function yuan(n) {
    const v = Number(n || 0);
    const locale = LANG() === "zh" ? "zh-CN" : "en";
    return v.toLocaleString(locale, { maximumFractionDigits: 2 });
  }

  /* ---------- 时间 ---------- */
  // 库内存的是 UTC：无时区标记的串按 UTC 解析；带 Z / 偏移的标准解析。
  // 显示时按用户本地时区渲染（原来写死北京 +8，海外用户会看错时间）。
  function fmtTime(iso) {
    if (!iso) return "";
    const s = String(iso);
    const t = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)
      ? new Date(s.replace(" ", "T") + "Z").getTime()
      : new Date(s).getTime();
    try {
      return new Intl.DateTimeFormat(LANG() === "zh" ? "zh-CN" : "en", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(new Date(t));
    } catch {
      return new Date(t).toISOString().slice(5, 16).replace("T", " ");
    }
  }

  // 只取日期部分（卡片上的截止日）
  function fmtDate(iso) {
    if (!iso) return "";
    const s = String(iso);
    const t = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? new Date(s + "T00:00:00Z").getTime()
      : new Date(s).getTime();
    try {
      return new Intl.DateTimeFormat(LANG() === "zh" ? "zh-CN" : "en", {
        year: "numeric", month: "short", day: "numeric",
      }).format(new Date(t));
    } catch {
      return s.slice(0, 10);
    }
  }

  /* ---------- 进度文案 ---------- */
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 金额状态短语：还没吃上一口 → 开始有饭了 → …… → 吃饱喽！
  function mealState(percent) {
    const p = Number(percent) || 0;
    if (p >= 100) return T("bowl.state100");
    if (p >= 90) return T("bowl.state90");
    if (p >= 60) return T("bowl.state60");
    if (p >= 30) return T("bowl.state30");
    if (p > 0) return T("bowl.state30");
    return T("bowl.state0");
  }

  function progressText(percent) {
    const p = Number(percent) || 0;
    if (p >= 100) return T("prog.p100");
    if (p >= 90) return PICK("prog.p90");
    if (p >= 60) return PICK("prog.p60");
    if (p >= 30) return PICK("prog.p30");
    if (p > 0) return PICK("prog.p0s");
    return PICK("prog.p0");
  }

  window.FW = {
    $, $$, get, post, put, del, upload,
    toast, alertCenter,
    money, yuan, fmtTime, fmtDate,
    progressText, mealState, pick,
    T, PICK, MONEY,
  };
})();
