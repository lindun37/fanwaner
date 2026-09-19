/* 饭碗儿 / Fanwaner —— 前端 i18n 运行时（零构建，纯浏览器 ESM 风格挂 window）
 *
 * 用法：
 *   1) HTML 里给元素加 data-i18n="create.heading" 等属性
 *   2) 页面脚本里用 window.I18N.t("bowl.btnDonate")
 *   3) 切语言：window.I18N.setLang("en")
 *
 * 支持的属性：
 *   data-i18n           → textContent
 *   data-i18n-html      → innerHTML（只用于带 <em>/<strong> 的静态文案）
 *   data-i18n-ph        → placeholder
 *   data-i18n-title     → title
 *   data-i18n-aria      → aria-label
 *   data-lang-switch    → 容器：自动塞进语言切换器
 */
(function () {
  "use strict";

  var SUPPORTED = ["en", "zh"];
  var STORAGE_KEY = "fanwaner.lang";
  var packs = {}; // lang -> object
  var current = "en";
  var readyCallbacks = [];

  function normalize(lang) {
    if (!lang) return "en";
    var s = String(lang).toLowerCase();
    if (SUPPORTED.indexOf(s) >= 0) return s;
    var base = s.split("-")[0];
    if (SUPPORTED.indexOf(base) >= 0) return base;
    return "en";
  }

  function detect() {
    // 1) ?lang= 显式指定（便于分享带语言的链接）
    try {
      var q = new URLSearchParams(location.search).get("lang");
      if (q) return normalize(q);
    } catch (e) {}

    // 2) 上次选择
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalize(saved);
    } catch (e) {}

    // 3) 浏览器语言
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    // 中文变体 → zh；其它一律 en（面向海外用户）
    if (nav.indexOf("zh") === 0) return "zh";
    return "en";
  }

  function get(obj, path) {
    if (!obj) return undefined;
    var cur = obj;
    var parts = path.split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return typeof cur === "string" ? cur : undefined;
  }

  // 支持 {name} / {current} 这类占位符
  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
    });
  }

  function t(path, vars) {
    var s = get(packs[current], path) || get(packs.en, path) || path;
    return interpolate(s, vars);
  }

  // 数组型文案（口号、留言模板）：list("index.tips") → ["...", "..."]
  function list(path) {
    var cur = packs[current] || {};
    var parts = path.split(".");
    var arr = parts.reduce(function (a, k) { return a == null ? undefined : a[k]; }, cur);
    if (!Array.isArray(arr) || !arr.length) {
      arr = parts.reduce(function (a, k) { return a == null ? undefined : a[k]; }, packs.en || {});
    }
    return Array.isArray(arr) ? arr.slice() : [];
  }

  // 从数组文案里随机取一条
  function pick(path, vars) {
    var arr = list(path);
    if (!arr.length) return "";
    return interpolate(arr[Math.floor(Math.random() * arr.length)], vars);
  }

  /* 金额格式化：后端统一存「最小单位整数」，前端按币种 + 语言显示 */
  var ZERO_DECIMAL = { JPY: 1, KRW: 1, VND: 1, CLP: 1 };

  function money(minor, currency, locale) {
    var code = (currency || "USD").toUpperCase();
    var lang = locale || current;
    var exp = ZERO_DECIMAL[code] ? 0 : 2;
    var n = Number(minor || 0) / Math.pow(10, exp);
    try {
      return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : lang, {
        style: "currency",
        currency: code,
        minimumFractionDigits: exp,
        maximumFractionDigits: exp,
      }).format(n);
    } catch (e) {
      // 老浏览器不支持该币种时退回纯数字
      return code + " " + n.toFixed(exp);
    }
  }

  /* 把翻译写进 DOM */
  function applyDom() {
    var root = document;

    // 文本
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    // HTML（带内联标签的文案）
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    // placeholder
    root.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    // title
    root.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    // aria-label
    root.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });

    // 带变量的支付文案：data-i18n-pay="pay.qrLabel" data-pay-name="pay.paypal"
    // 渲染成 t("pay.qrLabel", { name: t("pay.paypal") })
    root.querySelectorAll("[data-i18n-pay]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-pay");
      var nameKey = el.getAttribute("data-pay-name");
      var vars = nameKey ? { name: t(nameKey) } : null;
      var out = interpolate(get(packs[current], key) || get(packs.en, key) || key, vars);
      if (el.tagName === "INPUT") el.setAttribute("placeholder", out);
      else el.textContent = out;
    });

    // <html lang>
    try {
      document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
    } catch (e) {}

    renderSwitcher();
  }

  var SWITCH_LABELS = { en: "English", zh: "中文" };

  function renderSwitcher() {
    var host = document.querySelector("[data-lang-switch]");
    if (!host) return;
    host.innerHTML = "";
    SUPPORTED.forEach(function (lang) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lang-btn" + (lang === current ? " active" : "");
      b.textContent = SWITCH_LABELS[lang];
      b.setAttribute("aria-pressed", lang === current ? "true" : "false");
      b.addEventListener("click", function () {
        setLang(lang);
      });
      host.appendChild(b);
    });
  }

  function load(lang) {
    if (packs[lang]) return Promise.resolve(packs[lang]);
    return fetch("/i18n/" + lang + ".json", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("i18n load failed: " + lang);
        return r.json();
      })
      .then(function (json) {
        packs[lang] = json;
        return json;
      });
  }

  function setLang(lang) {
    var next = normalize(lang);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.cookie = "lang=" + next + "; Path=/; Max-Age=31536000; SameSite=Lax";
    } catch (e) {}
    return load(next).then(
      function () {
        current = next;
        applyDom();
        // 通知页面脚本：文案变了，动态渲染的部分要重画
        document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: next } }));
        return next;
      },
      function () {
        return current;
      }
    );
  }

  function init(opts) {
    opts = opts || {};
    if (opts.lang) current = normalize(opts.lang);
    else current = detect();

    return load(current)
      .catch(function () {
        // 英文包加载失败也要保证页面可用
        packs[current] = packs[current] || {};
      })
      .then(function () {
        applyDom();
        document.dispatchEvent(new CustomEvent("i18n:ready", { detail: { lang: current } }));
        readyCallbacks.splice(0).forEach(function (cb) {
          try { cb(current); } catch (e) {}
        });
        return current;
      });
  }

  function onReady(cb) {
    readyCallbacks.push(cb);
  }

  window.I18N = {
    init: init,
    t: t,
    list: list,
    pick: pick,
    money: money,
    setLang: setLang,
    onReady: onReady,
    applyDom: applyDom,
    get lang() { return current; },
    get supported() { return SUPPORTED.slice(); },
    get pack() { return packs[current] || {}; },
  };

  // 自动初始化（页面已存在 DOM 时）；动态页面可自行调 I18N.init()
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); });
  } else {
    init();
  }
})();
