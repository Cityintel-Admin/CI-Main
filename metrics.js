// metrics.js
// CityIntel client-side metrics + live-session heartbeat
(function(){
  const KEY = 'ci_metrics_events';
  const API_BASE = (window.CI_API_BASE || window.API_BASE || 'https://api.cityintelapi.com').replace(/\/+$/, '');
  const HEARTBEAT_PATH = '/api/admin/heartbeat';
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;
  const HEARTBEAT_RETRY_MS = 2500;
  const HEARTBEAT_MAX_BOOT_WAIT_MS = 15000;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }

  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {}
  }

  function nowISO(){ return new Date().toISOString(); }

  function safeJson(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function firstNonEmpty(){
    for (const v of arguments) {
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function ciAuthUser(){
    try { return (window.CIAuth && typeof CIAuth.who === 'function') ? (CIAuth.who() || {}) : {}; }
    catch { return {}; }
  }

  function isMasterAdminFromAnywhere(authUser, profileV1, ciUser, ciProfile){
    try { if (window.CIAuth && typeof CIAuth.isMasterAdmin === 'function' && CIAuth.isMasterAdmin()) return true; } catch {}
    const roleText = firstNonEmpty(
      authUser.role,
      authUser.roleKey,
      authUser.role_key,
      profileV1.role,
      profileV1.roleKey,
      ciUser.role,
      ciUser.roleKey,
      ciProfile.role,
      ciProfile.roleKey,
      localStorage.getItem('ci_role'),
      localStorage.getItem('cityintel.role')
    ).toLowerCase().replace(/[\s_-]+/g, '');
    return roleText.includes('masteradmin') || roleText === 'master';
  }

  function readPossibleProfile(){
    const authUser = ciAuthUser();
    const profileV1 = safeJson('cityintel.profile.v1', {});
    const ciUser = safeJson('ci_user', {});
    const ciProfile = safeJson('ci_profile', {});
    const orgProfile = safeJson('cityintel.orgProfile.v1', {});
    const currentOrg = safeJson('cityintel.currentOrg.v1', {});
    const orgSettings = safeJson('cityintel.orgSettings.v1', {});

    const email = firstNonEmpty(
      authUser.email,
      authUser.user_email,
      profileV1.email,
      ciUser.email,
      ciProfile.email,
      localStorage.getItem('ci_email'),
      localStorage.getItem('cityintel.email')
    ).toLowerCase();

    const name = firstNonEmpty(
      authUser.name,
      authUser.displayName,
      authUser.display_name,
      profileV1.displayName,
      profileV1.display_name,
      profileV1.name,
      ciUser.name,
      ciUser.displayName,
      ciProfile.name,
      ciProfile.displayName,
      email
    );

    const isMasterAdmin = isMasterAdminFromAnywhere(authUser, profileV1, ciUser, ciProfile);

    const orgId = firstNonEmpty(
      authUser.org_id,
      authUser.orgId,
      authUser.organisation_id,
      authUser.organisationId,
      authUser.organization_id,
      authUser.organizationId,
      profileV1.org_id,
      profileV1.orgId,
      profileV1.organisation_id,
      profileV1.organisationId,
      ciUser.org_id,
      ciUser.orgId,
      ciUser.organisation_id,
      ciUser.organisationId,
      ciProfile.org_id,
      ciProfile.orgId,
      ciProfile.organisation_id,
      ciProfile.organisationId,
      orgProfile.id,
      orgProfile.org_id,
      orgProfile.orgId,
      currentOrg.id,
      currentOrg.org_id,
      currentOrg.orgId,
      orgSettings.id,
      orgSettings.org_id,
      orgSettings.orgId,
      localStorage.getItem('ci_org_id'),
      localStorage.getItem('cityintel.orgId'),
      isMasterAdmin ? 'master-admin' : ''
    );

    const orgName = firstNonEmpty(
      authUser.org_name,
      authUser.orgName,
      authUser.organisation_name,
      authUser.organisationName,
      authUser.organization_name,
      authUser.organizationName,
      profileV1.org_name,
      profileV1.orgName,
      profileV1.organisation_name,
      profileV1.organisationName,
      ciUser.org_name,
      ciUser.orgName,
      ciUser.organisation_name,
      ciUser.organisationName,
      ciProfile.org_name,
      ciProfile.orgName,
      ciProfile.organisation_name,
      ciProfile.organisationName,
      orgProfile.name,
      orgProfile.org_name,
      orgProfile.orgName,
      currentOrg.name,
      currentOrg.org_name,
      currentOrg.orgName,
      orgSettings.name,
      orgSettings.org_name,
      orgSettings.orgName,
      localStorage.getItem('ci_org_name'),
      localStorage.getItem('cityintel.orgName'),
      isMasterAdmin ? 'CityIntel Master Admin' : ''
    );

    const userId = firstNonEmpty(
      authUser.id,
      authUser.user_id,
      authUser.userId,
      profileV1.id,
      profileV1.user_id,
      profileV1.userId,
      ciUser.id,
      ciUser.user_id,
      ciUser.userId,
      ciProfile.id,
      ciProfile.user_id,
      ciProfile.userId,
      localStorage.getItem('ci_user_id'),
      localStorage.getItem('cityintel.userId'),
      email,
      isMasterAdmin ? 'master-admin' : ''
    );

    const role = firstNonEmpty(
      authUser.role,
      authUser.roleKey,
      authUser.role_key,
      profileV1.role,
      profileV1.roleKey,
      ciUser.role,
      ciUser.roleKey,
      ciProfile.role,
      ciProfile.roleKey,
      isMasterAdmin ? 'MasterAdmin' : ''
    );

    return { userId, orgId, orgName, email, name, role, isMasterAdmin };
  }

  function currentPage(){
    try {
      const p = location.pathname.split('/').pop() || 'index.html';
      return p || 'index.html';
    } catch { return ''; }
  }

  function heartbeatPayload(){
    const p = readPossibleProfile();
    return {
      user_id: p.userId,
      org_id: p.orgId,
      org_name: p.orgName,
      email: p.email,
      name: p.name,
      role: p.role,
      is_master_admin: !!p.isMasterAdmin,
      page: currentPage()
    };
  }

  function heartbeatHeaders(payload){
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (payload.email) h['X-User-Email'] = payload.email;
    if (payload.name) h['X-User-Name'] = payload.name;
    if (payload.user_id) h['X-User-Id'] = payload.user_id;
    if (payload.role) h['X-User-Role'] = payload.role;
    if (payload.is_master_admin) h['X-User-Role'] = 'MasterAdmin';
    if (payload.org_id) h['X-Org-Id'] = payload.org_id;
    return h;
  }

  async function sendHeartbeat(){
    const body = heartbeatPayload();

    // Do not attempt a blank anonymous heartbeat.
    if (!body.user_id && !body.email && !body.name) return false;

    const url = `${API_BASE}${HEARTBEAT_PATH}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: heartbeatHeaders(body),
        body: JSON.stringify(body),
        keepalive: true
      });
      return !!res.ok;
    } catch (_) {
      return false;
    }
  }

  function startHeartbeat(){
    const startedAt = Date.now();

    async function bootAttempt(){
      const ok = await sendHeartbeat();
      if (!ok && Date.now() - startedAt < HEARTBEAT_MAX_BOOT_WAIT_MS) {
        setTimeout(bootAttempt, HEARTBEAT_RETRY_MS);
      }
    }

    bootAttempt();
    setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sendHeartbeat();
    });

    window.addEventListener('focus', sendHeartbeat);
    window.addEventListener('pagehide', sendHeartbeat);
  }

  // --- Public API ---
  const CIMetrics = {
    logVisit() {
      const ev = { type:'visit', ts: nowISO(), page: currentPage() };
      const list = read(); list.push(ev); write(list);
    },
    logSubscribe({ email, plan }) {
      const ev = { type:'subscribe', ts: nowISO(), email: (email||'').toLowerCase(), plan: (plan==='paid'?'paid':'trial') };
      const list = read(); list.push(ev); write(list);
    },
    logCancel({ email }) {
      const ev = { type:'cancel', ts: nowISO(), email: (email||'').toLowerCase() };
      const list = read(); list.push(ev); write(list);
    },
    sendHeartbeat,
    getHeartbeatPayload: heartbeatPayload,
    getEvents() { return read(); }
  };

  window.CIMetrics = CIMetrics;

  try { CIMetrics.logVisit(); } catch(e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startHeartbeat, { once: true });
  } else {
    startHeartbeat();
  }
})();
