 // Carlton — Admin:  cjladmin@cityintel.com  /  Kieron12!
  // Morris  — Admin:  mm@cityintel.com        /  Morrisintel@01
// Nat  — Admin:  nat@cityintel.com        /  Natcity@01

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

  // ------------- Local internal users -------------
  // NOTE:
  // role remains 'Admin' for compatibility with existing pages that still check role==='admin'
  // roleKey / roleLabel are the new role model for future page-level permission checks
  const USERS = {
    'cjladmin@cityintel.com': {
      name: 'Carlton',
      role: 'Admin',
      roleKey: 'master-admin',
      roleLabel: 'Master Admin',
      passHash: '2af37cad7dca2c87d8aa6f5e8136e299e652be3953c182d1bc558f0f80bdb64e'
    },
    'mm@cityintel.com': {
      name: 'Morris',
      role: 'Admin',
      roleKey: 'master-admin',
      roleLabel: 'Master Admin',
      passHash: 'ef2c36181af9977b4359eedab2d21a6715d266e0d5a35200f333d743adb2cc5e'
    },
    'nat@cityintel.com': {
      name: 'Nat',
      role: 'Admin',
      roleKey: 'master-admin',
      roleLabel: 'Master Admin',
      passHash: 'be9f7196b951dbd1187cd865aebc8c34386e067e241a78e57fd77c736c51c993'
    }
  };

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
  function token() {
    return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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

    async login(email, password) {
      const e = String(email || '').trim().toLowerCase();
      const p = String(password || '');

      if (!isValidEmail(e)) throw new Error('Please enter a valid email address.');

      // 1) Internal master admins still require password
      const admin = USERS[e];
      if (admin) {
        if (!p) throw new Error('Please enter your password.');
        const given = await sha256(p);
        if (given !== admin.passHash) throw new Error('Incorrect password.');
        const profile = normalizeProfile({
          email: e,
          name: admin.name,
          role: admin.role,            // stays 'Admin' for compatibility
          roleKey: admin.roleKey,      // new role system
          roleLabel: admin.roleLabel,
          is_admin: true,
          is_master: true
        });
        persistProfile(profile);
        LS.set('ci_token', token());
        localStorage.setItem('ci_subscribed', 'true'); // internal admins always have access
        const params = new URLSearchParams(location.search);
        const next = params.get('next') || 'index.html';
        location.href = next;
        return profile;
      }

      // 2) Customer users: check subscription status in Worker (email-only login for testing)
      const sub = await fetchSubStatus(e); // {subscribed, plan, trialEndsAt, roleKey?}
      if (!sub || (!sub.subscribed && !sub.trialEndsAt)) {
        throw new Error('No active subscription found for this email. Please subscribe first.');
      }

      const roleKey = String(sub.roleKey || '').toLowerCase() === 'org-admin' ? 'org-admin' : 'operator';
      const profile = normalizeProfile({
        email: e,
        name: sub.name || e.split('@')[0],
        role: roleStringForCompatibility(roleKey),
        roleKey,
        roleLabel: roleLabelFromKey(roleKey),
        is_admin: false,
        is_master: false
      });

      persistProfile(profile);
      LS.set('ci_token', token());
      localStorage.setItem('ci_subscribed', String(!!sub.subscribed || !!sub.trialEndsAt));
      if (sub.plan) localStorage.setItem('ci_plan', sub.plan); else localStorage.removeItem('ci_plan');

      const params = new URLSearchParams(location.search);
      const next = params.get('next') || 'index.html';
      location.href = next;
      return profile;
    },

    logout() {
      LS.del('ci_user');
      LS.del('ci_token');

      localStorage.removeItem('ci_profile');
      localStorage.removeItem('ci_subscribed');
      localStorage.removeItem('ci_plan');
      localStorage.removeItem('ci_trial');
    },

    requireAuth(redirectTo = 'login.html') {
      if (!this.isLoggedIn()) {
        const nxt = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
        location.href = `${redirectTo}?next=${nxt}`;
      }
    },

    async refreshSubStatus(force = false) {
      try {
        const p = normalizeProfile(JSON.parse(localStorage.getItem('ci_profile') || '{}'));
        if (!p || !p.email || p.is_master) return;

        // Throttle (2 min) unless forced
        const last = Number(sessionStorage.getItem('ci_sub_checked_at') || 0);
        if (!force && Date.now() - last < 120_000) return;

        const res = await fetch(`${API_BASE}/api/sub-status?email=${encodeURIComponent(p.email)}`);
        if (!res.ok) return;
        const data = await res.json();

        localStorage.setItem('ci_subscribed', String(!!data.subscribed));
        if (data.plan) localStorage.setItem('ci_plan', data.plan); else localStorage.removeItem('ci_plan');

        const nextRoleKey = String(data.roleKey || '').toLowerCase() === 'org-admin'
          ? 'org-admin'
          : (p.roleKey || 'operator');

        const refreshedProfile = normalizeProfile({
          ...p,
          name: data.name || p.name,
          roleKey: nextRoleKey,
          role: roleStringForCompatibility(nextRoleKey),
          roleLabel: roleLabelFromKey(nextRoleKey)
        });
        persistProfile(refreshedProfile);

        sessionStorage.setItem('ci_sub_checked_at', String(Date.now()));

        const path = (location.pathname.split('/').pop() || '').toLowerCase();
        const protectedPages = [
          'index.html','alerts.html','events.html','reports.html','watch.html',
          'operations-log.html','analytics.html','system-flow.html','sources.html','settings.html',
          'live-alerts.html','assets.html','travellers.html','brief.html','trends.html'
        ];
        const isAuthPage = ['login.html','subscribe.html','forgottenpassword.html','unsubscribe.html'].includes(path);
        if (!data.subscribed && protectedPages.includes(path) && !isAuthPage) {
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
