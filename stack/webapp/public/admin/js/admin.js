(function () {
  'use strict';

  const t = (key) => window.FireGuardI18n.t(key);
  const dateLocale = () => ({ es: 'es-ES', it: 'it-IT', en: 'en-US' }[window.FireGuardI18n.currentLang] || 'es-ES');

  const views = {
    login: document.getElementById('view-admin-login'),
    dashboard: document.getElementById('view-admin-dashboard'),
  };

  function show(view) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    views[view].classList.remove('hidden');
  }

  async function api(path, options) {
    const res = await fetch('/api/admin' + path, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function checkHealth() {
    const dot = document.getElementById('admin-status-dot');
    const text = document.getElementById('admin-status-text');
    try {
      const res = await fetch('/api/health', { credentials: 'same-origin' });
      dot.className = res.ok ? 'status-dot status-ready' : 'status-dot status-down';
      text.textContent = res.ok ? t('admin.ready') : t('admin.systemDown');
    } catch (e) {
      dot.className = 'status-dot status-down';
      text.textContent = t('admin.systemDown');
    }
  }

  // ---------------- Language / theme prefs ----------------
  // Two copies of the controls exist (login screen + dashboard topbar); keep
  // both in sync with the same cookie-backed preference.
  const langSelects = [document.getElementById('lang-select'), document.getElementById('admin-lang-select')];
  const themeToggleBtns = [document.getElementById('theme-toggle-btn'), document.getElementById('admin-theme-toggle-btn')];
  const themeSunIcons = [document.getElementById('theme-icon-sun'), document.getElementById('admin-theme-icon-sun')];
  const themeMoonIcons = [document.getElementById('theme-icon-moon'), document.getElementById('admin-theme-icon-moon')];

  function syncThemeIcons(theme) {
    const effective = window.FireGuardPrefs.effectiveTheme(theme);
    themeSunIcons.forEach((el) => el.classList.toggle('hidden', effective === 'dark'));
    themeMoonIcons.forEach((el) => el.classList.toggle('hidden', effective !== 'dark'));
  }

  function applyStoredPrefs() {
    const lang = window.FireGuardPrefs.getPreferredLang();
    const theme = window.FireGuardPrefs.getPreferredTheme();
    window.FireGuardI18n.applyI18n(lang);
    window.FireGuardPrefs.applyTheme(theme);
    langSelects.forEach((el) => { el.value = lang; });
    syncThemeIcons(theme);
    renderCompanies();
  }

  langSelects.forEach((el) => {
    el.addEventListener('change', () => {
      window.FireGuardPrefs.setPreferredLang(el.value);
      window.FireGuardI18n.applyI18n(el.value);
      langSelects.forEach((other) => { other.value = el.value; });
      renderCompanies();
    });
  });

  themeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = window.FireGuardPrefs.effectiveTheme(window.FireGuardPrefs.getPreferredTheme());
      const next = current === 'dark' ? 'light' : 'dark';
      window.FireGuardPrefs.setPreferredTheme(next);
      window.FireGuardPrefs.applyTheme(next);
      syncThemeIcons(next);
    });
  });

  // ---------------- Login ----------------
  const loginForm = document.getElementById('admin-login-form');
  const loginAlert = document.getElementById('admin-login-alert');
  const loginSubmit = document.getElementById('admin-login-submit');

  // ---------------- Caps Lock warning ----------------
  const adminCapsWarning = document.getElementById('admin-caps-warning');
  document.getElementById('admin-password').addEventListener('keyup', (e) => {
    adminCapsWarning.classList.toggle('hidden', !e.getModifierState('CapsLock'));
  });
  document.getElementById('admin-password').addEventListener('blur', () => {
    adminCapsWarning.classList.add('hidden');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginAlert.classList.add('hidden');
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;

    loginSubmit.disabled = true;
    loginSubmit.textContent = t('admin.loggingIn');
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await loadCompanies();
      show('dashboard');
    } catch (err) {
      loginAlert.textContent = (err.data && err.data.error) || t('admin.invalidCredentials');
      loginAlert.classList.remove('hidden');
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = t('admin.login');
    }
  });

  document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    show('login');
  });

  // ---------------- Companies list ----------------
  const state = { companies: [], search: '' };

  function formatDate(d) {
    return new Date(d).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function statusBadge(company) {
    if (!company.active) return `<span class="badge badge-suspended">${t('admin.badgeSuspended')}</span>`;
    if (company.status === 'ready') return `<span class="badge badge-status-ready">${t('admin.badgeReady')}</span>`;
    if (company.status === 'provisioning') return `<span class="badge badge-status-provisioning">${t('admin.badgeProvisioning')}</span>`;
    return `<span class="badge badge-status-error">${t('admin.badgeError')}</span>`;
  }

  function showAdminAlert(msg) {
    const box = document.getElementById('admin-alert');
    document.getElementById('admin-alert-text').textContent = msg;
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 6000);
  }

  function renderCompanies() {
    const list = document.getElementById('companies-list');
    const empty = document.getElementById('companies-empty');
    const noMatch = document.getElementById('companies-no-match');

    let companies = state.companies;
    if (state.search) {
      const q = state.search.toLowerCase();
      companies = companies.filter(
        (c) => c.display_name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
      );
    }

    list.innerHTML = '';

    if (state.companies.length === 0) {
      empty.classList.remove('hidden');
      noMatch.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');

    if (companies.length === 0) {
      noMatch.classList.remove('hidden');
      return;
    }
    noMatch.classList.add('hidden');

    companies.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'company-card';
      card.innerHTML = `
        <div class="company-head">
          <div>
            <div class="company-name">${c.display_name}</div>
            <div class="company-slug">admin@${c.slug}</div>
          </div>
          <div class="company-badges">
            ${statusBadge(c)}
            <button class="toggle-switch ${c.active ? 'on' : ''}" data-action="toggle" data-slug="${c.slug}" data-active="${c.active}" title="${c.active ? t('admin.suspend') : t('admin.resume')}"></button>
          </div>
        </div>
        <div class="company-meta">${t('admin.createdOn')} ${formatDate(c.created_at)} &middot; ${c.db_host}</div>
        ${c.status === 'error' && c.status_message ? `<div class="company-error-msg">${c.status_message}</div>` : ''}
        ${
          c.pendingPasswordResets > 0
            ? `<div class="company-pending-alert">⚠ ${c.pendingPasswordResets} ${t(c.pendingPasswordResets > 1 ? 'admin.pendingRequestPlural' : 'admin.pendingRequestSingular')}</div>`
            : ''
        }
        <div class="company-actions">
          <button class="btn btn-outline" data-action="users" data-slug="${c.slug}">${t('admin.viewUsers')}</button>
          <button class="btn btn-outline" data-action="reset-password" data-slug="${c.slug}">${t('admin.resetAdminPassword')}</button>
          <button class="btn btn-danger" data-action="delete" data-slug="${c.slug}">${t('admin.delete')}</button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  async function loadCompanies() {
    const { companies } = await api('/companies');
    state.companies = companies;
    renderCompanies();
  }

  document.getElementById('company-search-input').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderCompanies();
  });

  document.getElementById('companies-list').addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const usersBtn = e.target.closest('[data-action="users"]');
    const resetPasswordBtn = e.target.closest('[data-action="reset-password"]');

    if (toggleBtn) {
      const slug = toggleBtn.dataset.slug;
      const active = toggleBtn.dataset.active === 'true';
      toggleBtn.disabled = true;
      try {
        await api(`/companies/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
        await loadCompanies();
      } catch (err) {
        showAdminAlert((err.data && err.data.error) || t('admin.errCompanyUpdate'));
      } finally {
        toggleBtn.disabled = false;
      }
    }

    if (deleteBtn) openDeleteModal(deleteBtn.dataset.slug);
    if (usersBtn) openUsersModal(usersBtn.dataset.slug);

    if (resetPasswordBtn) {
      const slug = resetPasswordBtn.dataset.slug;
      resetPasswordBtn.disabled = true;
      resetPasswordBtn.textContent = t('admin.generating');
      try {
        const result = await api(`/companies/${encodeURIComponent(slug)}/admin-password`, { method: 'POST' });
        openCredentialsModal(result.email, result.password, t('admin.passwordUpdated'));
      } catch (err) {
        showAdminAlert((err.data && err.data.error) || t('admin.errPasswordChange'));
      } finally {
        resetPasswordBtn.disabled = false;
        resetPasswordBtn.textContent = t('admin.resetAdminPassword');
      }
    }
  });

  // ---------------- Create company modal ----------------
  const createModal = document.getElementById('modal-create');
  const createAlert = document.getElementById('create-alert');

  document.getElementById('new-company-btn').addEventListener('click', () => {
    document.getElementById('create-slug').value = '';
    document.getElementById('create-name').value = '';
    document.getElementById('create-password').value = '';
    document.getElementById('create-email').value = '';
    document.getElementById('create-licenses').value = '5';
    createAlert.classList.add('hidden');
    createModal.classList.remove('hidden');
  });

  document.getElementById('create-cancel-btn').addEventListener('click', () => createModal.classList.add('hidden'));

  document.getElementById('create-submit-btn').addEventListener('click', async () => {
    const slug = document.getElementById('create-slug').value.trim().toLowerCase();
    const displayName = document.getElementById('create-name').value.trim();
    const adminPassword = document.getElementById('create-password').value.trim();
    const contactEmail = document.getElementById('create-email').value.trim();
    const licenseCount = parseInt(document.getElementById('create-licenses').value, 10);
    createAlert.classList.add('hidden');

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      createAlert.textContent = t('admin.invalidSlug');
      createAlert.classList.remove('hidden');
      return;
    }
    if (!displayName) {
      createAlert.textContent = t('admin.displayNameRequired');
      createAlert.classList.remove('hidden');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      createAlert.textContent = t('admin.contactEmailRequired');
      createAlert.classList.remove('hidden');
      return;
    }
    if (!Number.isInteger(licenseCount) || licenseCount < 1) {
      createAlert.textContent = t('admin.licenseCountRequired');
      createAlert.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('create-submit-btn');
    btn.disabled = true;
    btn.textContent = t('admin.creating');
    try {
      const payload = { slug, displayName, contactEmail, licenseCount };
      if (adminPassword) payload.adminPassword = adminPassword;
      const created = await api('/companies', { method: 'POST', body: JSON.stringify(payload) });
      createModal.classList.add('hidden');
      await loadCompanies();
      const title = created.welcomeEmail && created.welcomeEmail.sent
        ? t('admin.companyCreatedEmailSent')
        : t('admin.companyCreated');
      openCredentialsModal(created.adminEmail, created.adminPassword, title);
    } catch (err) {
      createAlert.textContent = (err.data && err.data.error) || t('admin.errCompanyCreate');
      createAlert.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = t('admin.create');
    }
  });

  function openCredentialsModal(email, password, title) {
    document.getElementById('creds-title').textContent = title || t('admin.companyCreated');
    document.getElementById('creds-email').textContent = email;
    document.getElementById('creds-password').textContent = password;
    document.getElementById('modal-credentials').classList.remove('hidden');
  }
  document.getElementById('creds-done-btn').addEventListener('click', () => {
    document.getElementById('modal-credentials').classList.add('hidden');
  });

  // ---------------- Company users modal ----------------
  const usersModal = document.getElementById('modal-users');
  const usersAlert = document.getElementById('users-alert');

  function formatLastLogin(d) {
    if (!d) return t('admin.never');
    return new Date(d).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  let usersModalSlug = null;

  async function openUsersModal(slug) {
    usersModalSlug = slug;
    document.getElementById('users-company-label').textContent = slug;
    document.getElementById('users-list').innerHTML = '';
    usersAlert.classList.add('hidden');
    usersModal.classList.remove('hidden');
    try {
      const { users } = await api(`/companies/${encodeURIComponent(slug)}/users`);
      renderUsersList(users);
    } catch (err) {
      usersAlert.textContent = (err.data && err.data.error) || t('admin.errUsersLoad');
      usersAlert.classList.remove('hidden');
    }
  }

  function renderUsersList(users) {
    const list = document.getElementById('users-list');
    if (users.length === 0) {
      list.innerHTML = `<div class="empty-state">${t('admin.noUsers')}</div>`;
      return;
    }
    list.innerHTML = users
      .map(
        (u) => `
      <div class="user-row">
        <div>
          <div class="user-email">${u.email}${u.locked ? ` <span class="badge badge-suspended">${t('admin.locked')}</span>` : ''}</div>
          <div class="user-meta">${u.fullName || ''} &middot; ${u.role}</div>
          ${u.passwordResetRequestedAt ? `<div class="user-pending-badge">⚠ ${t('admin.pendingReset')} &middot; ${formatLastLogin(u.passwordResetRequestedAt)}</div>` : ''}
        </div>
        <div class="user-side">
          <div class="user-last-login">${t('admin.lastLogin')}<br>${formatLastLogin(u.lastLoginAt)}</div>
          <button class="btn btn-outline btn-sm" data-action="user-reset-password" data-user-id="${u.id}">${t('admin.reset')}</button>
        </div>
      </div>
    `
      )
      .join('');
  }

  document.getElementById('users-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="user-reset-password"]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = t('admin.generating');
    try {
      const result = await api(`/companies/${encodeURIComponent(usersModalSlug)}/users/${btn.dataset.userId}/reset-password`, {
        method: 'POST',
      });
      usersModal.classList.add('hidden');
      openCredentialsModal(result.email, result.password, t('admin.passwordUpdated'));
      await loadCompanies();
    } catch (err) {
      usersAlert.textContent = (err.data && err.data.error) || t('admin.errPasswordReset');
      usersAlert.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = t('admin.reset');
    }
  });

  document.getElementById('users-done-btn').addEventListener('click', () => {
    usersModal.classList.add('hidden');
  });

  // ---------------- Delete company modal ----------------
  let pendingDeleteSlug = null;
  const deleteModal = document.getElementById('modal-delete');
  const deleteInput = document.getElementById('delete-confirm-input');
  const deleteSubmitBtn = document.getElementById('delete-submit-btn');
  const deleteAlert = document.getElementById('delete-alert');

  function openDeleteModal(slug) {
    pendingDeleteSlug = slug;
    document.getElementById('delete-slug-label').textContent = slug;
    document.getElementById('delete-slug-label-2').textContent = slug;
    deleteInput.value = '';
    deleteSubmitBtn.disabled = true;
    deleteAlert.classList.add('hidden');
    deleteModal.classList.remove('hidden');
    deleteInput.focus();
  }

  deleteInput.addEventListener('input', () => {
    deleteSubmitBtn.disabled = deleteInput.value.trim() !== pendingDeleteSlug;
  });

  document.getElementById('delete-cancel-btn').addEventListener('click', () => deleteModal.classList.add('hidden'));

  deleteSubmitBtn.addEventListener('click', async () => {
    deleteSubmitBtn.disabled = true;
    deleteSubmitBtn.textContent = t('admin.deleting');
    try {
      await api(`/companies/${encodeURIComponent(pendingDeleteSlug)}`, { method: 'DELETE' });
      deleteModal.classList.add('hidden');
      await loadCompanies();
    } catch (err) {
      deleteAlert.textContent = (err.data && err.data.error) || t('admin.errCompanyDelete');
      deleteAlert.classList.remove('hidden');
      deleteSubmitBtn.disabled = false;
    } finally {
      deleteSubmitBtn.textContent = t('admin.deleteFinal');
    }
  });

  // ---------------- Boot ----------------
  async function boot() {
    applyStoredPrefs();
    checkHealth();
    setInterval(checkHealth, 30000);
    try {
      await api('/me');
      await loadCompanies();
      show('dashboard');
    } catch (e) {
      show('login');
    }
  }

  boot();
})();
