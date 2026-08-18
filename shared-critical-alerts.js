/**
 * CityIntel Shared Critical Alerts — Phase 1
 * Platform-wide panic alarm visibility, acknowledgement and resolution.
 *
 * Loaded automatically by auth.js on authenticated pages.
 * Future critical alert types (for example missed check-ins) can register
 * against this same service and banner shell.
 */
(function mountCityIntelCriticalAlerts(window, document) {
  'use strict';

  if (window.CICriticalAlerts && window.CICriticalAlerts.version) return;

  const API_BASE = String(
    window.CI_API_BASE ||
    window.API_BASE ||
    'https://api.cityintelapi.com'
  ).replace(/\/+$/, '');

  const VERSION = '1.0.0';
  const POLL_MS = 8000;
  const LEADER_LEASE_MS = 16000;
  const LEADER_TICK_MS = 5000;
  const CACHE_MAX_AGE_MS = 30000;

  const profile = (() => {
    try {
      return (window.CIAuth && typeof window.CIAuth.who === 'function')
        ? (window.CIAuth.who() || {})
        : JSON.parse(localStorage.getItem('ci_profile') || '{}');
    } catch (_) {
      return {};
    }
  })();

  const userEmail = String(profile.email || '').trim().toLowerCase();
  const userOrgId = String(profile.org_id || profile.orgId || '').trim();
  const scope = `${userOrgId || 'no-org'}|${userEmail || 'unknown'}`;
  const scopeToken = encodeURIComponent(scope).replace(/%/g, '_');
  const tabId = `ci-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const leaseKey = `ci_critical_alerts_leader_v1:${scopeToken}`;
  const stateKey = `ci_critical_alerts_state_v1:${scopeToken}`;
  const trainingStateKey = `ci_training_banner_state_v1:${scopeToken}`;
  const stateSignalKey = `ci_critical_alerts_signal_v1:${scopeToken}`;
  const channelName = 'cityintel-critical-alerts-v1';

  let destroyed = false;
  let pollTimer = null;
  let leaderTimer = null;
  let isLeader = false;
  let requestInFlight = null;
  let channel = null;
  let lastActiveIds = new Set();

  let state = {
    version: VERSION,
    scope,
    orgId: userOrgId || '',
    activeAlarms: [],
    activeAlarmCount: 0,
    data: null,
    updatedAt: null,
    checkedAt: null,
    online: true,
    error: '',
    source: 'boot'
  };

  // Training exercises ride on the same poll cycle and leader election as
  // panic, but are kept in their own state and their own banner. They are not
  // a critical alert and must never borrow the critical alert's appearance.
  let trainingState = {
    active: false,
    count: 0,
    primary: null,
    startedAt: null,
    checkedAt: null
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[ch]));

  function authHeaders(extra = {}) {
    if (window.CIAuth && typeof window.CIAuth.headers === 'function') {
      return window.CIAuth.headers(extra);
    }
    return { 'Content-Type': 'application/json', 'Accept': 'application/json', ...extra };
  }

  function roleCanRespond() {
    try {
      if (!window.CIAuth || !window.CIAuth.isLoggedIn()) return false;
      if (typeof window.CIAuth.can === 'function' && window.CIAuth.can('canRespondPanic')) return true;
      return !!(
        window.CIAuth.isMasterAdmin?.() ||
        window.CIAuth.isOrgAdmin?.() ||
        window.CIAuth.isOperator?.()
      );
    } catch (_) {
      return false;
    }
  }

  function normaliseAlarm(raw = {}, fallback = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.logId || raw.log_id || fallback.id || '').trim();
    const firstName = String(raw.first_name || raw.firstName || '').trim();
    const surname = String(raw.surname || '').trim();
    const actorName = String(
      raw.actorName ||
      raw.actor_name ||
      raw.name ||
      [firstName, surname].filter(Boolean).join(' ')
    ).trim();

    return {
      ...raw,
      id,
      logId: id,
      firstName,
      surname,
      actorName,
      email: String(raw.email || raw.actorEmail || raw.actor_email || '').trim(),
      phone: String(raw.phone || raw.actorPhone || raw.actor_phone || '').trim(),
      location: String(raw.location || raw.locationText || raw.loc || '').trim(),
      message: String(raw.message || raw.msg || '').trim(),
      source: String(raw.source || fallback.source || 'panic').trim(),
      activatedAt: String(raw.activated_at || raw.activatedAt || raw.time || '').trim(),
      acknowledgedAt: String(raw.acknowledged_at || raw.acknowledgedAt || '').trim(),
      acknowledgedBy: String(raw.acknowledged_by || raw.acknowledgedBy || '').trim()
    };
  }

  function parseApiState(payload = {}) {
    const activeRows = Array.isArray(payload.activeAlarms)
      ? payload.activeAlarms.map(row => normaliseAlarm(row)).filter(Boolean)
      : [];

    const data = payload && typeof payload.data === 'object' ? payload.data : null;

    if (!activeRows.length && data && (
      data.active === true || data.active === 'true' || data.active === 1 || data.active === '1'
    )) {
      const single = normaliseAlarm(data);
      if (single) activeRows.push(single);
    }

    activeRows.sort((a, b) => {
      const aAck = a.acknowledgedAt ? 1 : 0;
      const bAck = b.acknowledgedAt ? 1 : 0;
      if (aAck !== bAck) return aAck - bAck;
      const at = Date.parse(a.activatedAt || '') || 0;
      const bt = Date.parse(b.activatedAt || '') || 0;
      return at - bt;
    });

    return {
      version: VERSION,
      scope,
      orgId: String(payload.orgId || userOrgId || ''),
      activeAlarms: activeRows,
      activeAlarmCount: activeRows.length,
      data,
      updatedAt: payload.updatedAt || null,
      checkedAt: new Date().toISOString(),
      online: true,
      error: '',
      source: 'api'
    };
  }

  function primaryAlarm(inputState = state) {
    const rows = Array.isArray(inputState.activeAlarms) ? inputState.activeAlarms : [];
    return rows[0] || null;
  }

  function formatTime(input) {
    if (!input) return '';
    const d = new Date(input);
    if (!Number.isFinite(d.getTime())) return String(input);
    try {
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return d.toISOString();
    }
  }

  function summaryFor(alarm) {
    if (!alarm) return '';
    const name = alarm.actorName || [alarm.firstName, alarm.surname].filter(Boolean).join(' ') || 'Person requiring assistance';
    const parts = [name];
    if (alarm.location) parts.push(alarm.location);
    if (alarm.message) parts.push(alarm.message);
    if (alarm.activatedAt) parts.push(`Activated ${formatTime(alarm.activatedAt)}`);
    return parts.join(' · ');
  }

  function ensureStyle() {
    if (document.getElementById('ciCriticalAlertsStyle')) return;
    const style = document.createElement('style');
    style.id = 'ciCriticalAlertsStyle';
    style.textContent = `
      #ciAlertStack{
        position:sticky;top:0;z-index:2147483000;width:100%;
      }
      #ciCriticalAlertsBanner{
        position:relative;
        display:none;width:100%;box-sizing:border-box;
        color:#fff;background:
          radial-gradient(circle at 92% 10%,rgba(255,255,255,.10),transparent 24%),
          linear-gradient(90deg,#8d090f,#bf1119 52%,#7b080e);
        border-bottom:1px solid rgba(255,255,255,.24);
        box-shadow:0 10px 30px rgba(0,0,0,.42);
        font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      }
      #ciCriticalAlertsBanner[data-visible="true"]{display:block}
      .ci-critical-inner{
        max-width:1600px;margin:0 auto;padding:10px 16px;
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;
      }
      .ci-critical-copy{min-width:0;display:flex;align-items:flex-start;gap:11px}
      .ci-critical-icon{
        width:34px;height:34px;flex:0 0 34px;border-radius:10px;
        display:grid;place-items:center;background:rgba(0,0,0,.22);
        border:1px solid rgba(255,255,255,.28);font-size:17px;
        animation:ciCriticalPulse 1.4s ease-in-out infinite;
      }
      .ci-critical-text{min-width:0}
      .ci-critical-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .ci-critical-title{font-size:13px;font-weight:950;letter-spacing:.065em}
      .ci-critical-count,.ci-critical-state{
        display:inline-flex;align-items:center;min-height:21px;padding:0 8px;
        border-radius:999px;border:1px solid rgba(255,255,255,.30);
        background:rgba(0,0,0,.18);font-size:10px;font-weight:850;white-space:nowrap;
      }
      .ci-critical-state.ack{background:rgba(0,0,0,.28)}
      .ci-critical-state.delay{background:rgba(240,180,41,.20);border-color:rgba(255,224,132,.56)}
      .ci-critical-summary{
        margin-top:3px;min-width:0;color:rgba(255,255,255,.94);font-size:12px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .ci-critical-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      .ci-critical-btn{
        appearance:none;display:inline-flex;align-items:center;justify-content:center;
        min-height:32px;padding:0 11px;border-radius:9px;
        border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.20);
        color:#fff;text-decoration:none;font:800 11px/1 system-ui;cursor:pointer;white-space:nowrap;
      }
      .ci-critical-btn:hover{background:rgba(0,0,0,.34);border-color:#fff}
      .ci-critical-btn.primary{background:#fff;color:#8c0b11;border-color:#fff}
      .ci-critical-btn:disabled{opacity:.52;cursor:not-allowed}
      #ciCriticalResolveModal{
        position:fixed;inset:0;z-index:2147483640;display:none;place-items:center;
        padding:18px;background:rgba(0,0,0,.78);backdrop-filter:blur(7px);
      }
      #ciCriticalResolveModal[data-open="true"]{display:grid}
      .ci-critical-modal-card{
        width:min(500px,100%);border:1px solid #393f48;border-left:3px solid #e31b23;
        border-radius:16px;background:linear-gradient(145deg,#15191f,#0d1014);
        box-shadow:0 30px 90px rgba(0,0,0,.68);padding:20px;color:#edf2f7;
      }
      .ci-critical-modal-card h2{margin:0 0 6px;font-size:19px}
      .ci-critical-modal-card p{margin:0 0 14px;color:#9eabbc;font-size:12px}
      .ci-critical-modal-card label{display:block;margin-bottom:6px;color:#cbd5e1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .ci-critical-modal-card textarea{
        width:100%;min-height:92px;resize:vertical;box-sizing:border-box;
        border:1px solid #343a43;border-radius:10px;background:#090c10;color:#fff;
        padding:10px 12px;font:13px/1.45 system-ui;outline:none;
      }
      .ci-critical-modal-card textarea:focus{border-color:#e31b23;box-shadow:0 0 0 3px rgba(227,27,35,.12)}
      .ci-critical-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
      .ci-critical-modal-error{display:none;margin-top:10px;color:#fecaca;font-size:12px}
      .ci-critical-modal-error[data-visible="true"]{display:block}
      /* Training banner — deliberately amber, never red, and always labelled
         as simulated. An operator glancing at the top of the page must never
         have to work out whether an exercise is a real incident. */
      #ciTrainingBanner{
        position:relative;display:none;width:100%;box-sizing:border-box;
        color:#1b1403;background:linear-gradient(90deg,#f4b942,#ffd479 52%,#eaa81f);
        border-bottom:1px solid rgba(0,0,0,.30);
        box-shadow:0 8px 22px rgba(0,0,0,.30);
        font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      }
      #ciTrainingBanner[data-visible="true"]{display:block}
      .ci-training-inner{
        max-width:1600px;margin:0 auto;padding:9px 16px;
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;
      }
      .ci-training-copy{min-width:0;display:flex;align-items:flex-start;gap:11px}
      .ci-training-icon{
        width:30px;height:30px;flex:0 0 30px;border-radius:9px;display:grid;place-items:center;
        background:rgba(0,0,0,.14);border:1px solid rgba(0,0,0,.26);font-size:15px;
      }
      .ci-training-title{font-size:12px;font-weight:950;letter-spacing:.07em}
      .ci-training-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .ci-training-chip{
        display:inline-flex;align-items:center;min-height:20px;padding:0 8px;border-radius:999px;
        border:1px solid rgba(0,0,0,.28);background:rgba(0,0,0,.10);
        font-size:10px;font-weight:850;white-space:nowrap;
      }
      .ci-training-summary{
        margin-top:2px;min-width:0;color:rgba(27,20,3,.86);font-size:12px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .ci-training-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      .ci-training-btn{
        appearance:none;display:inline-flex;align-items:center;justify-content:center;
        min-height:30px;padding:0 12px;border-radius:9px;
        border:1px solid rgba(0,0,0,.36);background:rgba(0,0,0,.08);
        color:#1b1403;text-decoration:none;font:850 11px/1 system-ui;cursor:pointer;white-space:nowrap;
      }
      .ci-training-btn.primary{background:#1b1403;color:#ffd479;border-color:#1b1403}
      .ci-training-btn:hover{background:rgba(0,0,0,.18)}
      .ci-training-btn.primary:hover{background:#000}
      /* When a real alarm is running, the exercise strip shrinks out of the
         way rather than competing with it. */
      #ciAlertStack[data-panic="true"] #ciTrainingBanner .ci-training-inner{padding:5px 16px}
      #ciAlertStack[data-panic="true"] #ciTrainingBanner .ci-training-summary{display:none}
      #ciAlertStack[data-panic="true"] #ciTrainingBanner .ci-training-icon{width:22px;height:22px;flex-basis:22px;font-size:12px}
      @media(max-width:760px){
        .ci-training-inner{grid-template-columns:1fr;padding:9px 11px;gap:8px}
        .ci-training-actions{justify-content:flex-start;padding-left:41px}
        .ci-training-summary{white-space:normal}
      }
      @keyframes ciCriticalPulse{50%{box-shadow:0 0 24px rgba(255,255,255,.28);transform:scale(1.035)}}
      @media(max-width:760px){
        .ci-critical-inner{grid-template-columns:1fr;padding:10px 11px;gap:9px}
        .ci-critical-actions{justify-content:flex-start;padding-left:45px}
        .ci-critical-summary{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      }
      @media(max-width:430px){
        .ci-critical-actions{padding-left:0}
        .ci-critical-btn{flex:1 1 auto}
      }
      @media(prefers-reduced-motion:reduce){.ci-critical-icon{animation:none}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Both banners live in one sticky container so they stack predictably
  // instead of two sticky elements fighting over the same top edge.
  function ensureStack() {
    let stack = document.getElementById('ciAlertStack');
    if (stack) return stack;
    ensureStyle();
    stack = document.createElement('div');
    stack.id = 'ciAlertStack';
    const insert = () => {
      if (!document.body || stack.isConnected) return;
      document.body.insertBefore(stack, document.body.firstChild);
    };
    insert();
    if (!stack.isConnected) document.addEventListener('DOMContentLoaded', insert, { once: true });
    return stack;
  }

  function ensureTrainingBanner() {
    let banner = document.getElementById('ciTrainingBanner');
    if (banner) return banner;

    const stack = ensureStack();
    banner = document.createElement('div');
    banner.id = 'ciTrainingBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="ci-training-inner">
        <div class="ci-training-copy">
          <div class="ci-training-icon" aria-hidden="true">🎓</div>
          <div class="ci-training-text">
            <div class="ci-training-title-row">
              <span id="ciTrainingTitle" class="ci-training-title">TRAINING EXERCISE — SIMULATED</span>
              <span id="ciTrainingCount" class="ci-training-chip"></span>
              <span id="ciTrainingAssigned" class="ci-training-chip"></span>
            </div>
            <div id="ciTrainingSummary" class="ci-training-summary"></div>
          </div>
        </div>
        <div class="ci-training-actions">
          <a id="ciTrainingOpen" class="ci-training-btn primary" href="training-scenario.html">Open exercise</a>
          <a class="ci-training-btn" href="training-hub.html">Training Hub</a>
        </div>
      </div>
    `;
    const attach = () => {
      const target = ensureStack();
      if (target && !banner.isConnected) target.appendChild(banner);
    };
    attach();
    if (!banner.isConnected) document.addEventListener('DOMContentLoaded', attach, { once: true });
    return banner;
  }

  function ensureBanner() {
    let banner = document.getElementById('ciCriticalAlertsBanner');
    if (banner) return banner;

    ensureStyle();
    banner = document.createElement('div');
    banner.id = 'ciCriticalAlertsBanner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');
    banner.setAttribute('aria-atomic', 'true');
    banner.innerHTML = `
      <div class="ci-critical-inner">
        <div class="ci-critical-copy">
          <div class="ci-critical-icon" aria-hidden="true">!</div>
          <div class="ci-critical-text">
            <div class="ci-critical-title-row">
              <span id="ciCriticalTitle" class="ci-critical-title">PANIC ALARM ACTIVE</span>
              <span id="ciCriticalCount" class="ci-critical-count"></span>
              <span id="ciCriticalState" class="ci-critical-state"></span>
            </div>
            <div id="ciCriticalSummary" class="ci-critical-summary"></div>
          </div>
        </div>
        <div class="ci-critical-actions">
          <a id="ciCriticalOpen" class="ci-critical-btn primary" href="panicalarm.html">Open</a>
          <button id="ciCriticalAck" class="ci-critical-btn" type="button">Acknowledge</button>
          <button id="ciCriticalResolve" class="ci-critical-btn" type="button">Resolve</button>
        </div>
      </div>
    `;

    const insert = () => {
      const stack = ensureStack();
      if (!stack || banner.isConnected) return;
      // Panic always sits above training in the stack.
      stack.insertBefore(banner, stack.firstChild);
    };
    insert();
    if (!banner.isConnected) document.addEventListener('DOMContentLoaded', insert, { once: true });

    banner.querySelector('#ciCriticalAck')?.addEventListener('click', () => {
      const alarm = primaryAlarm();
      if (alarm?.id) acknowledge(alarm.id);
    });
    banner.querySelector('#ciCriticalResolve')?.addEventListener('click', () => {
      const alarm = primaryAlarm();
      if (alarm?.id) openResolveModal(alarm);
    });

    return banner;
  }

  function ensureResolveModal() {
    let modal = document.getElementById('ciCriticalResolveModal');
    if (modal) return modal;
    ensureStyle();

    modal = document.createElement('div');
    modal.id = 'ciCriticalResolveModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ciCriticalResolveTitle');
    modal.innerHTML = `
      <div class="ci-critical-modal-card">
        <h2 id="ciCriticalResolveTitle">Resolve panic alarm</h2>
        <p id="ciCriticalResolveContext">Confirm that the person is safe and record the reason for closure.</p>
        <label for="ciCriticalResolveReason">Resolution reason</label>
        <textarea id="ciCriticalResolveReason" maxlength="500" placeholder="For example: Confirmed safe after telephone contact."></textarea>
        <div id="ciCriticalResolveError" class="ci-critical-modal-error"></div>
        <div class="ci-critical-modal-actions">
          <button id="ciCriticalResolveCancel" class="ci-critical-btn" type="button">Cancel</button>
          <button id="ciCriticalResolveConfirm" class="ci-critical-btn primary" type="button">Confirm resolution</button>
        </div>
      </div>
    `;

    const insert = () => {
      if (!document.body || modal.isConnected) return;
      document.body.appendChild(modal);
    };
    insert();
    if (!modal.isConnected) document.addEventListener('DOMContentLoaded', insert, { once: true });

    modal.querySelector('#ciCriticalResolveCancel')?.addEventListener('click', closeResolveModal);
    modal.addEventListener('click', event => {
      if (event.target === modal) closeResolveModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal.dataset.open === 'true') closeResolveModal();
    });
    modal.querySelector('#ciCriticalResolveConfirm')?.addEventListener('click', async () => {
      const id = String(modal.dataset.logId || '').trim();
      const reasonEl = modal.querySelector('#ciCriticalResolveReason');
      const errorEl = modal.querySelector('#ciCriticalResolveError');
      const reason = String(reasonEl?.value || '').trim();

      if (!reason) {
        if (errorEl) {
          errorEl.textContent = 'Enter a resolution reason before closing the alarm.';
          errorEl.dataset.visible = 'true';
        }
        reasonEl?.focus();
        return;
      }

      const confirmBtn = modal.querySelector('#ciCriticalResolveConfirm');
      const cancelBtn = modal.querySelector('#ciCriticalResolveCancel');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Resolving…';
      }
      if (cancelBtn) cancelBtn.disabled = true;

      try {
        await resolve(id, reason);
        closeResolveModal();
      } catch (error) {
        if (errorEl) {
          errorEl.textContent = error?.message || 'The alarm could not be resolved.';
          errorEl.dataset.visible = 'true';
        }
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm resolution';
        }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });

    return modal;
  }

  function openResolveModal(alarm) {
    if (!roleCanRespond() || !alarm?.id) return;
    const modal = ensureResolveModal();
    modal.dataset.logId = alarm.id;
    const context = modal.querySelector('#ciCriticalResolveContext');
    const reason = modal.querySelector('#ciCriticalResolveReason');
    const error = modal.querySelector('#ciCriticalResolveError');
    if (context) context.textContent = `${summaryFor(alarm)}. Confirm that the person is safe and record the reason for closure.`;
    if (reason) reason.value = 'Confirmed safe';
    if (error) {
      error.textContent = '';
      error.dataset.visible = 'false';
    }
    modal.dataset.open = 'true';
    setTimeout(() => reason?.focus(), 0);
  }

  function closeResolveModal() {
    const modal = document.getElementById('ciCriticalResolveModal');
    if (!modal) return;
    modal.dataset.open = 'false';
    modal.dataset.logId = '';
  }

  function setActionBusy(isBusy, label = '') {
    const banner = document.getElementById('ciCriticalAlertsBanner');
    if (!banner) return;
    const ack = banner.querySelector('#ciCriticalAck');
    const resolveBtn = banner.querySelector('#ciCriticalResolve');
    if (ack) ack.disabled = !!isBusy;
    if (resolveBtn) resolveBtn.disabled = !!isBusy;
    if (isBusy && label && ack) ack.textContent = label;
    else if (ack) ack.textContent = primaryAlarm()?.acknowledgedAt ? 'Acknowledged' : 'Acknowledge';
  }

  function render() {
    const banner = ensureBanner();
    const count = Number(state.activeAlarmCount || state.activeAlarms?.length || 0);
    const alarm = primaryAlarm();

    if (!count || !alarm) {
      banner.dataset.visible = 'false';
      return;
    }

    const title = banner.querySelector('#ciCriticalTitle');
    const countEl = banner.querySelector('#ciCriticalCount');
    const stateEl = banner.querySelector('#ciCriticalState');
    const summary = banner.querySelector('#ciCriticalSummary');
    const ack = banner.querySelector('#ciCriticalAck');
    const resolveBtn = banner.querySelector('#ciCriticalResolve');

    if (title) title.textContent = count > 1 ? `${count} PANIC ALARMS ACTIVE` : 'PANIC ALARM ACTIVE';
    if (countEl) countEl.textContent = count > 1 ? `Showing priority alarm` : 'Immediate attention';
    if (summary) summary.textContent = summaryFor(alarm);

    if (stateEl) {
      stateEl.className = 'ci-critical-state';
      if (!state.online) {
        stateEl.textContent = 'Status delayed';
        stateEl.classList.add('delay');
      } else if (alarm.acknowledgedAt) {
        stateEl.textContent = `Acknowledged${alarm.acknowledgedBy ? ` by ${alarm.acknowledgedBy}` : ''}`;
        stateEl.classList.add('ack');
      } else {
        stateEl.textContent = 'Unacknowledged';
      }
    }

    const canRespond = roleCanRespond() && !!alarm.id;
    if (ack) {
      ack.style.display = canRespond ? '' : 'none';
      ack.disabled = !!alarm.acknowledgedAt;
      ack.textContent = alarm.acknowledgedAt ? 'Acknowledged' : 'Acknowledge';
    }
    if (resolveBtn) {
      resolveBtn.style.display = canRespond ? '' : 'none';
      resolveBtn.disabled = false;
    }

    banner.dataset.visible = 'true';
  }

  function renderTraining() {
    const banner = ensureTrainingBanner();
    const stack = document.getElementById('ciAlertStack');
    const count = Number(trainingState.count || 0);

    if (stack) stack.dataset.panic = Number(state.activeAlarmCount || 0) > 0 ? 'true' : 'false';

    if (!count || !trainingState.active) {
      banner.dataset.visible = 'false';
      return;
    }

    const primary = trainingState.primary || {};
    const titleEl = banner.querySelector('#ciTrainingTitle');
    const countEl = banner.querySelector('#ciTrainingCount');
    const assignedEl = banner.querySelector('#ciTrainingAssigned');
    const summaryEl = banner.querySelector('#ciTrainingSummary');

    if (titleEl) titleEl.textContent = 'TRAINING EXERCISE — SIMULATED';
    if (countEl) countEl.textContent = count > 1 ? `${count} scenarios live` : '1 scenario live';

    if (assignedEl) {
      const who = String(primary.trainee_name || '').trim();
      assignedEl.textContent = who ? `Assigned: ${who}` : '';
      assignedEl.style.display = who ? '' : 'none';
    }

    if (summaryEl) {
      const place = [primary.city, primary.country].filter(Boolean).join(', ');
      const risk = String(primary.risk || '').toLowerCase();
      const riskLabel = risk === 'high' ? 'High risk' : risk === 'low' ? 'Low risk' : 'Medium risk';
      summaryEl.textContent = [primary.title || 'Training scenario', place, riskLabel]
        .filter(Boolean).join(' · ');
    }

    banner.dataset.visible = 'true';
  }

  function emitLifecycleEvents(nextState) {
    const nextIds = new Set((nextState.activeAlarms || []).map(a => String(a.id || '')).filter(Boolean));
    for (const id of nextIds) {
      if (!lastActiveIds.has(id)) {
        const alarm = (nextState.activeAlarms || []).find(a => a.id === id) || null;
        window.dispatchEvent(new CustomEvent('ci:panic-activated', { detail: { alarm, state: nextState } }));
      }
    }
    for (const id of lastActiveIds) {
      if (!nextIds.has(id)) {
        window.dispatchEvent(new CustomEvent('ci:panic-resolved', { detail: { logId: id, state: nextState } }));
      }
    }
    lastActiveIds = nextIds;
  }

  function persistState(nextState) {
    try {
      localStorage.setItem(stateKey, JSON.stringify({
        ...nextState,
        savedAt: Date.now()
      }));
      localStorage.setItem(stateSignalKey, JSON.stringify({
        at: Date.now(),
        tabId,
        nonce: Math.random().toString(36).slice(2)
      }));
    } catch (_) {}
  }

  function broadcastState(nextState) {
    try {
      channel?.postMessage({ type: 'state', scope, state: nextState, tabId });
    } catch (_) {}
    persistState(nextState);
  }

  function applyState(nextState, { broadcast = false } = {}) {
    if (!nextState || nextState.scope !== scope) return;
    state = {
      ...state,
      ...nextState,
      activeAlarms: Array.isArray(nextState.activeAlarms) ? nextState.activeAlarms : [],
      activeAlarmCount: Array.isArray(nextState.activeAlarms)
        ? nextState.activeAlarms.length
        : Number(nextState.activeAlarmCount || 0)
    };

    const primary = primaryAlarm(state);
    window.__ciPanicState = primary || null;
    window.__ciPanicResolved = primary || null;

    emitLifecycleEvents(state);
    render();
    // The training strip collapses while a real alarm is up, so it has to
    // re-render whenever the panic state changes, not only on its own tick.
    renderTraining();

    window.dispatchEvent(new CustomEvent('ci:critical-alerts-updated', {
      detail: {
        ...state,
        primaryAlarm: primary
      }
    }));

    if (broadcast) broadcastState(state);
  }

  function readCachedState() {
    try {
      const cached = JSON.parse(localStorage.getItem(stateKey) || 'null');
      if (!cached || cached.scope !== scope) return;
      if (!cached.savedAt || Date.now() - Number(cached.savedAt) > CACHE_MAX_AGE_MS) return;
      applyState({ ...cached, source: 'cache' });
    } catch (_) {}
  }

  async function fetchTrainingState() {
    const response = await fetch(`${API_BASE}/api/org/training-active?ts=${Date.now()}`, {
      method: 'GET',
      headers: authHeaders({ 'Cache-Control': 'no-cache' }),
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Training status failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return {
      active: !!payload.active,
      count: Number(payload.count || 0),
      primary: payload.primary || null,
      startedAt: payload.startedAt || null,
      checkedAt: new Date().toISOString()
    };
  }

  function applyTrainingState(next, { broadcast = false } = {}) {
    const wasActive = !!trainingState.active;
    trainingState = { ...trainingState, ...next };
    renderTraining();

    if (!wasActive && trainingState.active) {
      window.dispatchEvent(new CustomEvent('ci:training-started', { detail: { ...trainingState } }));
    } else if (wasActive && !trainingState.active) {
      window.dispatchEvent(new CustomEvent('ci:training-ended', { detail: { ...trainingState } }));
    }

    if (broadcast) {
      try {
        localStorage.setItem(trainingStateKey, JSON.stringify({ ...trainingState, savedAt: Date.now(), scope }));
      } catch (_) {}
      try {
        channel?.postMessage({ type: 'training', scope, tabId, state: trainingState });
      } catch (_) {}
    }
  }

  function readCachedTrainingState() {
    try {
      const cached = JSON.parse(localStorage.getItem(trainingStateKey) || 'null');
      if (!cached || cached.scope !== scope) return;
      if (!cached.savedAt || Date.now() - Number(cached.savedAt) > CACHE_MAX_AGE_MS) return;
      applyTrainingState(cached);
    } catch (_) {}
  }

  async function refreshTraining() {
    // A 403 here just means the organisation has no training module, so it is
    // swallowed quietly rather than logged on every poll.
    try {
      applyTrainingState(await fetchTrainingState(), { broadcast: true });
    } catch (error) {
      const status = Number(error?.status || 0);
      if (![401, 403, 404].includes(status)) {
        console.warn('CityIntel training banner:', error?.message || error);
      }
      applyTrainingState({ checkedAt: new Date().toISOString() });
    }
  }

  async function fetchState() {
    const response = await fetch(`${API_BASE}/api/org/panic?ts=${Date.now()}`, {
      method: 'GET',
      headers: authHeaders({ 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }),
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || payload.detail || `Panic status failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return parseApiState(payload);
  }

  async function refresh({ force = false } = {}) {
    if (destroyed) return state;
    if (!force && !isLeader) return state;
    if (requestInFlight) return requestInFlight;

    requestInFlight = (async () => {
      try {
        // Training rides along on the same tick so there is still only one
        // polling tab per organisation, not two.
        const [nextState] = await Promise.all([fetchState(), refreshTraining()]);
        applyState(nextState, { broadcast: true });
        return state;
      } catch (error) {
        const status = Number(error?.status || 0);
        const quietAuthOrOrgFailure = [401, 403].includes(status) && !state.activeAlarmCount;
        applyState({
          ...state,
          checkedAt: new Date().toISOString(),
          online: false,
          error: error?.message || 'Panic status unavailable',
          source: 'api-error'
        }, { broadcast: !!state.activeAlarmCount });

        if (!quietAuthOrOrgFailure) {
          console.warn('CityIntel critical alerts:', error?.message || error);
        }
        return state;
      } finally {
        requestInFlight = null;
      }
    })();

    return requestInFlight;
  }

  async function acknowledge(logId) {
    if (!roleCanRespond() || !logId) return false;
    setActionBusy(true, 'Acknowledging…');
    try {
      const response = await fetch(`${API_BASE}/api/org/panic/acknowledge`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ logId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.detail || `Acknowledge failed (${response.status})`);
      }
      await refresh({ force: true });
      return true;
    } finally {
      setActionBusy(false);
    }
  }

  async function resolve(logId, reason) {
    if (!roleCanRespond() || !logId) return false;
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) throw new Error('A resolution reason is required.');

    const response = await fetch(`${API_BASE}/api/org/panic`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        active: false,
        logId,
        resetReason: cleanReason,
        resolved_at: new Date().toISOString(),
        source: 'shared-critical-alerts'
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || payload.detail || `Resolve failed (${response.status})`);
    }
    await refresh({ force: true });
    return true;
  }

  function parseLease() {
    try {
      const raw = JSON.parse(localStorage.getItem(leaseKey) || 'null');
      if (!raw || !raw.tabId || !raw.expiresAt) return null;
      return raw;
    } catch (_) {
      return null;
    }
  }

  function claimLeadership(force = false) {
    if (destroyed || document.visibilityState === 'hidden') return false;
    const now = Date.now();
    const current = parseLease();
    if (!force && current && current.tabId !== tabId && Number(current.expiresAt) > now) {
      isLeader = false;
      return false;
    }

    try {
      localStorage.setItem(leaseKey, JSON.stringify({
        tabId,
        scope,
        expiresAt: now + LEADER_LEASE_MS
      }));
      const confirmed = parseLease();
      isLeader = !!(confirmed && confirmed.tabId === tabId);
    } catch (_) {
      isLeader = true;
    }

    return isLeader;
  }

  function renewLeadership() {
    if (!isLeader || destroyed || document.visibilityState === 'hidden') return;
    try {
      localStorage.setItem(leaseKey, JSON.stringify({
        tabId,
        scope,
        expiresAt: Date.now() + LEADER_LEASE_MS
      }));
    } catch (_) {}
  }

  function releaseLeadership() {
    if (!isLeader) return;
    try {
      const current = parseLease();
      if (current?.tabId === tabId) localStorage.removeItem(leaseKey);
    } catch (_) {}
    isLeader = false;
  }

  function schedulePolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!destroyed && isLeader && document.visibilityState !== 'hidden') {
        refresh({ force: true });
      }
    }, POLL_MS);

    clearInterval(leaderTimer);
    leaderTimer = setInterval(() => {
      if (destroyed) return;
      if (document.visibilityState === 'hidden') {
        releaseLeadership();
        return;
      }

      if (isLeader) {
        renewLeadership();
        return;
      }

      const lease = parseLease();
      if (!lease || Number(lease.expiresAt) <= Date.now()) {
        if (claimLeadership()) refresh({ force: true });
      }
    }, LEADER_TICK_MS);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      releaseLeadership();
      return;
    }
    if (claimLeadership()) refresh({ force: true });
  }

  function onStorage(event) {
    if (destroyed) return;
    if (event.key === stateSignalKey || event.key === stateKey) {
      readCachedState();
    }
    if (event.key === leaseKey && document.visibilityState !== 'hidden' && !isLeader) {
      const lease = parseLease();
      if (!lease || Number(lease.expiresAt) <= Date.now()) claimLeadership();
    }
  }

  function destroy() {
    destroyed = true;
    clearInterval(pollTimer);
    clearInterval(leaderTimer);
    releaseLeadership();
    try { channel?.close(); } catch (_) {}
    const banner = document.getElementById('ciCriticalAlertsBanner');
    if (banner) banner.remove();
    const trainingBanner = document.getElementById('ciTrainingBanner');
    if (trainingBanner) trainingBanner.remove();
    const stack = document.getElementById('ciAlertStack');
    if (stack) stack.remove();
    const modal = document.getElementById('ciCriticalResolveModal');
    if (modal) modal.remove();
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  window.CICriticalAlerts = {
    version: VERSION,
    refresh: () => refresh({ force: true }),
    getState: () => ({ ...state, activeAlarms: [...state.activeAlarms] }),
    getPrimaryAlarm: () => primaryAlarm(),
    acknowledge,
    resolve,
    openResolveModal,
    canRespond: roleCanRespond,
    getTrainingState: () => ({ ...trainingState }),
    refreshTraining: () => refreshTraining(),
    destroy,
    registerType(type, handler) {
      // Reserved extension point for missed check-ins and future critical
      // platform alert types. Panic remains the only registered type in Phase 1.
      if (!type || typeof handler !== 'object') return false;
      this.types = this.types || {};
      this.types[String(type)] = handler;
      return true;
    },
    types: { panic: { phase: 1 } }
  };

  function boot() {
    if (destroyed) return;
    ensureBanner();
    ensureTrainingBanner();
    readCachedState();
    readCachedTrainingState();

    try {
      channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', event => {
        const message = event.data || {};
        if (message.scope !== scope || message.tabId === tabId) return;
        if (message.type === 'state' && message.state) {
          applyState({ ...message.state, source: 'broadcast' });
        }
        if (message.type === 'training' && message.state) {
          applyTrainingState(message.state);
        }
      });
    } catch (_) {
      channel = null;
    }

    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', releaseLeadership, { once: true });

    schedulePolling();

    if (document.visibilityState !== 'hidden' && claimLeadership()) {
      refresh({ force: true });
    } else {
      setTimeout(() => {
        if (!state.checkedAt && document.visibilityState !== 'hidden' && claimLeadership(true)) {
          refresh({ force: true });
        }
      }, 1400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window, document);
