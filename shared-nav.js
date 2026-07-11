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
 *  - Links tagged with `module` are hidden when that module is not in the
 *    org's enabled modules list (read from localStorage ci_org_onboarding cache).
 *
 * Nav shape (deliberately kept short):
 *  - Executive Dashboard is the fixed "home" — it's the one link that always
 *    shows, everywhere, as the way back to switch hubs.
 *  - HOME page (executive-dashboard.html / dashboard.html): shows Executive
 *    Dashboard (expanded with its own members) + every other hub's landing
 *    link (collapsed) + Sources/Settings/About + master-only links.
 *  - Inside any OTHER hub (its landing page or one of its own members):
 *    shows only that hub's own family (landing + members) + the single
 *    Executive Dashboard link. No other hubs, no footer, no master links.
 *  - Any page belonging to no hub and not home (Sources/Settings/About,
 *    Analytics/Operations Log/System Flow): shows only the Executive
 *    Dashboard link. (Assumption — flag if you want these treated
 *    differently.)
 */

(function mountSharedNav() {

  // ── Home / hub-switcher ─────────────────────────────────────────────────
  // Executive Dashboard doubles as: (a) the fixed "home" link shown on every
  // page, and (b) its own hub-family (Operations Cases/Tasks/Notification
  // Centre) which only expands when you're actually on one of these pages.
  const HOME = {
    hub: { href: 'executive-dashboard.html', label: 'Executive Dashboard', module: 'executive_dashboard' },
    members: [
      { href: 'operations-cases.html',    label: 'Operations Cases',    module: 'operations_cases' },
      { href: 'protest-hub.html',         label: 'Protest-Hub',         },
      { href: 'operations-tasks.html',    label: 'Operations Tasks',    module: 'operations_tasks' },
      { href: 'notification-centre.html', label: 'Notification Centre', module: 'notification_centre' },
    ]
  };

  // dashboard.html is legacy — currently still acts as home too, until it's
  // retired once the Protest Hub work lands. Remove this once that happens.
  const LEGACY_HOME_PAGES = ['executive-dashboard'];

  // ── Standalone pages ─────────────────────────────────────────────────────
  // These modules can belong to different hub packages depending on how an
  // org's plan is put together (e.g. Assets/Travellers might be sold as an
  // addon independent of which hub the org has), so rather than force them
  // under one hub's nav family, they show as their own always-visible links
  // — same visibility rule as Executive Dashboard: shown from anywhere,
  // regardless of which hub (if any) you're currently in.
  const STANDALONE = [
    { href: 'assets.html',              label: 'Assets',              module: 'assets' },
    { href: 'travellers.html',          label: 'Travellers',          module: 'travellers' },
    { href: 'neighborhood-intel.html',  label: 'Neighbourhood Intel', module: 'neighbourhood_intel' },
  ];

  // ── Hub groups (fixed priority order for the landing/home view) ────────
  const HUBS = [
    {
      hub: { href: 'monitoring-hub.html', label: 'Monitoring Hub', module: 'monitoring_hub' },
      members: [
        { href: 'live-alerts.html',        label: 'Live Alerts',         module: 'live_alerts' },
        { href: 'alerts.html',             label: 'Alerts Feed',         module: 'alerts' },
        { href: 'cityintel-assistant.html', label: 'CityIntel AI',      module: 'cityintel_ai' },
        // Neighbourhood Intel moved to STANDALONE — see above.
      ]
    },
    {
      hub: { href: 'intel-hub.html', label: 'Intel Hub', module: 'intel_hub' },
      members: [
        { href: 'brief.html',  label: 'Intelligence Brief', module: 'intelligence_brief' },
        { href: 'reports.html', label: 'Reports',           module: 'reports' },
        { href: 'trends.html', label: 'Trends & Forecasts', module: 'trends' },
        { href: 'events.html', label: 'All Events',         module: 'all_events' }, // being retired in favour of alerts.html
        // 'high_risk_events' checkbox exists in analytics.html but no page
        // exists for it yet — omitted rather than linking to a 404.
      ]
    },
    {
      hub: { href: 'welfare-hub.html', label: 'Welfare Hub', module: 'welfare_hub' },
      members: [
        { href: 'checkin.html',             label: 'Check-in Manager',    module: 'check_in_manager' },
        { href: 'tracking.html',            label: 'Welfare Track',       module: 'traveller_tracking' },
        { href: 'panicalarm.html',          label: 'Panic Alarm',         module: 'panic_alarm' },
        { href: 'escalation-contacts.html', label: 'Escalation Contacts', module: 'escalation_contacts' },
        // Travellers moved to STANDALONE — see above.
      ]
    },
    {
      hub: { href: 'travel-infrastructure.html', label: 'Travel & Infrastructure Hub', module: 'travel_infrastructure' },
      members: [
        { href: 'flight-status.html',       label: 'Flight Status',      module: 'flight_status' },
        { href: 'transport-status.html',    label: 'Transport Status',   module: 'transport_status' },
        { href: 'power-outages.html',       label: 'Power Outages',      module: 'power_outages' },
        { href: 'environmental-intel.html', label: 'Environmental Intelligence', module: 'environmental_intel' },
        { href: 'maritime-intel.html',      label: 'Maritime Intel',     module: 'maritime_intel' },
        // Assets moved to STANDALONE — see above.
      ]
    },
    {
      hub: { href: 'training-hub.html', label: 'Training Hub', module: 'training_hub' },
      members: [
        // 'training' checkbox ("Training Scenarios") exists in analytics.html
        // but has no matching page — likely folded into Scenario Admin per
        // your note. Omitted.
        { href: 'training-review.html',         label: 'Training Review', module: 'training_review' },
        { href: 'training-scenario-admin.html', label: 'Scenario Admin',  module: 'training_scenario_admin' },
      ]
    },
  ];

  // ── Footer / support links — home page only ─────────────────────────────
  const FOOTER_LINKS = [
    { href: 'sources.html',  label: 'Sources',  role: 'all' },
    { href: 'settings.html', label: 'Settings', role: 'all' },
    { href: 'about.html',    label: 'About',    role: 'all' },
  ];

  // ── Master Admin only — home page only ─────────────────────────────────
  const MASTER_LINKS = [
    { href: 'analytics.html',     label: 'Analytics',      role: 'masterAdmin' },
    { href: 'operationslog.html', label: 'Operations Log', role: 'masterAdmin' },
    { href: 'system-flow.html',   label: 'System Flow',    role: 'masterAdmin' },
  ];

  // ── Read cached org config for module visibility ───────────────────────
  function getEnabledModules() {
    try {
      const cached = JSON.parse(localStorage.getItem('ci_org_onboarding') || 'null');
      if (cached && Array.isArray(cached.modules)) return cached.modules;
    } catch (_) {}
    return []; // never cached, or malformed — treated as "never loaded" below
  }

  // Has this browser ever actually cached a real org config? Set at login
  // (auth.js). Distinguishes "genuinely no modules enabled" from "config
  // hasn't loaded yet" — both look like an empty modules array otherwise.
  function hasLoadedOrgConfigEver() {
    try {
      const raw = localStorage.getItem('ci_org_onboarding');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!(parsed && typeof parsed === 'object');
    } catch (_) { return false; }
  }

  function moduleAllowed(modules, moduleKey) {
    if (!moduleKey) return true;
    if (modules.length === 0) return !hasLoadedOrgConfigEver();
    return modules.includes(moduleKey);
  }

  function linkHtml(link, here, extraClass) {
    const classes = [];
    if (link.href === here) classes.push('active');
    if (extraClass) classes.push(extraClass);
    const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<a href="${link.href}"${cls}>${link.label}</a>`;
  }

  // ── Build and inject nav ─────────────────────────────────────────────────
  function run() {
    const nav = document.querySelector('aside.sidebar nav');
    if (!nav) return;

    const isMaster   = window.CIAuth && CIAuth.isMasterAdmin ? CIAuth.isMasterAdmin() : false;
    const isOrgAdmin = window.CIAuth && CIAuth.isOrgAdmin    ? CIAuth.isOrgAdmin()    : false;
    const modules    = getEnabledModules(); // [] = unrestricted
    const here       = location.pathname.split('/').pop() || 'index.html';

    const roleOk = (link) => {
      if (link.role === 'masterAdmin' && !isMaster) return false;
      if (link.role === 'orgAdmin' && !isMaster && !isOrgAdmin) return false;
      return true;
    };

    const homeMemberHrefs = HOME.members.map(m => m.href);
    const isHome = (here === HOME.hub.href) || LEGACY_HOME_PAGES.includes(here) || homeMemberHrefs.includes(here);

    const parts = [];

    if (isHome) {
      // ── Full landing view ────────────────────────────────────────────
      if (moduleAllowed(modules, HOME.hub.module)) {
        parts.push(linkHtml(HOME.hub, here));
        HOME.members.forEach(member => {
          if (moduleAllowed(modules, member.module)) parts.push(linkHtml(member, here, 'nav-sub'));
        });
      }

      STANDALONE.forEach(page => {
        if (moduleAllowed(modules, page.module)) parts.push(linkHtml(page, here));
      });

      HUBS.forEach(group => {
        if (moduleAllowed(modules, group.hub.module)) parts.push(linkHtml(group.hub, here));
      });

      FOOTER_LINKS.forEach(link => { if (roleOk(link)) parts.push(linkHtml(link, here)); });
      MASTER_LINKS.forEach(link => { if (roleOk(link)) parts.push(linkHtml(link, here)); });

    } else {
      // ── Find which hub (if any) owns the current page ───────────────
      const currentGroup = HUBS.find(group => {
        const memberHrefs = group.members.map(m => m.href);
        return (here === group.hub.href) || memberHrefs.includes(here);
      });

      if (currentGroup) {
        // Inside a hub: show only this hub's own family + the way home.
        if (moduleAllowed(modules, currentGroup.hub.module)) {
          parts.push(linkHtml(currentGroup.hub, here));
          currentGroup.members.forEach(member => {
            if (moduleAllowed(modules, member.module)) parts.push(linkHtml(member, here, 'nav-sub'));
          });
        }
      }

      // Always show the way home, even from pages belonging to no hub
      // (Sources/Settings/About/Analytics/etc) — standalone pages get the
      // same always-visible treatment, right alongside it.
      if (moduleAllowed(modules, HOME.hub.module)) {
        parts.push(linkHtml(HOME.hub, here));
      }
      STANDALONE.forEach(page => {
        if (moduleAllowed(modules, page.module)) parts.push(linkHtml(page, here));
      });
    }

    nav.innerHTML = parts.join('\n');
  }

  // Run after DOM ready and after CIAuth is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
