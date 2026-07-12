/**
 * CityIntel Auth (frontend-only; swap to real backend later)
 * Stores: ci_user, ci_token, ci_subscribed, ci_plan in localStorage
 * Compatibility:
 * - legacy role string 'Admin' is preserved for internal master accounts so existing pages keep working
 * - new roleKey values: 'master-admin' | 'org-admin' | 'operator'
 */
(function (window) {
  // ------------- LS helpers -------------
  const LS = {
    get: (k, def = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: (k)    => localStorage.removeItem(k),
  };

  // ------------- Crypto helper -------------
  async function sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // NOTE: the hardcoded local USERS table (with real admin emails and
  // password hashes) that used to live here has been removed. It was left
  // over from before /api/auth/login existed on the real backend — login()
  // below has called the real backend for a while now and never referenced
  // USERS, so it was dead code shipping admin credentials in a client-side
  // file for no reason. Deleted rather than fixed in place.

  // ------------- Role / capability model -------------
  const ROLE_CAPABILITIES = {
    'master-admin': {
      canViewDashboard: true,
      canViewAlerts: true,
      canViewEvents: true,
      canViewLiveAlerts: true,
      canViewIncident: true,
      canViewBrief: true,
      canViewTrends: true,
      canViewReports: true,
      canViewAssets: true,
      canViewTravellers: true,
      canViewSources: true,
      canViewAnalytics: true,
      canViewOperationsLog: true,
      canViewSystemFlow: true,
      canManageAssets: true,
      canManageTravellers: true,
      canPublishReports: true,
      canTriageAlerts: true,
      canManageOrgData: true,
      canManageUsers: true
    },
    'org-admin': {
      canViewDashboard: true,
      canViewAlerts: true,
      canViewEvents: true,
      canViewLiveAlerts: true,
      canViewIncident: true,
      canViewBrief: true,
      canViewTrends: true,
      canViewReports: true,
      canViewAssets: true,
      canViewTravellers: true,
      canViewSources: false,
      canViewAnalytics: false,
      canViewOperationsLog: false,
      canViewSystemFlow: false,
      canManageAssets: true,
      canManageTravellers: true,
      canPublishReports: true,
      canTriageAlerts: true,
      canManageOrgData: true,
      canManageUsers: false
    },
    'operator': {
      canViewDashboard: true,
      canViewAlerts: true,
      canViewEvents: true,
      canViewLiveAlerts: true,
      canViewIncident: true,
      canViewBrief: true,
      canViewTrends: true,
      canViewReports: true,
      canViewAssets: false,
      canViewTravellers: false,
      canViewSources: false,
      canViewAnalytics: false,
      canViewOperationsLog: false,
      canViewSystemFlow: false,
      canManageAssets: false,
      canManageTravellers: false,
      canPublishReports: false,
      canTriageAlerts: true,
      canManageOrgData: false,
      canManageUsers: false
    }
  };

  // ------------- Utilities -------------
  function isValidEmail(s = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }
  // Used only if the backend didn't return a real session token (e.g. the
  // Worker's SESSION_SECRET isn't configured yet, mid-rollout). Purely a
  // local "logged in" marker in that case — NOT a credential, and NOT sent
  // to the server as proof of anything. Once every environment has
  // SESSION_SECRET set, this path should never be hit in practice.
  function fallbackLocalMarker() {
    return 'local_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function normalizeRoleKey(raw = {}) {
    if (raw.roleKey) return String(raw.roleKey).toLowerCase();
    const role = String(raw.role || '').toLowerCase();
    if (raw.is_master === true) return 'master-admin';
    if (raw.is_admin === true || role === 'admin') return 'master-admin';
    if (role === 'org admin' || role === 'org-admin') return 'org-admin';
    if (role === 'operator') return 'operator';
    if (role === 'analyst') return 'operator';
    return 'operator';
  }
  function roleLabelFromKey(roleKey) {
    switch (roleKey) {
      case 'master-admin': return 'Master Admin';
      case 'org-admin': return 'Org Admin';
      default: return 'Operator';
    }
  }
  function roleStringForCompatibility(roleKey) {
    return roleKey === 'master-admin' ? 'Admin'
      : roleKey === 'org-admin' ? 'Org Admin'
      : 'Operator';
  }
  function buildCapabilities(roleKey) {
    return { ...(ROLE_CAPABILITIES[roleKey] || ROLE_CAPABILITIES.operator) };
  }
  function normalizeProfile(raw) {
    if (!raw || !raw.email) return null;
    const roleKey = normalizeRoleKey(raw);
    const role = raw.role || roleStringForCompatibility(roleKey);
    const profile = {
      ...raw,
      roleKey,
      roleLabel: raw.roleLabel || roleLabelFromKey(roleKey),
      role,
      is_master: roleKey === 'master-admin',
      is_admin: roleKey === 'master-admin',
      capabilities: { ...buildCapabilities(roleKey), ...(raw.capabilities || {}) }
    };
    return profile;
  }
  function persistProfile(profile) {
    const p = normalizeProfile(profile);
    LS.set('ci_user', p);
    localStorage.setItem('ci_profile', JSON.stringify(p));
    return p;
  }

  // ------------- Cloudflare Worker API -------------
  const API_BASE = 'https://api.cityintelapi.com'; // your Worker URL

  async function fetchSubStatus(email) {
    try {
      const url = `${API_BASE}/api/sub-status?email=${encodeURIComponent(email)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json(); // { email, subscribed, plan, trialEndsAt, updatedAt, roleKey? }
    } catch (e) {
      console.warn('Sub status fetch failed:', e);
      return null; // fall back to not subscribed
    }
  }


  async function cacheOrgOnboarding(profile, sessionToken) {
    try {
      if (!profile || !profile.email || profile.roleKey === 'master-admin') return null;
      const headers = {
        'Accept': 'application/json',
        'X-User-Email': profile.email,
        'X-User-Name': profile.name || '',
        'X-User-Id': profile.id || profile.email,
        'X-User-Role-Key': profile.roleKey || '',
        'X-User-Role': profile.role || ''
      };
      const tok = sessionToken || LS.get('ci_token', null);
      if (tok) headers['Authorization'] = 'Bearer ' + tok;
      const res = await fetch(`${API_BASE}/api/org/onboarding`, { headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.data) {
        localStorage.setItem('ci_org_onboarding', JSON.stringify(data.data));
        return data.data;
      }
    } catch (e) {
      console.warn('Onboarding defaults fetch failed:', e);
    }
    return null;
  }

  // ------------- CIAuth -------------
  const CIAuth = {
    who() {
      return normalizeProfile(LS.get('ci_user', null)); // {email, name, role, roleKey, capabilities...}
    },
    isLoggedIn() {
      return !!LS.get('ci_user') && !!LS.get('ci_token');
    },

    roleKey() {
      return this.who()?.roleKey || 'operator';
    },
    roleLabel() {
      return this.who()?.roleLabel || 'Operator';
    },
    isMasterAdmin() {
      return this.roleKey() === 'master-admin';
    },
    isOrgAdmin() {
      return this.roleKey() === 'org-admin';
    },
    isOperator() {
      return this.roleKey() === 'operator';
    },
    can(capability) {
      const u = this.who();
      return !!(u && u.capabilities && u.capabilities[capability]);
    },

    // ------------- Shared API header builder (auth hardening Phase 3) -----
    // Every page currently builds its own ad-hoc headers() function reading
    // localStorage directly. Since auth.js is already loaded on every page,
    // pages can switch to calling CIAuth.headers() instead of maintaining
    // their own copy — nothing extra needs to be pasted in.
    // Sends both the real signed bearer token (what the backend now prefers
    // and verifies cryptographically) AND the legacy X-User-* headers
    // (what the backend still accepts as a fallback during the migration —
    // see worker.js requireUser() history). Once every page has switched
    // to calling this and the backend's legacy fallback is removed, the
    // X-User-* headers below can come out too.
    headers(extra = {}) {
      const p = this.who() || {};
      const tok = LS.get('ci_token', null);
      const h = { 'Content-Type': 'application/json' };
      if (tok) h['Authorization'] = 'Bearer ' + tok;
      if (p.email) h['X-User-Email'] = p.email;
      if (p.name) h['X-User-Name'] = p.name;
      if (p.id || p.email) h['X-User-Id'] = p.id || p.email;
      if (p.role) h['X-User-Role'] = p.role;
      if (p.roleKey) h['X-User-Role-Key'] = p.roleKey;
      return { ...h, ...extra };
    },

   async login(email, password) {
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');

  if (!isValidEmail(e)) {
    throw new Error('Please enter a valid email address.');
  }

  if (!p) {
    throw new Error('Please enter your password.');
  }

  // REAL BACKEND LOGIN
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: e,
      password: p
    })
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Login failed.');
  }

  const user = data.user || {};

  const profile = normalizeProfile({
    email: user.email,
    name: user.name,
    role: user.role,
    roleKey: user.roleKey,
    roleLabel: user.roleLabel,
    org_id: user.org_id || user.orgId || null,
    orgId: user.org_id || user.orgId || null,
    accessType: user.accessType || user.access_type || null,
    status: user.status || null,
    is_admin: user.roleKey === 'master-admin',
    is_master: user.roleKey === 'master-admin'
  });

  persistProfile(profile);
  await cacheOrgOnboarding(profile, data.token);

  // Store the real signed session token issued by /api/auth/login. This is
  // what requireUser() on the backend now verifies (see worker.js history)
  // — it replaces the old fake client-generated token that was never
  // actually checked by the server.
  LS.set('ci_token', data.token || fallbackLocalMarker());

  localStorage.setItem(
    'ci_subscribed',
    String(
      user.accessType === 'internal' ||
      user.status === 'active' ||
      user.roleKey === 'master-admin' ||
      user.roleKey === 'org-admin'
    )
  );

  if (user.plan) {
    localStorage.setItem('ci_plan', user.plan);
  } else {
    localStorage.removeItem('ci_plan');
  }

  const params = new URLSearchParams(location.search);
  const next = params.get('next') || 'dashboard.html';
  // If 'next' points to the old index.html, send to dashboard instead
  location.href = next === 'index.html' ? 'dashboard.html' : next;

  return profile;
},

    logout() {
      LS.del('ci_user');
      LS.del('ci_token');

      localStorage.removeItem('ci_profile');
      localStorage.removeItem('ci_subscribed');
      localStorage.removeItem('ci_plan');
      localStorage.removeItem('ci_trial');
      localStorage.removeItem('ci_org_onboarding');
    },

    requireAuth(redirectTo = 'login.html') {
      if (!this.isLoggedIn()) {
        const nxt = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
        location.href = `${redirectTo}?next=${nxt}`;
      }
    },

        async refreshSubStatus(force = false) {
      try {
        const p = normalizeProfile(JSON.parse(localStorage.getItem('ci_profile') || '{}'));
        if (!p || !p.email || p.is_master) return;
        // Org Admins are always considered active — never redirect to subscribe
        if (p.roleKey === 'org-admin') {
          localStorage.setItem('ci_subscribed', 'true');
          return;
        }

        // Throttle (2 min) unless forced
        const last = Number(sessionStorage.getItem('ci_sub_checked_at') || 0);
        if (!force && Date.now() - last < 120_000) return;

        const res = await fetch(`${API_BASE}/api/sub-status?email=${encodeURIComponent(p.email)}`, {
  method: 'GET',
  headers: this.headers()
});
        if (!res.ok) return;
        const data = await res.json();

        const accessType = String(
  data.accessType ||
  data.access_type ||
  p.accessType ||
  p.access_type ||
  localStorage.getItem('ci_access_type') ||
  ''
).toLowerCase();

const status = String(
  data.status ||
  p.status ||
  localStorage.getItem('ci_status') ||
  ''
).toLowerCase();

        const allowed =
          !!data.subscribed ||
          accessType === 'internal' ||
          accessType === 'demo' ||
          status === 'active';

        localStorage.setItem('ci_subscribed', String(allowed));
        
        if (accessType) localStorage.setItem('ci_access_type', accessType);
        if (status) localStorage.setItem('ci_status', status);
        
        if (data.plan) {
          localStorage.setItem('ci_plan', data.plan);
        } else {
          localStorage.removeItem('ci_plan');
        }

        const rawRoleKey = String(data.roleKey || data.role_key || p.roleKey || 'operator').toLowerCase();

        const nextRoleKey =
          rawRoleKey === 'master-admin' ? 'master-admin' :
          rawRoleKey === 'org-admin' ? 'org-admin' :
          'operator';

        const refreshedProfile = normalizeProfile({
          ...p,
          name: data.name || p.name,
          roleKey: nextRoleKey,
          role: roleStringForCompatibility(nextRoleKey),
          roleLabel: roleLabelFromKey(nextRoleKey),
          accessType,
          status: status || p.status,
          org_id: data.org_id || data.orgId || p.org_id || p.orgId || null,
          orgId: data.org_id || data.orgId || p.org_id || p.orgId || null
        });

        persistProfile(refreshedProfile);

        sessionStorage.setItem('ci_sub_checked_at', String(Date.now()));

        const path = (location.pathname.split('/').pop() || '').toLowerCase();
        const protectedPages = [
          'dashboard.html','alerts.html','events.html','reports.html','watch.html',
          'operations-log.html','operationslog.html','analytics.html','system-flow.html','sources.html','settings.html',
          'live-alerts.html','assets.html','travellers.html','brief.html','trends.html',
          'neighborhood-intel.html','neighbourhood-intel.html'
        ];

        const isAuthPage = [
          'login.html',
          'subscribe.html',
          'forgottenpassword.html',
          'unsubscribe.html',
          'set-password.html'
        ].includes(path);

        if (!allowed && protectedPages.includes(path) && !isAuthPage) {
          location.href = 'subscribe.html?reason=expired';
        }
      } catch (e) {
        /* ignore */
      }
    }
  };

  window.CIAuth = CIAuth;

  // normalize any existing saved profile to the new shape
  (function normalizeBootProfile() {
    try {
      const existing = LS.get('ci_user', null);
      if (existing && existing.email) persistProfile(existing);
    } catch (e) {
      /* ignore */
    }
  })();

  // ------------- Boot-time subscription refresh -------------
  (async function bootRefresh() {
    try {
      const params = new URLSearchParams(location.search);
      const fromPortal = /billing\.stripe\.com/i.test(document.referrer) || params.get('from') === 'portal';
      await CIAuth.refreshSubStatus(!!fromPortal);
    } catch (e) {
      /* ignore */
    }
  })();

})(window);
