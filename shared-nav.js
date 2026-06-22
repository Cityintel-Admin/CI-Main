/**
 * shared-nav.js — CityIntel sidebar navigation
 * Injects the full nav into <nav> inside <aside.sidebar> on every page.
 * Add/remove links here once and it updates every page automatically.
 *
 * Usage: <script src="shared-nav.js"></script> (after auth.js)
 * Requires: <aside class="sidebar"><div class="section-label"></div><nav></nav></aside>
 *
 * Role visibility:
 *  - masterAdmin links: shown only to CIAuth.isMasterAdmin()
 *  - orgAdmin links:    shown to CIAuth.isOrgAdmin() OR isMasterAdmin()
 *  - operator links:    shown to all authenticated users
 *
 * Module visibility:
 *  - Links tagged with data-module are hidden when that module is not in the
 *    org's enabled modules list (read from localStorage ci_org_onboarding cache).
 */

(function mountSharedNav() {

  // ── Nav definition ────────────────────────────────────────────────────────
  // role: 'all' | 'orgAdmin' | 'masterAdmin'
  // module: optional — hides link if module not enabled for org
  const NAV_LINKS = [
    // ── Core (all users) ────────────────────────────────────────────────────
    { href: 'index.html',               label: 'Dashboard',           role: 'all' },
    { href: 'cityintel-assistant.html', label: 'CityIntel AI',        role: 'all',       module: 'cityintel_ai' },
    { href: 'live-alerts.html',         label: 'Live Alerts',         role: 'all',       module: 'live_alerts' },
    { href: 'neighborhood-intel.html',  label: 'Neighbourhood Intel', role: 'all',       module: 'neighbourhood_intel' },
    { href: 'alerts.html',              label: 'High Risk Events',    role: 'all',       module: 'alerts' },
    { href: 'events.html',              label: 'All Events',          role: 'all',       module: 'all_events' },
    { href: 'brief.html',               label: 'Intelligence Brief',  role: 'all',       module: 'intelligence_brief' },
    { href: 'power-outages.html',       label: 'Power Outages',       role: 'all',       module: 'power_outages' },
    { href: 'transport-status.html',    label: 'Transport Status',    role: 'all',       module: 'transport_status' },
    { href: 'flight-status.html',       label: 'Flight Status',       role: 'all',       module: 'flight_status' },
    { href: 'reports.html',             label: 'Reports',             role: 'all',       module: 'reports' },
    { href: 'trends.html',              label: 'Trends & Forecasts',  role: 'all',       module: 'trends' },
    { href: 'welfare-hub.html',         label: 'Welfare Hub',         role: 'all',       module: 'Welfare Hub' },
    { href: 'training-scenario-admin.html', label: 'Training Admin',  role: 'orgAdmin' },
    { href: 'training-review.html',     label: 'Training Record',     role: 'all',       module: 'training_review' },
    { href: 'panicalarm.html',          label: 'Panic Alarm',         role: 'orgAdmin' },
    { href: 'assets.html',              label: 'Assets',              role: 'all',       module: 'assets' },
    { href: 'escalation-contacts.html', label: 'Escalation Contacts', role: 'orgAdmin' },
    // ── Info / support ──────────────────────────────────────────────────────
    { href: 'sources.html',             label: 'Sources',             role: 'all' },
    { href: 'settings.html',            label: 'Settings',            role: 'all' },
    { href: 'about.html',               label: 'About',               role: 'all' },
    // ── Master Admin only ────────────────────────────────────────────────────
    { href: 'analytics.html',           label: 'Analytics',           role: 'masterAdmin' },
    { href: 'operationslog.html',       label: 'Operations Log',      role: 'masterAdmin' },
    { href: 'system-flow.html',         label: 'System Flow',         role: 'masterAdmin' },
  ];

  // ── Read cached org config for module visibility ───────────────────────
  function getEnabledModules() {
    try {
      const cached = JSON.parse(localStorage.getItem('ci_org_onboarding') || 'null');
      if (cached && Array.isArray(cached.modules)) return cached.modules;
    } catch (_) {}
    return []; // empty = no restrictions
  }

  // ── Build and inject nav ─────────────────────────────────────────────────
  function run() {
    const nav = document.querySelector('aside.sidebar nav');
    if (!nav) return;

    const isMaster   = window.CIAuth && CIAuth.isMasterAdmin ? CIAuth.isMasterAdmin() : false;
    const isOrgAdmin = window.CIAuth && CIAuth.isOrgAdmin    ? CIAuth.isOrgAdmin()    : false;
    const modules    = getEnabledModules(); // [] = unrestricted

    const here = location.pathname.split('/').pop() || 'index.html';

    const html = NAV_LINKS
      .filter(link => {
        // Role gate
        if (link.role === 'masterAdmin' && !isMaster)              return false;
        if (link.role === 'orgAdmin'    && !isMaster && !isOrgAdmin) return false;
        // Module gate (only if org has explicit module list)
        if (link.module && modules.length > 0 && !modules.includes(link.module)) return false;
        return true;
      })
      .map(link => {
        const active = link.href === here ? ' class="active"' : '';
        return `<a href="${link.href}"${active}>${link.label}</a>`;
      })
      .join('\n');

    nav.innerHTML = html;
  }

  // Run after DOM ready and after CIAuth is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
