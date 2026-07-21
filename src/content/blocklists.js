// Faraday: shared config. Injected before widget-remover.js and dlp-guard.js.
// Single source of truth for AI hosts, widget signatures, and DLP patterns.
// Everything here runs locally; nothing is ever stored or transmitted.

"use strict";

const FARADAY = (() => {
  // Chat hosts where the DLP guard is active in Guard mode (host itself or any subdomain).
  const AI_HOSTS = [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "aistudio.google.com",
    "copilot.microsoft.com",
    "perplexity.ai",
    "poe.com",
    "character.ai",
    "grok.com",
    "meta.ai",
    "chat.mistral.ai",
    "chat.deepseek.com",
    "kimi.com",
    "chat.qwen.ai",
    "pi.ai",
    "you.com",
    "phind.com",
    "huggingface.co"
  ];

  // DOM containers injected by embedded assistant SDKs.
  const WIDGET_SELECTORS = [
    "#intercom-container",
    "#intercom-frame",
    ".intercom-lightweight-app",
    "iframe[name^='intercom-']",
    "#drift-widget",
    "#drift-widget-container",
    "#drift-frame-chat",
    "#drift-frame-controller",
    "iframe#drift-widget",
    "#ada-button-frame",
    "#ada-chat-frame",
    "iframe[id^='ada-']",
    "#tidio-chat",
    "#tidio-chat-iframe",
    "iframe[src*='tidiochat']",
    "#voiceflow-chat",
    "div[id^='voiceflow-chat']",
    "#chatbase-bubble-button",
    "#chatbase-bubble-window",
    "iframe[src*='chatbase.co']",
    "#bp-web-widget",
    "#bp-web-widget-container",
    "iframe[title='Botpress']"
  ];

  // Script src fragments that identify assistant SDK loaders.
  const WIDGET_SCRIPT_HINTS = [
    "widget.intercom.io",
    "js.intercomcdn.com",
    "js.driftt.com",
    "static.ada.support",
    "code.tidio.co",
    "cdn.voiceflow.com",
    "embed.chatbase.co",
    "cdn.botpress.cloud"
  ];

  // Luhn checksum for payment card candidates (kills most false positives).
  function luhnValid(candidate) {
    const digits = candidate.replace(/[^\d]/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      double = !double;
    }
    return sum % 10 === 0;
  }

  // Each detector: id, human-readable label, global regex, optional validator.
  const DLP_PATTERNS = [
    {
      id: "email",
      label: "Email address",
      re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
    },
    {
      id: "ssn",
      label: "US Social Security number",
      re: /\b\d{3}-\d{2}-\d{4}\b/g
    },
    {
      id: "phone",
      label: "Phone number",
      re: /(?:(?<=\s)|^)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/gm
    },
    {
      id: "card",
      label: "Payment card number",
      re: /\b(?:\d[ -]?){12,18}\d\b/g,
      validate: luhnValid
    },
    {
      id: "apikey",
      label: "API key",
      re: /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g
    },
    {
      id: "jwt",
      label: "JWT token",
      re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g
    },
    {
      id: "privkey",
      label: "Private key block",
      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
    }
  ];

  // Scan text, return findings: [{id, label, sample}]. Text is never retained.
  function scan(text) {
    const findings = [];
    if (!text) return findings;
    for (const p of DLP_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const hit = m[0];
        if (p.validate && !p.validate(hit)) continue;
        findings.push({
          id: p.id,
          label: p.label,
          sample: hit.length > 24 ? hit.slice(0, 12) + "…" + hit.slice(-4) : hit
        });
        if (m.index === p.re.lastIndex) p.re.lastIndex++;
      }
    }
    return findings;
  }

  // Replace every detected span with [REDACTED].
  function redact(text) {
    let out = text;
    for (const p of DLP_PATTERNS) {
      p.re.lastIndex = 0;
      out = out.replace(p.re, (hit) =>
        p.validate && !p.validate(hit) ? hit : "[REDACTED]"
      );
    }
    return out;
  }

  function isAiHost(hostname) {
    return AI_HOSTS.some(
      (h) => hostname === h || hostname.endsWith("." + h)
    );
  }

  return {
    AI_HOSTS,
    WIDGET_SELECTORS,
    WIDGET_SCRIPT_HINTS,
    DLP_PATTERNS,
    luhnValid,
    scan,
    redact,
    isAiHost
  };
})();
