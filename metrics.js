<!-- metrics.js -->

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
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function firstNonEmpty(){
    for (const v of arguments) {
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function readPossibleProfile(){
    const ciAuthUser = (() => {
      try { return (window.CIAuth && typeof CIAuth.who === 'function') ? (CIAuth.who() || {}) : {}; }
      catch { return {}; }
    })();

    const profileV1 = safeJson('cityintel.profile.v1', {});
    const ciUser = safeJson('ci_user', {});
    const ciProfile = safeJson('ci_profile', {});
    const orgProfile = safeJson('cityintel.orgProfile.v1', {});
    const currentOrg = safeJson('cityintel.currentOrg.v1', {});

    const email = firstNonEmpty(
      ciAuthUser.email,
      profileV1.email,
      ciUser.email,
      ciProfile.email,
      localStorage.getItem('ci_email'),
      localStorage.getItem('cityintel.email')
    ).toLowerCase();

    const name = firstNonEmpty(
      ciAuthUser.name,
      ciAuthUser.displayName,
      profileV1.displayName,
      profileV1.name,
      ciUser.name,
      ciProfile.name,
      email
    );

    const isMasterAdmin = (() => {
      try { if (window.CIAuth && typeof CIAuth.isMasterAdmin === 'function' && CIAuth.isMasterAdmin()) return true; } catch {}
      const roleText = firstNonEmpty(
        ciAuthUser.role,
        ciAuthUser.roleKey,
        profileV1.role,
        ciUser.role,
        ciProfile.role,
        localStorage.getItem('ci_role'),
        localStorage.getItem('cityintel.role')
      ).toLowerCase().replace(/[\s_-]+/g, '');
      return roleText.includes('masteradmin') || roleText === 'master';
    })();

    const orgId = firstNonEmpty(
      ciAuthUser.org_id,
      ciAuthUser.orgId,
      ciAuthUser.organisationId,
      ciAuthUser.organizationId,
      profileV1.org_id,
      profileV1.orgId,
      ciUser.org_id,
      ciUser.orgId,
      ciProfile.org_id,
      ciProfile.orgId,
      orgProfile.id,
      orgProfile.org_id,
      orgProfile.orgId,
      currentOrg.id,
      currentOrg.org_id,
      currentOrg.orgId,
      localStorage.getItem('ci_org_id'),
      localStorage.getItem('cityintel.orgId'),
      isMasterAdmin ? 'master-admin' : ''
    );

    const orgName = firstNonEmpty(
      ciAuthUser.org_name,
      ciAuthUser.orgName,
      ciAuthUser.organisationName,
      ciAuthUser.organizationName,
      profileV1.org_name,
      profileV1.orgName,
      ciUser.org_name,
      ciUser.orgName,
      ciProfile.org_name,
      ciProfile.orgName,
      orgProfile.name,
      orgProfile.org_name,
      orgProfile.orgName,
      currentOrg.name,
      currentOrg.org_name,
      currentOrg.orgName,
      localStorage.getItem('ci_org_name'),
      localStorage.getItem('cityintel.orgName'),
      isMasterAdmin ? 'CityIntel Master Admin' : ''
    );

    const userId = firstNonEmpty(
      ciAuthUser.id,
      ciAuthUser.user_id,
      ciAuthUser.userId,
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

    return { userId, orgId, orgName, email, name, isMasterAdmin };
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
      page: currentPage()
    };
  }

  async function sendHeartbeat(){
    const body = heartbeatPayload();
    if (!body.user_id || !body.org_id) return false;

    const jsonBody = JSON.stringify(body);
    const url = `${API_BASE}${HEARTBEAT_PATH}`;

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([jsonBody], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return true;
      }
    } catch (_) {}

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: jsonBody,
        keepalive: true
      });
      return true;
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
    // Utility for analytics page
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

