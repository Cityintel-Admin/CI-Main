// support-widget.js
// CityIntel internal support chat widget.
// Include this file on authenticated user-facing pages after auth.js and metrics.js.
// Example:
//   <script src="support-widget.js"></script>

(function(){
  'use strict';

  const API_BASE = (window.CI_API_BASE || window.API_BASE || 'https://api.cityintelapi.com').replace(/\/+$/, '');
  const POLL_MS = 60 * 1000;
  const BOOT_WAIT_MS = 15 * 1000;
  const BOOT_RETRY_MS = 500;

  const IDS = {
    root: 'ciSupportWidgetRoot',
    toggle: 'ciSupportToggle',
    badge: 'ciSupportBadge',
    panel: 'ciSupportPanel',
    messages: 'ciSupportMessages',
    subject: 'ciSupportSubject',
    message: 'ciSupportMessage',
    category: 'ciSupportCategory',
    priority: 'ciSupportPriority',
    send: 'ciSupportSend',
    status: 'ciSupportStatus',
    close: 'ciSupportClose',
    newThread: 'ciSupportNewThread'
  };

  let state = {
    open: false,
    loading: false,
    sending: false,
    thread: null,
    messages: [],
    lastError: '',
    pollTimer: null,
    bootStartedAt: Date.now(),
    forceNewSubject: false
  };

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

  function normaliseRole(value){
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function getAuthUser(){
    try {
      if (window.CIAuth && typeof CIAuth.who === 'function') return CIAuth.who() || {};
    } catch (_) {}
    return {};
  }

  function isLoggedIn(){
    try {
      if (window.CIAuth && typeof CIAuth.isLoggedIn === 'function') return !!CIAuth.isLoggedIn();
    } catch (_) {}
    const u = getUserContext();
    return !!(u.email || u.userId);
  }

  function isMasterAdmin(){
    try {
      if (window.CIAuth && typeof CIAuth.isMasterAdmin === 'function') return !!CIAuth.isMasterAdmin();
    } catch (_) {}
    const u = getUserContext();
    return normaliseRole(u.role).includes('masteradmin') || normaliseRole(u.role) === 'master';
  }

  function getUserContext(){
    const authUser = getAuthUser();
    const profileV1 = safeJson('cityintel.profile.v1', {});
    const ciUser = safeJson('ci_user', {});
    const ciProfile = safeJson('ci_profile', {});
    const orgProfile = safeJson('cityintel.orgProfile.v1', {});
    const currentOrg = safeJson('cityintel.currentOrg.v1', {});

    const email = firstNonEmpty(
      authUser.email,
      profileV1.email,
      ciUser.email,
      ciProfile.email,
      localStorage.getItem('ci_email'),
      localStorage.getItem('cityintel.email')
    ).toLowerCase();

    const name = firstNonEmpty(
      authUser.name,
      authUser.displayName,
      profileV1.displayName,
      profileV1.name,
      ciUser.name,
      ciProfile.name,
      email
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
      email
    );

    const role = firstNonEmpty(
      authUser.role,
      authUser.roleKey,
      authUser.roleLabel,
      profileV1.role,
      ciUser.role,
      ciProfile.role,
      localStorage.getItem('ci_role'),
      localStorage.getItem('cityintel.role')
    );

    const orgId = firstNonEmpty(
      authUser.org_id,
      authUser.orgId,
      authUser.organisationId,
      authUser.organizationId,
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
      localStorage.getItem('cityintel.orgId')
    );

    const orgName = firstNonEmpty(
      authUser.org_name,
      authUser.orgName,
      authUser.organisationName,
      authUser.organizationName,
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
      localStorage.getItem('cityintel.orgName')
    );

    return { userId, email, name, role, orgId, orgName };
  }

  function authHeaders(){
    const u = getUserContext();
    const h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (u.email) h['X-User-Email'] = u.email;
    if (u.name) h['X-User-Name'] = u.name;
    if (u.userId) h['X-User-Id'] = u.userId;
    if (u.role) h['X-User-Role'] = u.role;
    if (u.orgId) h['X-Org-Id'] = u.orgId;
    return h;
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[c]));
  }

  function relTime(iso){
    if (!iso) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }

  function injectStyles(){
    if (document.getElementById('ciSupportWidgetStyles')) return;

    const style = document.createElement('style');
    style.id = 'ciSupportWidgetStyles';
    style.textContent = `
      .ci-support-root{
        position:fixed;
        right:18px;
        bottom:18px;
        z-index:9998;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        color:#e9edf2;
      }
      .ci-support-toggle{
        position:relative;
        border:1px solid rgba(208,22,22,.55);
        background:linear-gradient(135deg,#D01616,#7f1111);
        color:#fff;
        border-radius:999px;
        padding:11px 15px;
        cursor:pointer;
        box-shadow:0 14px 38px rgba(0,0,0,.38);
        font-weight:800;
        display:flex;
        align-items:center;
        gap:8px;
      }
      .ci-support-toggle:hover{filter:brightness(1.08)}
      .ci-support-badge{
        display:none;
        position:absolute;
        top:-7px;
        right:-7px;
        min-width:20px;
        height:20px;
        padding:0 5px;
        border-radius:999px;
        background:#33c48d;
        color:#07110d;
        font-size:11px;
        font-weight:900;
        align-items:center;
        justify-content:center;
        border:2px solid #0c0c0c;
      }
      .ci-support-panel{
        display:none;
        width:min(390px,calc(100vw - 28px));
        max-height:min(620px,calc(100vh - 98px));
        background:#16171a;
        border:1px solid #24272c;
        border-radius:16px;
        overflow:hidden;
        box-shadow:0 22px 70px rgba(0,0,0,.52);
      }
      .ci-support-panel.open{display:flex;flex-direction:column}
      .ci-support-head{
        padding:13px 14px;
        background:linear-gradient(90deg,rgba(208,22,22,.28),rgba(208,22,22,.04));
        border-bottom:1px solid #24272c;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }
      .ci-support-title{font-size:15px;font-weight:900}
      .ci-support-subtitle{font-size:11px;color:#8e97a3;margin-top:2px}
      .ci-support-icon-btn{
        border:1px solid #2e3238;
        background:#1c1e22;
        color:#e9edf2;
        border-radius:9px;
        padding:6px 8px;
        cursor:pointer;
      }
      .ci-support-body{
        padding:12px;
        display:flex;
        flex-direction:column;
        gap:10px;
        overflow:hidden;
      }
      .ci-support-status{
        display:none;
        border:1px solid #2e3238;
        background:#101114;
        color:#8e97a3;
        border-radius:10px;
        padding:8px 10px;
        font-size:12px;
      }
      .ci-support-status.error{
        display:block;
        border-color:rgba(255,90,95,.45);
        color:#fecaca;
        background:rgba(255,90,95,.08);
      }
      .ci-support-status.ok{
        display:block;
        border-color:rgba(51,196,141,.35);
        color:#bbf7d0;
        background:rgba(51,196,141,.08);
      }
      .ci-support-messages{
        min-height:120px;
        max-height:250px;
        overflow:auto;
        border:1px solid #24272c;
        background:#0f1012;
        border-radius:12px;
        padding:10px;
        display:flex;
        flex-direction:column;
        gap:8px;
      }
      .ci-support-empty{
        color:#8e97a3;
        font-size:13px;
        line-height:1.45;
      }
      .ci-support-message{
        max-width:84%;
        border:1px solid #24272c;
        border-radius:12px;
        padding:8px 9px;
        font-size:13px;
        line-height:1.4;
      }
      .ci-support-message.user{
        align-self:flex-end;
        background:rgba(208,22,22,.14);
        border-color:rgba(208,22,22,.42);
      }
      .ci-support-message.admin{
        align-self:flex-start;
        background:#15171b;
      }
      .ci-support-meta{
        font-size:10px;
        color:#8e97a3;
        margin-bottom:4px;
      }
      .ci-support-form{
        display:flex;
        flex-direction:column;
        gap:8px;
      }
      .ci-support-input,
      .ci-support-select,
      .ci-support-textarea{
        width:100%;
        box-sizing:border-box;
        border:1px solid #24272c;
        background:#0f1012;
        color:#e9edf2;
        border-radius:10px;
        padding:9px 10px;
        font:inherit;
        outline:none;
      }
      .ci-support-input:focus,
      .ci-support-select:focus,
      .ci-support-textarea:focus{
        border-color:rgba(208,22,22,.65);
      }
      .ci-support-row{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
      }
      .ci-support-textarea{
        min-height:86px;
        resize:vertical;
      }
      .ci-support-actions{
        display:flex;
        justify-content:space-between;
        gap:8px;
        align-items:center;
        flex-wrap:wrap;
      }
      .ci-support-muted{
        color:#8e97a3;
        font-size:11px;
      }
      .ci-support-send{
        border:1px solid #D01616;
        background:#D01616;
        color:#fff;
        border-radius:10px;
        padding:9px 12px;
        cursor:pointer;
        font-weight:800;
      }
      .ci-support-send:disabled{
        opacity:.55;
        cursor:not-allowed;
      }
      .ci-support-link{
        border:0;
        background:transparent;
        color:#bfdbfe;
        cursor:pointer;
        padding:0;
        font-size:12px;
      }
      @media (max-width:720px){
        .ci-support-root{right:12px;bottom:12px}
        .ci-support-panel{width:calc(100vw - 24px)}
      }
    `;
    document.head.appendChild(style);
  }

  function buildWidget(){
    if (document.getElementById(IDS.root)) return;

    injectStyles();

    const root = document.createElement('div');
    root.id = IDS.root;
    root.className = 'ci-support-root';
    root.innerHTML = `
      <div id="${IDS.panel}" class="ci-support-panel" aria-hidden="true">
        <div class="ci-support-head">
          <div>
            <div class="ci-support-title">CityIntel Support</div>
            <div class="ci-support-subtitle">Message the CityIntel support team</div>
          </div>
          <button id="${IDS.close}" class="ci-support-icon-btn" type="button" aria-label="Close support chat">✕</button>
        </div>
        <div class="ci-support-body">
          <div id="${IDS.status}" class="ci-support-status"></div>
          <div id="${IDS.messages}" class="ci-support-messages">
            <div class="ci-support-empty">Loading support conversation…</div>
          </div>
          <div class="ci-support-form">
            <input id="${IDS.subject}" class="ci-support-input" type="text" maxlength="180" placeholder="Subject" autocomplete="off">
            <div class="ci-support-row">
              <select id="${IDS.category}" class="ci-support-select" aria-label="Support category">
                <option value="technical">Technical Issue</option>
                <option value="feature_request">Feature Request</option>
                <option value="account_billing">Account/Billing</option>
                <option value="training">Training</option>
                <option value="traveller_issue">Traveller Issue</option>
                <option value="live_alerts">Live Alerts</option>
                <option value="other">Other</option>
              </select>
              <select id="${IDS.priority}" class="ci-support-select" aria-label="Support priority">
                <option value="low">Low Priority</option>
                <option value="normal" selected>Normal Priority</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <textarea id="${IDS.message}" class="ci-support-textarea" maxlength="5000" placeholder="Type your message…"></textarea>
            <div class="ci-support-actions">
              <div>
                <button id="${IDS.newThread}" class="ci-support-link" type="button">Start a new request</button>
                <div class="ci-support-muted">Replies appear here when support responds.</div>
              </div>
              <button id="${IDS.send}" class="ci-support-send" type="button">Send</button>
            </div>
          </div>
        </div>
      </div>
      <button id="${IDS.toggle}" class="ci-support-toggle" type="button" aria-expanded="false">
        <span>💬</span><span>Support</span>
        <span id="${IDS.badge}" class="ci-support-badge">0</span>
      </button>
    `;

    document.body.appendChild(root);

    $(IDS.toggle).addEventListener('click', togglePanel);
    $(IDS.close).addEventListener('click', closePanel);
    $(IDS.send).addEventListener('click', sendMessage);
    $(IDS.newThread).addEventListener('click', startNewRequest);
  }

  function $(id){
    return document.getElementById(id);
  }

  function showStatus(message, type){
    const el = $(IDS.status);
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'ci-support-status';
      return;
    }
    el.textContent = message;
    el.className = `ci-support-status ${type || ''}`.trim();
  }

  function setSending(sending){
    state.sending = sending;
    const btn = $(IDS.send);
    if (btn) {
      const locked = isResolvedThread(state.thread) && !state.forceNewSubject;
      btn.disabled = sending || locked;
      btn.textContent = locked ? threadStatusLabel(state.thread) : (sending ? 'Sending…' : 'Send');
    }
  }

  function renderBadge(){
    const badge = $(IDS.badge);
    if (!badge) return;
    const unread = Number(state.thread?.unread_user || 0);
    if (unread > 0) {
      badge.style.display = 'flex';
      badge.textContent = unread > 9 ? '9+' : String(unread);
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  function isResolvedThread(thread){
    const status = String(thread?.status || '').toLowerCase();
    return status === 'resolved' || status === 'closed';
  }

  function threadStatusLabel(thread){
    const status = String(thread?.status || 'open').toLowerCase();
    if (status === 'resolved') return 'Resolved';
    if (status === 'closed') return 'Closed';
    if (status === 'pending') return 'Pending';
    return 'Open';
  }

  function threadStatusBanner(thread){
    const status = String(thread?.status || '').toLowerCase();
    if (status === 'resolved') {
      return `
        <div class="ci-support-status ok" style="display:block;margin-bottom:8px">
          ✓ This support request has been marked as resolved by CityIntel Support.
          Start a new request if you need more help.
        </div>`;
    }
    if (status === 'closed') {
      return `
        <div class="ci-support-status" style="display:block;margin-bottom:8px;color:#cbd5e1">
          This support request has been closed. Start a new request if you need more help.
        </div>`;
    }
    if (status === 'pending') {
      return `
        <div class="ci-support-status ok" style="display:block;margin-bottom:8px;border-color:rgba(240,180,41,.35);color:#fde68a;background:rgba(240,180,41,.08)">
          This support request is pending review.
        </div>`;
    }
    return '';
  }

  function setResolvedFormState(thread){
    const messageEl = $(IDS.message);
    const sendBtn = $(IDS.send);
    const muted = document.querySelector('.ci-support-muted');
    const locked = isResolvedThread(thread) && !state.forceNewSubject;

    if (messageEl) {
      messageEl.disabled = locked;
      messageEl.placeholder = locked
        ? `${threadStatusLabel(thread)} ticket — start a new request if you need more help.`
        : 'Type your message…';
    }

    if (sendBtn) {
      sendBtn.disabled = locked || state.sending;
      sendBtn.textContent = locked ? threadStatusLabel(thread) : (state.sending ? 'Sending…' : 'Send');
    }

    if (muted) {
      muted.textContent = locked
        ? 'This ticket is resolved. Start a new request for further assistance.'
        : 'Replies appear here when support responds.';
    }
  }

  function renderMessages(){
    const box = $(IDS.messages);
    const subject = $(IDS.subject);
    const category = $(IDS.category);
    const priority = $(IDS.priority);
    if (!box) return;

    const thread = state.thread;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const locked = isResolvedThread(thread) && !state.forceNewSubject;

    if (subject) {
      if (thread && !state.forceNewSubject) {
        subject.value = thread.subject || 'Support request';
        subject.disabled = true;
        if (category) { category.value = thread.category || 'technical'; category.disabled = true; }
        if (priority) { priority.value = thread.priority || 'normal'; priority.disabled = true; }
      } else {
        subject.disabled = false;
        if (category) category.disabled = false;
        if (priority) priority.disabled = false;
        if (state.forceNewSubject && subject.value === (thread?.subject || 'Support request')) subject.value = '';
      }
    }

    const banner = thread && !state.forceNewSubject ? threadStatusBanner(thread) : '';

    if (!thread && !messages.length) {
      box.innerHTML = `
        <div class="ci-support-empty">
          Need help? Send a message to CityIntel support. Include what page you are on and what you were trying to do.
        </div>`;
      setResolvedFormState(null);
      return;
    }

    if (!messages.length) {
      box.innerHTML = `${banner}<div class="ci-support-empty">No messages yet. Send a message below.</div>`;
      setResolvedFormState(thread);
      return;
    }

    box.innerHTML = banner + messages.map(m => {
      const type = String(m.sender_type || '').toLowerCase() === 'admin' ? 'admin' : 'user';
      const label = type === 'admin' ? 'CityIntel Support' : 'You';
      return `
        <div class="ci-support-message ${type}">
          <div class="ci-support-meta">${esc(label)}${m.created_at ? ` · ${esc(relTime(m.created_at))}` : ''}</div>
          <div>${esc(m.message || '').replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }).join('');

    box.scrollTop = box.scrollHeight;
    setResolvedFormState(thread);
  }

  function render(){
    renderBadge();
    renderMessages();
  }

  async function loadThread({ silent = false, markRead = false } = {}){
    if (state.forceNewSubject && silent && !markRead) return;
    if (state.loading) return;
    state.loading = true;
    if (!silent) showStatus('', '');

    try {
      const url = `${API_BASE}/api/support/my-thread${markRead ? '?mark_read=1' : ''}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: authHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Support request failed: ${res.status}`);

      state.thread = data.thread || null;
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      state.lastError = '';
      if (!silent && state.thread) showStatus('', '');
      render();
    } catch (e) {
      state.lastError = String(e?.message || e);
      if (!silent) showStatus(`Unable to load support conversation: ${state.lastError}`, 'error');
    } finally {
      state.loading = false;
    }
  }

  async function sendMessage(){
    const subjectEl = $(IDS.subject);
    const messageEl = $(IDS.message);
    const categoryEl = $(IDS.category);
    const priorityEl = $(IDS.priority);
    const message = String(messageEl?.value || '').trim();
    const subject = String(subjectEl?.value || '').trim() || 'Support request';
    const category = String(categoryEl?.value || 'technical');
    const priority = String(priorityEl?.value || 'normal');

    if (!message) {
      showStatus('Type a message before sending.', 'error');
      messageEl?.focus();
      return;
    }

    if (isResolvedThread(state.thread) && !state.forceNewSubject) {
      showStatus('This ticket is resolved. Start a new request if you need more help.', 'error');
      return;
    }

    const user = getUserContext();
    setSending(true);
    showStatus('', '');

    try {
      const res = await fetch(`${API_BASE}/api/support/messages`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          subject,
          category,
          priority,
          message,
          new_thread: state.forceNewSubject === true,
          org_id: user.orgId || '',
          org_name: user.orgName || ''
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Send failed: ${res.status}`);

      if (messageEl) messageEl.value = '';
      state.forceNewSubject = false;
      showStatus('Message sent.', 'ok');
      await loadThread({ silent: true });
      setTimeout(() => showStatus('', ''), 2500);
    } catch (e) {
      showStatus(`Unable to send message: ${String(e?.message || e)}`, 'error');
    } finally {
      setSending(false);
    }
  }

  function openPanel(){
    state.open = true;
    const panel = $(IDS.panel);
    const toggle = $(IDS.toggle);
    if (panel) {
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
    }
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    loadThread({ silent: false, markRead: true });
    setTimeout(() => $(IDS.message)?.focus(), 80);
  }

  function closePanel(){
    state.open = false;
    const panel = $(IDS.panel);
    const toggle = $(IDS.toggle);
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function togglePanel(){
    if (state.open) closePanel();
    else openPanel();
  }

  function startNewRequest(){
    state.forceNewSubject = true;
    state.thread = null;
    state.messages = [];
    showStatus('Starting a new support request. Write a subject and message below.', 'ok');
    const subject = $(IDS.subject);
    const category = $(IDS.category);
    const priority = $(IDS.priority);
    const message = $(IDS.message);
    if (subject) {
      subject.disabled = false;
      subject.value = '';
      subject.focus();
    }
    if (category) { category.disabled = false; category.value = 'technical'; }
    if (priority) { priority.disabled = false; priority.value = 'normal'; }
    if (message) {
      message.disabled = false;
      message.value = '';
      message.placeholder = 'Type your message…';
    }
    const sendBtn = $(IDS.send);
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
    renderMessages();
  }

  function startPolling(){
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => loadThread({ silent: true }), POLL_MS);
  }

  function boot(){
    if (!window.CIAuth && Date.now() - state.bootStartedAt < BOOT_WAIT_MS) {
      setTimeout(boot, BOOT_RETRY_MS);
      return;
    }

    if (!isLoggedIn()) return;

    // Master Admin users already have the Analytics Support Inbox.
    // Keep the user-facing chat widget for org users/operators to avoid duplicate admin UI.
    if (isMasterAdmin()) return;

    buildWidget();
    loadThread({ silent: true });
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
