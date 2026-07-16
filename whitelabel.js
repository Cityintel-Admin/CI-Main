// ============================================================================
// whitelabel.js — Phase 1.1 (cosmetic tier only)
//
// Include this on any page, right after auth.js:
//   <script src="auth.js"></script>
//   <script src="whitelabel.js"></script>
//
// On DOMContentLoaded, fetches the logged-in user's org config (the same
// /api/org/onboarding endpoint every page already uses for module/tier
// gating) and — only if that org's whitelabel_tier is 'cosmetic' — applies:
//   - organisation logo to supported brand containers
//   - organisation display name to supported brand labels + document title
//   - organisation accent colour and a derived accent palette
//   - legacy CityIntel brand-red replacement in accessible stylesheets and
//     inline styles, including styles injected after initial page load
//
// Semantic status colours (danger/error/panic/warning/success) are deliberately
// NOT globally recoloured. Only the known CityIntel brand-red palette is
// replaced so operational risk states remain visually meaningful.
//
// Does nothing at all for orgs on the 'none' tier (the default) — no DOM or
// visual changes are applied.
//
// Known limitation: like the rest of this platform's client-side gating
// (module locks, tier banners), this runs after initial paint, so there can be
// a brief flash of default branding before the swap happens. Fixing that fully
// would require server-side/per-org shell rendering and is outside this phase.
// ============================================================================

