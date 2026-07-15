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

    // Accent colour — every page defines --brand-red once in :root; a
    // later declaration here simply overrides it via normal CSS cascade,
    // so buttons/active-nav/etc. everywhere pick it up without per-rule edits.
    if (b.accentColor){
      const style = document.createElement('style');
      style.textContent = `:root{ --brand-red: ${b.accentColor}; }`;
      document.head.appendChild(style);
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
