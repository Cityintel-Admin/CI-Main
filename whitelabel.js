// ============================================================================
// whitelabel.js — Phase 1 (cosmetic tier only)
//
// Include this on any page, right after auth.js:
//   <script src="auth.js"></script>
//   <script src="whitelabel.js"></script>
//
// On DOMContentLoaded, fetches the logged-in user's org config (the same
// /api/org/onboarding endpoint every page already uses for module/tier
// gating) and — only if that org's whitelabel_tier is 'cosmetic' — swaps:
//   - the logo in .brandbar img
//   - the "CityIntel" text in the brandbar and document title
//   - the --brand-red CSS custom property everywhere it's used (buttons,
//     active nav links, etc. all reference this var already, so this one
//     override cascades across the whole shell without per-rule changes)
//
// Does nothing at all for orgs on the 'none' tier (the default) — no
// fetch result, no DOM changes, page renders exactly as it does today.
//
// Known limitation: like the rest of this platform's client-side gating
// (module locks, tier banners), this runs after initial paint, so there
// can be a brief flash of default branding before the swap happens. Fixing
// that fully would mean rendering the shell server-side per org, which is
// a much bigger change — not attempted here.
// ============================================================================

(function(){
  const CI_WL_CACHE_KEY = 'ci_whitelabel_cache_v1';
  const CI_WL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, same order as other org-config caches on this platform

  function hexToRgb(hex){
    const m = String(hex || '').trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // Perceptual-weighted luminance — good enough for a light/dark text
  // decision without a full WCAG contrast calculation.
  function relativeLuminance(rgb){
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
  }

  function hexToHsl(hex){
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s; const l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToHex(h, s, l){
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Derives a shade of the org's accent colour that sits at the same
  // relative lightness/saturation offset that `targetHex` sits at relative
  // to `baseHex` (the primary brand red). Used only for shades confirmed to
  // be pure UI decoration (hover/pressed/gradient states) in a specific
  // known file — never applied blindly to "anything red", since several
  // similar-looking reds elsewhere on this platform are semantic risk/danger
  // colours (High/Critical badges, panic alarm) that must stay red
  // regardless of an org's chosen branding colour.
  function deriveShade(baseHex, targetHex, accentHex){
    const baseHsl = hexToHsl(baseHex), targetHsl = hexToHsl(targetHex), accentHsl = hexToHsl(accentHex);
    if (!baseHsl || !targetHsl || !accentHsl) return targetHex;
    const lightnessDelta = targetHsl.l - baseHsl.l;
    const saturationRatio = baseHsl.s > 0 ? (targetHsl.s / baseHsl.s) : 1;
    const newL = Math.min(1, Math.max(0, accentHsl.l + lightnessDelta));
    const newS = Math.min(1, Math.max(0, accentHsl.s * saturationRatio));
    return hslToHex(accentHsl.h, newS, newL);
  }

  function readCache(){
    try{
      const raw = JSON.parse(localStorage.getItem(CI_WL_CACHE_KEY) || 'null');
      if (!raw || !raw.at || (Date.now() - raw.at) > CI_WL_CACHE_TTL_MS) return null;
      return raw.data || null;
    }catch(_){ return null; }
  }
  function writeCache(data){
    try{ localStorage.setItem(CI_WL_CACHE_KEY, JSON.stringify({ at: Date.now(), data })); }catch(_){}
  }

  async function fetchBranding(){
    const cached = readCache();
    if (cached) return cached;
    try{
      const API_ORIGIN = (window.CI_API_BASE || window.API_BASE || 'https://api.cityintelapi.com').replace(/\/+$/,'');
      const headers = (window.CIAuth && typeof CIAuth.headers === 'function') ? CIAuth.headers() : {};
      const res = await fetch(API_ORIGIN + '/api/org/onboarding', { headers });
      const json = await res.json().catch(() => ({}));
      const d = (json && json.ok && json.data) ? json.data : null;
      const branding = {
        tier: d?.whitelabelTier || 'none',
        logoUrl: d?.whitelabelLogoUrl || '',
        accentColor: d?.whitelabelAccentColor || '',
        displayName: d?.whitelabelDisplayName || ''
      };
      writeCache(branding);
      return branding;
    }catch(_){
      return { tier: 'none', logoUrl: '', accentColor: '', displayName: '' };
    }
  }

  function applyBranding(b){
    if (!b || b.tier !== 'cosmetic') return; // default tier — no changes at all

    // Logo swap
    if (b.logoUrl){
      document.querySelectorAll('.brandbar img').forEach(img => { img.src = b.logoUrl; });
    }

    // Display-name swap — brandbar text + document title. Matches the
    // literal word "CityIntel" rather than relying on a specific class
    // name, since that's varied slightly page to page.
    if (b.displayName){
      document.querySelectorAll('.brandbar > div').forEach(div => {
        if (div.id === 'topActions' || div.id === 'trial-banner') return;
        if (div.textContent.trim() === 'CityIntel') div.textContent = b.displayName;
      });
      if (document.title.indexOf('CityIntel') !== -1){
        document.title = document.title.replace(/CityIntel/g, b.displayName);
      }
    }

    // Accent colour — every page defines --brand-red once in :root, but in
    // practice almost none of the actual buttons/borders/hover-states/badges
    // reference that variable; they hardcode the literal #D01616 (and its
    // rgba(208,22,22,alpha) translucent variants for backgrounds/borders)
    // directly, dozens of times per page. Overriding the CSS variable alone
    // therefore has almost no visible effect. Instead: scan every accessible
    // stylesheet's rules (recursing into @media/@supports blocks), find any
    // rule with a property value containing the default red — as hex or as
    // its rgba equivalent — and re-emit just those properties, colour
    // swapped, with !important, under the same selector in a new stylesheet
    // appended after everything else. This catches every current occurrence
    // without needing a hand-maintained selector list, and !important
    // sidesteps any source-order/specificity edge cases.
    if (b.accentColor){
      const rootStyle = document.createElement('style');
      rootStyle.textContent = `:root{ --brand-red: ${b.accentColor}; }`;
      document.head.appendChild(rootStyle);

      const rgb = hexToRgb(b.accentColor);
      // Buttons/badges filled with the accent colour need text that stays
      // legible regardless of how light or dark the org's chosen colour is —
      // white text was fine against the default red, but would disappear
      // against a light accent. Forced only onto rules that actually fill a
      // background with the accent colour, not ones that just use it for a
      // border or a small text accent (those don't need a text-colour flip).
      const textColor = (rgb && relativeLuminance(rgb) > 150) ? '#111214' : '#ffffff';

      // Secondary shades confirmed (by reading support-widget.js directly)
      // to be pure UI decoration — hover/pressed/gradient states of the
      // support widget, nothing semantic. Each maps to a colour-map entry:
      // the literal shade -> the proportionally-derived equivalent in the
      // org's accent colour. Deliberately NOT extended to other reds seen
      // elsewhere on the platform (risk badges, panic alarm, etc.) since
      // those carry danger/severity meaning and must stay red regardless of
      // an org's branding colour.
      const BASE_RED = '#D01616';
      const colorMap = {}; // lowercase hex -> replacement hex
      colorMap['#d01616'] = b.accentColor.toLowerCase();
      ['#9c0f0f', '#7f1111', '#b21f1f', '#fca5a5'].forEach(shade => {
        colorMap[shade.toLowerCase()] = deriveShade(BASE_RED, shade, b.accentColor).toLowerCase();
      });
      // Same idea for the rgb-triple forms used in rgba(...) declarations.
      const rgbMap = {}; // "r,g,b" -> {r,g,b}
      rgbMap['208,22,22'] = rgb;
      [[248,113,113],[127,29,29]].forEach(([r,g,bl]) => {
        const derived = hexToRgb(deriveShade(BASE_RED, `#${[r,g,bl].map(v=>v.toString(16).padStart(2,'0')).join('')}`, b.accentColor));
        rgbMap[`${r},${g},${bl}`] = derived;
      });

      const HEX_ALT = Object.keys(colorMap).map(h => h.replace('#','')).join('|');
      const HEX_RE = new RegExp(`#(?:${HEX_ALT})`, 'ig');
      const RGB_ALT = Object.keys(rgbMap).map(t => t.split(',').map(n => `\\s*${n}\\s*`).join(',')).join('|');
      const RGBA_RE = new RegExp(`rgba?\\(\\s*(?:${RGB_ALT})\\s*(,\\s*[\\d.]+\\s*)?\\)`, 'ig');

      // Shared conversion used by both the stylesheet scan and the inline
      // scan — looks up which *specific* shade matched (not just "did it
      // match at all") so each one gets its own correctly-derived
      // replacement, not a single fixed colour applied everywhere.
      function convertColorString(val){
        let newVal = null;
        if (HEX_RE.test(val)) {
          newVal = val.replace(HEX_RE, m => colorMap[m.toLowerCase()] || m);
        }
        HEX_RE.lastIndex = 0;
        if (rgb && RGBA_RE.test(val)) {
          newVal = (newVal || val).replace(RGBA_RE, (m, alphaPart) => {
            const nums = m.match(/[\d.]+/g) || [];
            const key = `${nums[0]},${nums[1]},${nums[2]}`;
            const target = rgbMap[key] || rgb;
            return alphaPart ? `rgba(${target.r},${target.g},${target.b}${alphaPart})` : `rgb(${target.r},${target.g},${target.b})`;
          });
        }
        RGBA_RE.lastIndex = 0;
        return newVal;
      }

      // A single persistent override stylesheet, replaced (not appended-to)
      // on every re-scan — otherwise every subsequent scan (see the observer
      // below) would pile up duplicate rules forever.
      let overrideStyleEl = null;
      function scanAndOverrideStylesheets(){
        const overrides = [];
        function collectOverrides(rules){
          if (!rules) return;
          Array.from(rules).forEach(rule => {
            if (rule.cssRules) { collectOverrides(rule.cssRules); return; } // @media, @supports, etc.
            if (!rule.selectorText || !rule.style) return;
            const props = [];
            let touchesBackground = false;
            for (let i = 0; i < rule.style.length; i++){
              const prop = rule.style[i];
              const val = rule.style.getPropertyValue(prop);
              if (!val) continue;
              const newVal = convertColorString(val);
              RGBA_RE.lastIndex = 0;
              if (newVal) {
                props.push(`${prop}:${newVal} !important`);
                if (/^background/i.test(prop)) touchesBackground = true;
              }
            }
            if (props.length){
              if (touchesBackground) props.push(`color:${textColor} !important`);
              overrides.push(`${rule.selectorText}{${props.join(';')}}`);
            }
          });
        }

        Array.from(document.styleSheets).forEach(sheet => {
          if (sheet.ownerNode === overrideStyleEl) return; // don't scan our own output
          let rules;
          try { rules = sheet.cssRules || sheet.rules; } catch(_) { return; } // cross-origin sheets throw on read
          try { collectOverrides(rules); } catch(_){}
        });

        if (!overrides.length) return;
        if (!overrideStyleEl){
          overrideStyleEl = document.createElement('style');
          overrideStyleEl.id = 'ci-whitelabel-overrides';
          document.head.appendChild(overrideStyleEl);
        }
        overrideStyleEl.textContent = overrides.join('\n');
      }

      // Inline style="" attributes are invisible to document.styleSheets
      // entirely — they never appear in the CSSOM, so the scan above can't
      // reach them no matter how thorough it is. Several pages set the
      // brand red directly this way (e.g. executive-dashboard.html's
      // welcome-banner border/background). Handled as a direct string
      // replace on the attribute itself, which — being inline — already
      // has the highest possible specificity, so no !important needed here.
      function applyInlineOverrides(root){
        (root.querySelectorAll ? root.querySelectorAll('[style]') : []).forEach(el => {
          const raw = el.getAttribute('style');
          if (!raw) return;
          const newStyle = convertColorString(raw);
          if (!newStyle) return;
          el.setAttribute('style', newStyle);
          if (/background/i.test(raw)) el.style.setProperty('color', textColor, 'important');
        });
      }

      scanAndOverrideStylesheets();
      applyInlineOverrides(document);

      // Widgets that inject their own DOM and/or their own <style> tag after
      // page load — support-widget.js being the confirmed case, which
      // creates a stylesheet via document.createElement('style') on its own
      // DOMContentLoaded listener — can finish setting up *after* this
      // script's one-time scans above already ran, depending on <script>
      // tag order. A single one-time scan can miss it entirely. A debounced
      // MutationObserver re-runs BOTH the stylesheet scan and the inline
      // scan whenever new nodes show up, so a late-arriving stylesheet (not
      // just late-arriving inline styles) gets caught too. Re-processing
      // already-converted rules/elements is harmless — they no longer match
      // the red pattern, so they're simply skipped on later passes.
      let mutationTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
          scanAndOverrideStylesheets();
          applyInlineOverrides(document);
        }, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      observer.observe(document.head, { childList: true, subtree: true });
    }
  }

  function init(){
    fetchBranding().then(applyBranding);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
