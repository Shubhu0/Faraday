// Faraday: local DLP guard.
// Intercepts paste (capture phase), Enter-to-send, and form submit on AI hosts
// (or everywhere, if enabled). Scans via FARADAY.scan() and shows a modal in a
// closed shadow DOM with three actions: redact / send anyway / cancel.
// Scanned text is never stored or transmitted.

"use strict";

(() => {
  if (typeof FARADAY === "undefined") return;

  const api = typeof browser !== "undefined" ? browser : chrome;

  const settings = {
    enabled: true,
    dlpEnabled: true,
    dlpEverywhere: false,
    theme: "auto"
  };
  let excepted = false; // per-site exception ("This site" toggled off)

  function applySettings(s) {
    settings.enabled = s.enabled !== false;
    settings.dlpEnabled = s.dlpEnabled !== false;
    settings.dlpEverywhere = s.dlpEverywhere === true;
    settings.theme = s.theme || "auto";
  }
  function applyAllowed(allowed) {
    const host = location.hostname.replace(/^www\./, "");
    const now = Date.now();
    excepted = Object.entries(allowed || {}).some(([domain, expiry]) => {
      if (expiry !== 0 && expiry <= now) return false;
      return host === domain || host.endsWith("." + domain);
    });
  }
  api.storage.local.get(["settings", "allowed"]).then((data) => {
    applySettings((data && data.settings) || {});
    applyAllowed((data && data.allowed) || {});
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) applySettings(changes.settings.newValue || {});
    if (changes.allowed) applyAllowed(changes.allowed.newValue || {});
  });

  function active() {
    if (!settings.enabled || !settings.dlpEnabled || excepted) return false;
    return settings.dlpEverywhere || FARADAY.isAiHost(location.hostname);
  }

  function resolvedTheme() {
    if (settings.theme === "light" || settings.theme === "dark") {
      return settings.theme;
    }
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  // "Send anyway" arms a short bypass so the re-dispatched event passes cleanly.
  let bypassUntil = 0;
  function bypassing() {
    return Date.now() < bypassUntil;
  }
  function armBypass() {
    bypassUntil = Date.now() + 1500;
  }

  function valueOf(el) {
    if (!el) return "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    if (el.isContentEditable) return el.innerText;
    return "";
  }

  function setValue(el, text) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      document.execCommand("insertText", false, text);
    }
  }

  function insertText(el, text) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart != null ? el.selectionStart : el.value.length;
      const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      document.execCommand("insertText", false, text);
    }
  }

  // ---------- Modal (closed shadow DOM) ----------

  let modalHost = null;

  function closeModal() {
    if (modalHost) {
      modalHost.remove();
      modalHost = null;
    }
  }

  function showModal(findings, actions) {
    closeModal();
    try {
      api.runtime.sendMessage({ type: "dlpDecision", shown: true });
    } catch (e) {
      // Extension context gone; the modal still protects.
    }

    modalHost = document.createElement("div");
    const shadow = modalHost.attachShadow({ mode: "closed" });

    const seen = new Set();
    const items = findings
      .filter((f) => {
        const key = f.label + "|" + f.sample;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(
        (f) =>
          `<li><span class="label">${escapeHtml(f.label)}</span>` +
          `<code>${escapeHtml(f.sample)}</code></li>`
      )
      .join("");

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .scrim {
          position: fixed; inset: 0; z-index: 2147483647;
          background: oklch(0.2 0.02 250 / 0.45);
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
          --surface: oklch(0.995 0.003 250);
          --surface-2: oklch(0.985 0.004 250);
          --border: oklch(0.9 0.012 250);
          --text: oklch(0.22 0.02 250);
          --text-2: oklch(0.55 0.02 250);
          --accent: oklch(0.55 0.15 250);
          --label: oklch(0.45 0.12 85);
          --red: oklch(0.58 0.18 25);
          --red-text: oklch(0.4 0.16 25);
        }
        .scrim[data-theme="dark"] {
          background: oklch(0.1 0.01 250 / 0.6);
          --surface: oklch(0.26 0.018 250);
          --surface-2: oklch(0.23 0.016 250);
          --border: oklch(0.34 0.02 250);
          --text: oklch(0.94 0.005 250);
          --text-2: oklch(0.68 0.01 250);
          --label: oklch(0.8 0.1 85);
          --red-text: oklch(0.8 0.09 25);
        }
        .card {
          background: var(--surface); color: var(--text);
          border: 1px solid var(--border); border-radius: 16px;
          max-width: 460px; width: calc(100% - 48px);
          padding: 20px 22px;
          box-shadow: 0 12px 32px oklch(0.2 0.02 250 / 0.25);
        }
        h1 {
          font-size: 15px; margin: 0 0 6px; font-weight: 700;
          color: var(--red-text);
          display: flex; align-items: center; gap: 8px;
        }
        h1::before {
          content: ""; width: 8px; height: 8px; border-radius: 50%;
          background: var(--red); flex-shrink: 0;
        }
        p { font-size: 13px; margin: 0 0 12px; color: var(--text-2); line-height: 1.45; }
        ul { list-style: none; margin: 0 0 16px; padding: 0; }
        li {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; margin-bottom: 6px;
          background: var(--surface-2); border: 1px solid var(--border);
          border-radius: 10px;
          font-size: 12.5px;
        }
        .label { color: var(--label); font-weight: 600; flex: 0 0 auto; }
        code {
          font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
          font-size: 12px; color: var(--text-2);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .row { display: flex; gap: 8px; justify-content: flex-end; }
        button {
          font: inherit; font-size: 13px; font-weight: 600;
          padding: 8px 16px; border-radius: 10px; cursor: pointer;
          border: 1px solid transparent;
          transition: background 0.15s ease;
        }
        .redact { background: var(--accent); color: oklch(0.99 0.003 250); }
        .redact:hover { filter: brightness(1.08); }
        .send { background: transparent; color: var(--red-text); border-color: var(--border); }
        .send:hover { background: var(--surface-2); }
        .cancel { background: transparent; color: var(--text-2); border-color: var(--border); }
        .cancel:hover { background: var(--surface-2); }
      </style>
      <div class="scrim" part="scrim" data-theme="${resolvedTheme()}">
        <div class="card" role="alertdialog" aria-modal="true" aria-label="Sensitive data detected">
          <h1>Sensitive data detected</h1>
          <p>Faraday caught the following before it left your machine. Nothing has been sent yet.</p>
          <ul>${items}</ul>
          <div class="row">
            <button class="cancel">Cancel</button>
            <button class="send">Send anyway</button>
            <button class="redact">Redact</button>
          </div>
        </div>
      </div>
    `;

    shadow.querySelector(".redact").addEventListener("click", () => {
      closeModal();
      actions.redact();
    });
    shadow.querySelector(".send").addEventListener("click", () => {
      closeModal();
      actions.send();
    });
    shadow.querySelector(".cancel").addEventListener("click", () => {
      closeModal();
      if (actions.cancel) actions.cancel();
    });

    (document.body || document.documentElement).appendChild(modalHost);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  // ---------- Paste interception ----------

  document.addEventListener(
    "paste",
    (e) => {
      if (!active() || bypassing()) return;
      const text = e.clipboardData && e.clipboardData.getData("text/plain");
      if (!text) return;
      const findings = FARADAY.scan(text);
      if (findings.length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      const target = e.target;
      showModal(findings, {
        redact: () => insertText(target, FARADAY.redact(text)),
        send: () => {
          armBypass();
          insertText(target, text);
        }
      });
    },
    true
  );

  // ---------- Enter-to-send interception ----------

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      if (!active() || bypassing()) return;
      const target = e.target;
      const text = valueOf(target);
      if (!text) return;
      const findings = FARADAY.scan(text);
      if (findings.length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      showModal(findings, {
        redact: () => setValue(target, FARADAY.redact(text)),
        send: () => {
          armBypass();
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            })
          );
        }
      });
    },
    true
  );

  // ---------- Form submit interception ----------

  document.addEventListener(
    "submit",
    (e) => {
      if (!active() || bypassing()) return;
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const fields = form.querySelectorAll(
        "input[type='text'], input[type='search'], input:not([type]), textarea"
      );
      let findings = [];
      for (const field of fields) {
        findings = findings.concat(FARADAY.scan(field.value));
      }
      if (findings.length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      showModal(findings, {
        redact: () => {
          for (const field of fields) {
            if (FARADAY.scan(field.value).length > 0) {
              field.value = FARADAY.redact(field.value);
              field.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        },
        send: () => {
          armBypass();
          form.requestSubmit();
        }
      });
    },
    true
  );
})();
