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
 * Hub scoping:
 *  - Each hub has a landing link + a list of member pages.
 *  - The hub landing link always shows (if its module is enabled).
 *  - A hub's member links only show when the current page IS that hub's
 *    landing page or one of its own members — i.e. you only ever see one
 *    hub "expanded" at a time, keeping the list short.
 *  - module keys below are taken directly from analytics.html's
 *    data-module / data-hub-member checkbox grid, so they stay in sync
 *    with what onboarding actually saves.
 */

(function mountSharedNav() {

  // ── Standalone links (no hub, always visible if role allows) ───────────
  const TOP_LINKS = [
    { href: 'dashboard.html', label: 'Dashboard', role: 'all' },
  ];

  // ── Hub groups ───────────────────────────────────────────────────────────
  // hub: the hub landing page itself (its own checkbox in analytics.html)
  // members: sub-pages that only show when this hub is "active"
  //
  // Filenames below confirmed against the actual repo file list. Two
  // orphaned checkboxes found in analytics.html that don't map to any real
  // page at all (high_risk_events, and the 'training' scenarios checkbox) —
  // see inline notes near Intel Hub and Training Hub below.
  const HUBS = [
    {
      hub: { href: 'monitoring-hub.html', label: 'Monitoring Hub', module: 'monitoring_hub' },
      members: [
        { href: 'live-alerts.html',       label: 'Live Alerts',         module: 'live_alerts' },
        { href: 'alerts.html',            label: 'Alerts Feed',         module: 'alerts' },
        { href: 'neighborhood-intel.html', label: 'Neighbourhood Intel', module: 'neighbourhood_intel' }, // repo file uses US spelling; label kept UK for display
        { href: 'cityintel-assistant.html', label: 'CityIntel AI',      module: 'cityintel_ai' },
      ]
    },
    {
      hub: { href: 'intel-hub.html', label: 'Intel Hub', module: 'intel_hub' },
      members: [
        { href: 'brief.html',             label: 'Intelligence Brief', module: 'intelligence_brief' },
        { href: 'reports.html',           label: 'Reports',            module: 'reports' },
        { href: 'trends.html',            label: 'Trends & Forecasts', module: 'trends' },
        { href: 'events.html',            label: 'All Events',         module: 'all_events' },          // being retired in favour of alerts.html — see chat note
        // 'high_risk_events' checkbox exists in analytics.html but no high-risk-events.html
        // page exists in the repo — link omitted rather than pointing at a 404.
        // Flagging for you: this module currently gates nothing.
      ]
    },
    {
      hub: { href: 'welfare-hub.html', label: 'Welfare Hub', module: 'welfare_hub' },
      members: [
        { href: 'travellers.html',        label: 'Travellers',         module: 'travellers' },
        { href: 'checkin.html',           label: 'Check-in Manager',   module: 'check_in_manager' },
        { href: 'tracking.html',          label: 'Welfare Track',      module: 'traveller_tracking' },
        { href: 'panicalarm.html',        label: 'Panic Alarm',        module: 'panic_alarm' },
        { href: 'escalation-contacts.html', label: 'Escalation Contacts', module: 'escalation_contacts' },
      ]
    },
    {
      hub: { href: 'travel-infrastructure.html', label: 'Travel & Infrastructure Hub', module: 'travel_infrastructure' },
      members: [
        { href: 'flight-status.html',     label: 'Flight Status',      module: 'flight_status' },
        { href: 'transport-status.html',  label: 'Transport Status',   module: 'transport_status' },
        { href: 'power-outages.html',     label: 'Power Outages',      module: 'power_outages' },
        { href: 'environmental-intel.html', label: 'Environmental Intelligence', module: 'environmental_intel' },
        { href: 'maritime-intel.html',    label: 'Maritime Intel',     module: 'maritime_intel' },
        { href: 'assets.html',            label: 'Assets',             module: 'assets' },
        // NOTE: 'travellers' is also checked under this hub in analytics.html
        // (dual-membership, same shape as the old Travellers sync case). Not
        // repeating travellers.html here — treated as belonging to Welfare
        // Hub for nav purposes. Flag if you want it navigable from here too.
      ]
    },
    {
      hub: { href: 'executive-dashboard.html', label: 'Executive Dashboard', module: 'executive_dashboard' },
      members: [
        { href: 'operations-cases.html',  label: 'Operations Cases',   module: 'operations_cases' },
        { href: 'operations-tasks.html',  label: 'Operations Tasks',   module: 'operations_tasks' },
        { href: 'notification-centre.html', label: 'Notification Centre', module: 'notification_centre' },
      ]
    },
    {
      hub: { href: 'training-hub.html', label: 'Training Hub', module: 'training_hub' },
      members: [
        // 'training' checkbox ("Training Scenarios") exists in analytics.html but no
        // matching page exists in the repo — omitted rather than linking to a 404.
        // Flagging for you: this module currently gates nothing either.
        { href: 'training-review.html',   label: 'Training Review',    module: 'training_review' },
        { href: 'training-scenario-admin.html', label: 'Scenario Admin', module: 'training_scenario_admin' },
      ]
    },
  ];

  // ── Footer / support links (no module gate) ─────────────────────────────
  const FOOTER_LINKS = [
    { href: 'sources.html',  label: 'Sources',  role: 'all' },
    { href: 'settings.html', label: 'Settings', role: 'all' },
    { href: 'about.html',    label: 'About',    role: 'all' },
  ];

  // ── Master Admin only ─────────────────────────────────────────────────
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
    return []; // empty = no restrictions
  }

  function moduleAllowed(modules, moduleKey) {
    if (!moduleKey) return true;
    if (modules.length === 0) return true; // no restrictions configured
    return modules.includes(moduleKey);
  }

  function linkHtml(link, here) {
    const active = link.href === here ? ' class="active"' : '';
    return `<a href="${link.href}"${active}>${link.label}</a>`;
  }

  function subLinkHtml(link, here) {
    const active = link.href === here ? ' class="active nav-sub"' : ' class="nav-sub"';
    return `<a href="${link.href}"${active}>${link.label}</a>`;
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

    const parts = [];

    // Top-level standalone links
    TOP_LINKS.forEach(link => {
      if (roleOk(link)) parts.push(linkHtml(link, here));
    });

    // Hub groups
    HUBS.forEach(group => {
      const hubLink = group.hub;
      if (!moduleAllowed(modules, hubLink.module)) return; // hub itself disabled — skip entirely

      parts.push(linkHtml(hubLink, here));

      // Is the current page this hub's landing page or one of its own members?
      const memberHrefs = group.members.map(m => m.href);
      const isCurrentHub = (here === hubLink.href) || memberHrefs.includes(here);

      if (isCurrentHub) {
        group.members.forEach(member => {
          if (moduleAllowed(modules, member.module)) {
            parts.push(subLinkHtml(member, here));
          }
        });
      }
    });

    // Footer + master-only
    FOOTER_LINKS.forEach(link => { if (roleOk(link)) parts.push(linkHtml(link, here)); });
    MASTER_LINKS.forEach(link => { if (roleOk(link)) parts.push(linkHtml(link, here)); });

    nav.innerHTML = parts.join('\n');
  }

  // Run after DOM ready and after CIAuth is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
