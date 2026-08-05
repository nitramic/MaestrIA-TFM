(function () {
  'use strict';

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
      text.textContent = res.ok ? 'Listo para trabajar' : 'Sistema no disponible';
    } catch (e) {
      dot.className = 'status-dot status-down';
      text.textContent = 'Sistema no disponible';
    }
  }

  // ---------------- Login ----------------
  const loginForm = document.getElementById('admin-login-form');
  const loginAlert = document.getElementById('admin-login-alert');
  const loginSubmit = document.getElementById('admin-login-submit');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginAlert.classList.add('hidden');
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;

    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Iniciando sesión…';
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await loadCompanies();
      show('dashboard');
    } catch (err) {
      loginAlert.textContent = (err.data && err.data.error) || 'Datos no válidos.';
      loginAlert.classList.remove('hidden');
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'Iniciar sesión';
    }
  });

  document.getElementById('admin-logout-btn').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    show('login');
  });

  // ---------------- Companies list ----------------
  const state = { companies: [], search: '' };

  function formatDate(d) {
    return new Date(d).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function statusBadge(company) {
    if (!company.active) return '<span class="badge badge-suspended">Suspendida</span>';
    if (company.status === 'ready') return '<span class="badge badge-status-ready">Lista</span>';
    if (company.status === 'provisioning') return '<span class="badge badge-status-provisioning">Aprovisionando…</span>';
    return '<span class="badge badge-status-error">Error</span>';
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
            <button class="toggle-switch ${c.active ? 'on' : ''}" data-action="toggle" data-slug="${c.slug}" data-active="${c.active}" title="${c.active ? 'Suspender acceso' : 'Reanudar acceso'}"></button>
          </div>
        </div>
        <div class="company-meta">Creada el ${formatDate(c.created_at)} &middot; ${c.db_host}</div>
        ${c.status === 'error' && c.status_message ? `<div class="company-error-msg">${c.status_message}</div>` : ''}
        <div class="company-actions">
          <button class="btn btn-danger" data-action="delete" data-slug="${c.slug}">Eliminar</button>
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

    if (toggleBtn) {
      const slug = toggleBtn.dataset.slug;
      const active = toggleBtn.dataset.active === 'true';
      toggleBtn.disabled = true;
      try {
        await api(`/companies/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
        await loadCompanies();
      } catch (err) {
        showAdminAlert((err.data && err.data.error) || 'No se pudo actualizar la empresa.');
      } finally {
        toggleBtn.disabled = false;
      }
    }

    if (deleteBtn) openDeleteModal(deleteBtn.dataset.slug);
  });

  // ---------------- Create company modal ----------------
  const createModal = document.getElementById('modal-create');
  const createAlert = document.getElementById('create-alert');

  document.getElementById('new-company-btn').addEventListener('click', () => {
    document.getElementById('create-slug').value = '';
    document.getElementById('create-name').value = '';
    document.getElementById('create-password').value = '';
    createAlert.classList.add('hidden');
    createModal.classList.remove('hidden');
  });

  document.getElementById('create-cancel-btn').addEventListener('click', () => createModal.classList.add('hidden'));

  document.getElementById('create-submit-btn').addEventListener('click', async () => {
    const slug = document.getElementById('create-slug').value.trim().toLowerCase();
    const displayName = document.getElementById('create-name').value.trim();
    const adminPassword = document.getElementById('create-password').value.trim();
    createAlert.classList.add('hidden');

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      createAlert.textContent = 'Slug inválido: usa minúsculas, dígitos, - o _.';
      createAlert.classList.remove('hidden');
      return;
    }
    if (!displayName) {
      createAlert.textContent = 'El nombre visible es obligatorio.';
      createAlert.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('create-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Creando…';
    try {
      const payload = { slug, displayName };
      if (adminPassword) payload.adminPassword = adminPassword;
      const created = await api('/companies', { method: 'POST', body: JSON.stringify(payload) });
      createModal.classList.add('hidden');
      await loadCompanies();
      openCredentialsModal(created.adminEmail, created.adminPassword);
    } catch (err) {
      createAlert.textContent = (err.data && err.data.error) || 'No se pudo crear la empresa.';
      createAlert.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear';
    }
  });

  function openCredentialsModal(email, password) {
    document.getElementById('creds-email').textContent = email;
    document.getElementById('creds-password').textContent = password;
    document.getElementById('modal-credentials').classList.remove('hidden');
  }
  document.getElementById('creds-done-btn').addEventListener('click', () => {
    document.getElementById('modal-credentials').classList.add('hidden');
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
    deleteSubmitBtn.textContent = 'Eliminando…';
    try {
      await api(`/companies/${encodeURIComponent(pendingDeleteSlug)}`, { method: 'DELETE' });
      deleteModal.classList.add('hidden');
      await loadCompanies();
    } catch (err) {
      deleteAlert.textContent = (err.data && err.data.error) || 'No se pudo eliminar la empresa.';
      deleteAlert.classList.remove('hidden');
      deleteSubmitBtn.disabled = false;
    } finally {
      deleteSubmitBtn.textContent = 'Eliminar definitivamente';
    }
  });

  // ---------------- Boot ----------------
  async function boot() {
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