(function(){
  'use strict';

  const CI_WL_CACHE_KEY = 'ci_whitelabel_cache_v1';
  const CI_WL_CACHE_TTL_MS = 5 * 60 * 1000;
  const THEME_STYLE_ID = 'ciWhiteLabelThemeVars';
  const OVERRIDE_STYLE_ID = 'ciWhiteLabelCssOverrides';

  function hexToRgb(hex){
    const m = String(hex || '').trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  function clampChannel(value){
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  function rgbToHex(rgb){
    const toHex = value => clampChannel(value).toString(16).padStart(2, '0');
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }

  function mixRgb(a, b, amount){
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    return {
      r: clampChannel(a.r + (b.r - a.r) * t),
      g: clampChannel(a.g + (b.g - a.g) * t),
      b: clampChannel(a.b + (b.b - a.b) * t)
    };
  }

  // Perceptual-weighted luminance — sufficient for choosing readable text on
  // solid accent fills without bringing in an additional colour library.
  function relativeLuminance(rgb){
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
  }

  function buildPalette(accentColor){
    const rgb = hexToRgb(accentColor);
    if (!rgb) return null;

    const black = { r: 0, g: 0, b: 0 };
    const darkRgb = mixRgb(rgb, black, 0.28);
    const darkerRgb = mixRgb(rgb, black, 0.48);
    const textColor = relativeLuminance(rgb) > 150 ? '#111214' : '#ffffff';

    return {
      accent: rgbToHex(rgb),
      rgb,
      dark: rgbToHex(darkRgb),
      darkRgb,
      darker: rgbToHex(darkerRgb),
      darkerRgb,
      text: textColor,
      soft: `rgba(${rgb.r},${rgb.g},${rgb.b},.14)`,
      softStrong: `rgba(${rgb.r},${rgb.g},${rgb.b},.28)`,
      softFaint: `rgba(${rgb.r},${rgb.g},${rgb.b},.04)`,
      border: `rgba(${rgb.r},${rgb.g},${rgb.b},.55)`,
      borderSoft: `rgba(${rgb.r},${rgb.g},${rgb.b},.42)`,
      focus: `rgba(${rgb.r},${rgb.g},${rgb.b},.65)`
    };
  }

  function readCache(){
    try{
      const raw = JSON.parse(localStorage.getItem(CI_WL_CACHE_KEY) || 'null');
      if (!raw || !raw.at || (Date.now() - raw.at) > CI_WL_CACHE_TTL_MS) return null;
      return raw.data || null;
    }catch(_){
      return null;
    }
  }

  function writeCache(data){
    try{
      localStorage.setItem(CI_WL_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    }catch(_){}
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

  function ensureStyle(id){
    let style = document.getElementById(id);
    if (!style){
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    return style;
  }

  function applyThemeVariables(palette){
    if (!palette) return;

    const style = ensureStyle(THEME_STYLE_ID);
    style.textContent = `
      :root{
        --brand-red:${palette.accent};
        --brand-accent:${palette.accent};
        --brand-accent-dark:${palette.dark};
        --brand-accent-darker:${palette.darker};
        --brand-accent-rgb:${palette.rgb.r},${palette.rgb.g},${palette.rgb.b};
        --brand-accent-soft:${palette.soft};
        --brand-accent-soft-strong:${palette.softStrong};
        --brand-accent-soft-faint:${palette.softFaint};
        --brand-accent-border:${palette.border};
        --brand-accent-border-soft:${palette.borderSoft};
        --brand-accent-focus:${palette.focus};
        --brand-accent-text:${palette.text};
      }
    `;
  }

  function applyBrandIdentity(b){
    if (!b) return;

    if (b.logoUrl){
      document.querySelectorAll('.brandbar img, .brand > img, [data-ci-brand-logo]').forEach(img => {
        img.src = b.logoUrl;
      });
    }

    if (b.displayName){
      const candidates = document.querySelectorAll(
        '.brandbar .title, .brandbar > div, .brand .title, .brand > div, .brand > span, [data-ci-brand-name]'
      );

      candidates.forEach(el => {
        if (el.id === 'topActions' || el.id === 'trial-banner') return;
        if (String(el.textContent || '').trim() === 'CityIntel') el.textContent = b.displayName;
      });

      if (document.title.indexOf('CityIntel') !== -1){
        document.title = document.title.replace(/CityIntel/g, b.displayName);
      }
    }

    if (b.accentColor){
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.setAttribute('content', b.accentColor);
    }
  }

  function replaceLegacyBrandColours(value, palette){
    if (!value || !palette) return { value, changed: false };

    let out = String(value);
    let changed = false;

    const replaceLiteral = (regex, replacement) => {
      out = out.replace(regex, () => {
        changed = true;
        return replacement;
      });
    };

    // Known CityIntel branding palette. These are intentionally limited to
    // branding reds and do not include semantic danger/error reds.
    replaceLiteral(/#D01616\b/ig, palette.accent);
    replaceLiteral(/#9C0F0F\b/ig, palette.dark);
    replaceLiteral(/#7F1111\b/ig, palette.darker);

    const replaceRgb = (regex, rgb) => {
      out = out.replace(regex, (match, alphaPart) => {
        changed = true;
        return alphaPart
          ? `rgba(${rgb.r},${rgb.g},${rgb.b}${alphaPart})`
          : `rgb(${rgb.r},${rgb.g},${rgb.b})`;
      });
    };

    replaceRgb(/rgba?\(\s*208\s*,\s*22\s*,\s*22\s*(,\s*[\d.]+\s*)?\)/ig, palette.rgb);
    replaceRgb(/rgba?\(\s*156\s*,\s*15\s*,\s*15\s*(,\s*[\d.]+\s*)?\)/ig, palette.darkRgb);
    replaceRgb(/rgba?\(\s*127\s*,\s*17\s*,\s*17\s*(,\s*[\d.]+\s*)?\)/ig, palette.darkerRgb);

    return { value: out, changed };
  }

  function collectOverrides(rules, palette, overrides){
    if (!rules) return;

    Array.from(rules).forEach(rule => {
      if (rule.cssRules){
        collectOverrides(rule.cssRules, palette, overrides);
        return;
      }
      if (!rule.selectorText || !rule.style) return;

      const props = [];
      let touchesBackground = false;

      for (let i = 0; i < rule.style.length; i++){
        const prop = rule.style[i];
        const val = rule.style.getPropertyValue(prop);
        if (!val) continue;

        const swapped = replaceLegacyBrandColours(val, palette);
        if (!swapped.changed) continue;

        props.push(`${prop}:${swapped.value} !important`);
        if (/^background/i.test(prop)) touchesBackground = true;
      }

      if (props.length){
        if (touchesBackground) props.push(`color:${palette.text} !important`);
        overrides.push(`${rule.selectorText}{${props.join(';')}}`);
      }
    });
  }

  function refreshCssOverrides(palette){
    if (!palette) return;

    const overrides = [];

    try{
      Array.from(document.styleSheets).forEach(sheet => {
        const owner = sheet.ownerNode;
        if (owner && (owner.id === THEME_STYLE_ID || owner.id === OVERRIDE_STYLE_ID)) return;

        let rules;
        try{
          rules = sheet.cssRules || sheet.rules;
        }catch(_){
          return; // Cross-origin stylesheets cannot be inspected via CSSOM.
        }

        collectOverrides(rules, palette, overrides);
      });
    }catch(_){}

    const overrideStyle = ensureStyle(OVERRIDE_STYLE_ID);
    overrideStyle.textContent = overrides.join('\n');
  }

  function applyInlineOverrides(root, palette){
    if (!root || !palette) return;

    const nodes = [];
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('style')) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll('[style]'));

    nodes.forEach(el => {
      const raw = el.getAttribute('style');
      if (!raw) return;

      const swapped = replaceLegacyBrandColours(raw, palette);
      if (!swapped.changed) return;

      el.setAttribute('style', swapped.value);
      if (/background/i.test(raw)) el.style.setProperty('color', palette.text, 'important');
    });
  }

  function watchDynamicContent(b, palette){
    let cssRefreshTimer = null;

    const scheduleCssRefresh = () => {
      clearTimeout(cssRefreshTimer);
      cssRefreshTimer = setTimeout(() => refreshCssOverrides(palette), 180);
    };

    const observer = new MutationObserver(mutations => {
      let shouldRefreshCss = false;
      let shouldRefreshIdentity = false;

      mutations.forEach(mutation => {
        const target = mutation.target;
        if (target && target.nodeType === 1 &&
            (target.id === THEME_STYLE_ID || target.id === OVERRIDE_STYLE_ID)) return;

        mutation.addedNodes.forEach(node => {
          if (!node || node.nodeType !== 1) return;
          if (node.id === THEME_STYLE_ID || node.id === OVERRIDE_STYLE_ID) return;

          applyInlineOverrides(node, palette);
          shouldRefreshIdentity = true;

          const isStylesheetNode = node.matches && (
            node.matches('style') || node.matches('link[rel~="stylesheet"]')
          );
          const containsStylesheetNode = node.querySelector && node.querySelector('style,link[rel~="stylesheet"]');

          if (isStylesheetNode || containsStylesheetNode){
            shouldRefreshCss = true;

            if (node.matches && node.matches('link[rel~="stylesheet"]')){
              node.addEventListener('load', scheduleCssRefresh, { once: true });
            }
          }
        });
      });

      if (shouldRefreshIdentity) applyBrandIdentity(b);
      if (shouldRefreshCss) scheduleCssRefresh();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function applyBranding(b){
    if (!b || b.tier !== 'cosmetic') return;

    applyBrandIdentity(b);

    if (!b.accentColor) return;

    const palette = buildPalette(b.accentColor);
    if (!palette) return;

    // Expose a read-only-style snapshot for other CityIntel components that
    // want to consume the active cosmetic theme without making another API
    // request. Components should still prefer the CSS variables where possible.
    window.CIWhiteLabel = Object.freeze({
      tier: b.tier,
      logoUrl: b.logoUrl || '',
      displayName: b.displayName || '',
      accentColor: palette.accent,
      palette: Object.freeze({ ...palette })
    });

    applyThemeVariables(palette);
    refreshCssOverrides(palette);
    applyInlineOverrides(document, palette);
    watchDynamicContent(b, palette);
  }

  function init(){
    fetchBranding().then(applyBranding);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
