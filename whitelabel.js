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
      const style = document.createElement('style');
      style.textContent = `:root{ --brand-red: ${b.accentColor}; }`;
      document.head.appendChild(style);

      const rgb = hexToRgb(b.accentColor);
      // Buttons/badges filled with the accent colour need text that stays
      // legible regardless of how light or dark the org's chosen colour is —
      // white text was fine against the default red, but would disappear
      // against a light accent. Forced only onto rules that actually fill a
      // background with the accent colour, not ones that just use it for a
      // border or a small text accent (those don't need a text-colour flip).
      const textColor = (rgb && relativeLuminance(rgb) > 150) ? '#111214' : '#ffffff';
      const overrides = [];
      const HEX_RE = /#D01616/ig;
      // Matches rgba(208,22,22, <alpha>) and rgb(208,22,22) with flexible whitespace.
      const RGBA_RE = /rgba?\(\s*208\s*,\s*22\s*,\s*22\s*(,\s*[\d.]+\s*)?\)/ig;

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
            let newVal = null;
            if (HEX_RE.test(val)) newVal = val.replace(HEX_RE, b.accentColor);
            HEX_RE.lastIndex = 0;
            if (rgb && RGBA_RE.test(val)) {
              newVal = (newVal || val).replace(RGBA_RE, (m, alphaPart) => {
                return alphaPart ? `rgba(${rgb.r},${rgb.g},${rgb.b}${alphaPart})` : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
              });
            }
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

      try {
        Array.from(document.styleSheets).forEach(sheet => {
          let rules;
          try { rules = sheet.cssRules || sheet.rules; } catch(_) { return; } // cross-origin sheets throw on read
          collectOverrides(rules);
        });
      } catch(_){}

      if (overrides.length){
        const overrideStyle = document.createElement('style');
        overrideStyle.textContent = overrides.join('\n');
        document.head.appendChild(overrideStyle);
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
          const hasHex = HEX_RE.test(raw); HEX_RE.lastIndex = 0;
          const hasRgba = !!(rgb && RGBA_RE.test(raw)); RGBA_RE.lastIndex = 0;
          if (!hasHex && !hasRgba) return;
          let newStyle = raw.replace(HEX_RE, b.accentColor); HEX_RE.lastIndex = 0;
          if (rgb){
            newStyle = newStyle.replace(RGBA_RE, (m, alphaPart) => {
              return alphaPart ? `rgba(${rgb.r},${rgb.g},${rgb.b}${alphaPart})` : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
            });
            RGBA_RE.lastIndex = 0;
          }
          el.setAttribute('style', newStyle);
          if (/background/i.test(raw)) el.style.setProperty('color', textColor, 'important');
        });
      }
      applyInlineOverrides(document);

      // Widgets that inject their own DOM after page load (support-widget.js
      // being the known case — it's a separate script, loaded and rendered
      // independently of this one) can add fresh inline-styled elements
      // *after* the pass above already ran, so they'd be missed on a single
      // one-time scan. A debounced MutationObserver re-applies the inline
      // scan whenever new nodes show up. Re-processing already-converted
      // elements is harmless — their style no longer matches the red
      // pattern, so they're simply skipped on subsequent passes.
      let mutationTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => applyInlineOverrides(document), 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
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
