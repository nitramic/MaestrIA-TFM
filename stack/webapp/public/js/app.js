(function () {
  'use strict';

  const t = (key) => window.FireGuardI18n.t(key);

  const views = {
    login: document.getElementById('view-login'),
    dashboard: document.getElementById('view-dashboard'),
    detail: document.getElementById('view-detail'),
    units: document.getElementById('view-units'),
    inspect: document.getElementById('view-inspect'),
    reports: document.getElementById('view-reports'),
    settings: document.getElementById('view-settings'),
  };

  const bottomNav = document.getElementById('bottom-nav');
  const NAV_VIEWS = new Set(['dashboard', 'units', 'inspect', 'reports', 'settings']);

  const state = {
    items: [],
    summary: { total: 0, ok: 0, dueSoon: 0, overdue: 0 },
    filter: 'all',
    search: '',
    currentCode: null,
    currentItem: null,
    detailOrigin: 'dashboard',
    session: null,
    sites: [],
    map: null,
    markersLayer: null,
    inspectFilter: null, // { siteId, siteName, statuses }
    charts: {},
    settingsBound: false,
    reportsTypesLoaded: false,
    selectedUserIds: new Set(),
  };

  function show(view) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    views[view].classList.remove('hidden');
  }

  async function api(path, options) {
    const res = await fetch('/api' + path, {
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

  // ---------------- Navigation ----------------
  function navigateTo(view) {
    show(view);
    bottomNav.classList.toggle('hidden', !NAV_VIEWS.has(view));
    document.querySelectorAll('#bottom-nav .nav-item').forEach((el) => {
      el.classList.toggle('nav-item-active', el.dataset.view === view);
    });
    if (view === 'dashboard') loadDashboard().catch(() => {});
    if (view === 'units') loadUnits().catch(() => {});
    if (view === 'inspect') loadInspect().catch(() => {});
    if (view === 'reports') loadReports().catch(() => {});
    if (view === 'settings') loadSettings().catch(() => {});
  }

  bottomNav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    navigateTo(item.dataset.view);
  });

  // ---------------- Health / status dot ----------------
  async function checkHealth() {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    try {
      const res = await fetch('/api/health', { credentials: 'same-origin' });
      if (res.ok) {
        dot.className = 'status-dot status-ready';
        text.textContent = t('conn.ready');
      } else {
        dot.className = 'status-dot status-down';
        text.textContent = t('conn.down');
      }
    } catch (e) {
      dot.className = 'status-dot status-down';
      text.textContent = t('conn.down');
    }
  }

  // ---------------- Session / boot ----------------
  function applySession(session) {
    state.session = session;
    document.getElementById('settings-admin-card').classList.toggle('hidden', session.role !== 'admin');
  }

  // ---------------- Login ----------------
  const loginForm = document.getElementById('login-form');
  const loginAlert = document.getElementById('login-alert');
  const loginSubmit = document.getElementById('login-submit');

  document.getElementById('toggle-password').addEventListener('click', () => {
    const pw = document.getElementById('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });

  // ---------------- Caps Lock warning ----------------
  const capsWarning = document.getElementById('caps-warning');
  document.getElementById('password').addEventListener('keyup', (e) => {
    capsWarning.classList.toggle('hidden', !e.getModifierState('CapsLock'));
  });
  document.getElementById('password').addEventListener('blur', () => {
    capsWarning.classList.add('hidden');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginAlert.classList.add('hidden');

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || password.length < 5) {
      loginAlert.textContent = t('login.passwordMinLength');
      loginAlert.classList.remove('hidden');
      return;
    }

    loginSubmit.disabled = true;
    loginSubmit.textContent = t('login.signingIn');

    try {
      const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      applySession({
        role: res.user.role,
        email: res.user.email,
        timezone: res.user.timezone,
      });
      await loadDashboard();
      navigateTo('dashboard');
    } catch (err) {
      loginAlert.textContent = (err.data && err.data.error) || t('login.invalidCredentials');
      loginAlert.classList.remove('hidden');
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = t('login.signIn');
    }
  });

  // ---------------- Forgot password ----------------
  const forgotModal = document.getElementById('modal-forgot-password');
  const forgotFormState = document.getElementById('forgot-form-state');
  const forgotSentState = document.getElementById('forgot-sent-state');
  const forgotAlert = document.getElementById('forgot-alert');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotSubmitBtn = document.getElementById('forgot-submit-btn');

  document.getElementById('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    forgotEmailInput.value = document.getElementById('email').value.trim();
    forgotAlert.classList.add('hidden');
    forgotFormState.classList.remove('hidden');
    forgotSentState.classList.add('hidden');
    forgotModal.classList.remove('hidden');
  });

  document.getElementById('forgot-cancel-btn').addEventListener('click', () => {
    forgotModal.classList.add('hidden');
  });

  forgotSubmitBtn.addEventListener('click', async () => {
    const email = forgotEmailInput.value.trim();
    forgotAlert.classList.add('hidden');
    if (!email) {
      forgotAlert.textContent = t('forgot.emailRequired');
      forgotAlert.classList.remove('hidden');
      return;
    }
    forgotSubmitBtn.disabled = true;
    forgotSubmitBtn.textContent = t('forgot.sending');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      forgotFormState.classList.add('hidden');
      forgotSentState.classList.remove('hidden');
    } catch (err) {
      forgotAlert.textContent = (err.data && err.data.error) || t('forgot.genericError');
      forgotAlert.classList.remove('hidden');
    } finally {
      forgotSubmitBtn.disabled = false;
      forgotSubmitBtn.textContent = t('forgot.send');
    }
  });

  document.getElementById('forgot-done-btn').addEventListener('click', () => {
    forgotModal.classList.add('hidden');
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    state.session = null;
    show('login');
    bottomNav.classList.add('hidden');
  });

  const notificationsModal = document.getElementById('modal-notifications');
  document.getElementById('notifications-btn').addEventListener('click', () => {
    notificationsModal.classList.remove('hidden');
    document.getElementById('notifications-dot').classList.add('hidden');
  });
  document.getElementById('notifications-close-btn').addEventListener('click', () => {
    notificationsModal.classList.add('hidden');
  });

  // ---------------- Shared card rendering ----------------
  function dateLocale() {
    return { es: 'es-ES', it: 'it-IT', en: 'en-US' }[window.FireGuardI18n.currentLang] || 'en-US';
  }

  function formatDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    const tz = state.session && state.session.timezone;
    try {
      return date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz || undefined });
    } catch (e) {
      return date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  function statusLabel(status) {
    if (status === 'ok') return t('status.ok');
    if (status === 'due_soon') return t('status.dueSoon');
    return t('status.overdue');
  }

  const TYPE_I18N_KEY = {
    'ABC Dry Powder': 'type.abcDryPowder',
    'CO2 Gas': 'type.co2Gas',
    'Wet Chemical': 'type.wetChemical',
    Foam: 'type.foam',
    Water: 'type.water',
  };

  function typeLabel(rawType) {
    const key = TYPE_I18N_KEY[rawType];
    return key ? t(key) : rawType;
  }

  function buildCardHTML(item) {
    return `
      <div class="unit-head">
        <div class="unit-name">
          <span class="unit-flame">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c1 3-3 4.5-3 8 0 2.5 1.8 4 3 4s3-1.5 3-4c0-1.5-1-2.5-1-3.5 2 1 3.5 3.5 3.5 6.5 0 3.5-2.7 6-5.5 6s-5.5-2.5-5.5-6c0-5 4-6.5 5.5-11z"/></svg>
          </span>
          ${item.code}
        </div>
        <span class="badge badge-${item.status}">${statusLabel(item.status)}</span>
      </div>
      <div class="unit-location">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>
        ${item.location}
      </div>
      <div class="unit-grid">
        <div><div class="label">${t('card.type')}</div><div class="value">${typeLabel(item.type)}</div></div>
        <div><div class="label">${t('card.weight')}</div><div class="value">${item.weightKg != null ? item.weightKg + ' kg' : '—'}</div></div>
      </div>
      <hr class="unit-sep" />
      <div class="unit-dates">
        <div><div class="label">${t('card.lastInspected')}</div><div>${formatDate(item.lastInspected)}</div></div>
        <div class="right"><div class="label">${t('card.nextDue')}</div><div>${formatDate(item.nextDue)}</div></div>
      </div>
    `;
  }

  function renderCardsInto(container, empty, items, origin) {
    container.innerHTML = '';
    if (items.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = buildCardHTML(item);
      card.addEventListener('click', () => openDetail(item.code, origin));
      container.appendChild(card);
    });
  }

  // ---------------- Home Dashboard ----------------
  function renderList() {
    const list = document.getElementById('units-list');
    const empty = document.getElementById('units-empty');

    let items = state.items;
    if (state.filter !== 'all') items = items.filter((i) => i.status === state.filter);
    if (state.search) {
      const q = state.search.toLowerCase();
      items = items.filter((i) => i.code.toLowerCase().includes(q) || i.location.toLowerCase().includes(q));
    }
    renderCardsInto(list, empty, items, 'dashboard');
  }

  function renderSummary() {
    document.getElementById('stat-total').textContent = state.summary.total;
    document.getElementById('stat-ok').textContent = state.summary.ok;
    document.getElementById('stat-due-soon').textContent = state.summary.dueSoon;

    const banner = document.getElementById('overdue-banner');
    if (state.summary.overdue > 0) {
      document.getElementById('overdue-banner-title').textContent =
        `${state.summary.overdue} ${t(state.summary.overdue === 1 ? 'home.overdueSingular' : 'home.overduePlural')}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  async function loadDashboard() {
    const data = await api('/extinguishers');
    state.items = data.items;
    state.summary = data.summary;
    renderSummary();
    renderList();
  }

  document.getElementById('filter-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('#filter-row .chip').forEach((c) => c.classList.remove('chip-active'));
    btn.classList.add('chip-active');
    state.filter = btn.dataset.filter;
    renderList();
  });

  document.getElementById('search-toggle').addEventListener('click', () => {
    const bar = document.getElementById('search-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) document.getElementById('search-input').focus();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderList();
  });

  // ---------------- Units (map) ----------------
  async function loadUnits() {
    const data = await api('/sites');
    state.sites = data.sites;

    const mapEl = document.getElementById('units-map');
    if (!state.map) {
      state.map = L.map(mapEl, { scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(state.map);
      state.markersLayer = L.layerGroup().addTo(state.map);
    }

    state.markersLayer.clearLayers();

    const points = state.sites.filter((s) => s.total > 0);
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((s) => [s.lat, s.lng]));
      state.map.fitBounds(bounds.pad(0.3));
    } else {
      state.map.setView([40.0, -3.7], 5);
    }

    points.forEach((site) => {
      const needs = site.needsIntervention;
      const cls = needs > 0 ? 'map-bubble-warn' : 'map-bubble-ok';
      const label = needs > 0 ? String(needs) : t('units.legend.ok').split(' ')[0];
      const icon = L.divIcon({
        className: '',
        html: `<div class="map-bubble ${cls}">${label}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      const marker = L.marker([site.lat, site.lng], { icon }).addTo(state.markersLayer);
      marker.on('click', () => {
        if (needs > 0) {
          state.inspectFilter = { siteId: site.id, siteName: site.name, statuses: ['due_soon', 'overdue'] };
          navigateTo('inspect');
        } else {
          marker.bindPopup(`${site.name} — ${t('units.legend.ok')}`).openPopup();
        }
      });
    });

    requestAnimationFrame(() => state.map && state.map.invalidateSize());
  }

  // ---------------- Inspect ----------------
  document.getElementById('inspect-clear-filter').addEventListener('click', () => {
    state.inspectFilter = null;
    loadInspect().catch(() => {});
  });

  const inspectLocationModal = document.getElementById('modal-inspect-location');

  function renderInspectLocationList(sites) {
    const list = document.getElementById('inspect-location-list');
    const empty = document.getElementById('inspect-location-empty');
    const affected = sites.filter((s) => s.needsIntervention > 0);

    list.innerHTML = '';
    empty.classList.toggle('hidden', affected.length > 0);

    const activeSiteId = state.inspectFilter && state.inspectFilter.siteId;

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'location-item' + (!activeSiteId ? ' location-item-active' : '');
    allBtn.innerHTML = `<span>${t('inspect.allLocations')}</span>`;
    allBtn.addEventListener('click', () => {
      state.inspectFilter = null;
      inspectLocationModal.classList.add('hidden');
      loadInspect().catch(() => {});
    });
    list.appendChild(allBtn);

    affected.forEach((site) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'location-item' + (activeSiteId === site.id ? ' location-item-active' : '');
      btn.innerHTML = `<span>${site.name}</span><span class="location-item-badge">${site.needsIntervention}</span>`;
      btn.addEventListener('click', () => {
        state.inspectFilter = { siteId: site.id, siteName: site.name, statuses: ['due_soon', 'overdue'] };
        inspectLocationModal.classList.add('hidden');
        loadInspect().catch(() => {});
      });
      list.appendChild(btn);
    });
  }

  document.getElementById('inspect-location-filter-btn').addEventListener('click', async () => {
    inspectLocationModal.classList.remove('hidden');
    try {
      const data = await api('/sites');
      state.sites = data.sites;
      renderInspectLocationList(state.sites);
    } catch (e) {
      renderInspectLocationList([]);
    }
  });

  document.getElementById('inspect-location-cancel-btn').addEventListener('click', () => {
    inspectLocationModal.classList.add('hidden');
  });

  async function loadInspect() {
    const filter = state.inspectFilter;
    const params = new URLSearchParams();
    if (filter && filter.siteId) params.set('siteId', filter.siteId);
    params.set('status', (filter && filter.statuses ? filter.statuses : ['due_soon', 'overdue']).join(','));

    const data = await api('/extinguishers?' + params.toString());

    const banner = document.getElementById('inspect-filter-banner');
    const title = document.getElementById('inspect-filter-title');
    if (filter && filter.siteId) {
      banner.classList.remove('hidden');
      title.textContent = `${filter.siteName} — ${data.items.length}`;
    } else {
      banner.classList.add('hidden');
    }

    const list = document.getElementById('inspect-list');
    const empty = document.getElementById('inspect-empty');
    renderCardsInto(list, empty, data.items, 'inspect');
  }

  // ---------------- Detail ----------------
  function toISODate(d) {
    if (!d) return '';
    return new Date(d).toISOString().slice(0, 10);
  }

  function renderDetail(item) {
    document.getElementById('detail-code').textContent = item.code;
    document.getElementById('detail-location').textContent = item.location;
    document.getElementById('detail-type').value = item.type;
    document.getElementById('detail-weight').value = item.weightKg != null ? item.weightKg + ' kg' : '—';
    document.getElementById('detail-pressure').value = item.pressureBar != null ? item.pressureBar + ' bar' : '';
    document.getElementById('detail-last-inspected').value = toISODate(item.lastInspected);
    document.getElementById('detail-next-due').value = toISODate(item.nextDue);
    document.getElementById('detail-serial').value = item.serialNumber || '';

    document.querySelectorAll('.segment-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.status === item.status);
    });

    const alertBox = document.getElementById('detail-alert');
    const alertTitle = document.getElementById('detail-alert-title');
    const alertSub = document.getElementById('detail-alert-sub');
    if (item.status === 'overdue') {
      alertBox.classList.remove('hidden');
      alertBox.className = 'banner banner-error';
      alertTitle.textContent = t('detail.overdueTitle');
      alertSub.textContent = t('detail.overdueSub');
    } else if (item.status === 'due_soon') {
      alertBox.classList.remove('hidden');
      alertBox.className = 'banner banner-warn';
      alertTitle.textContent = t('detail.dueSoonTitle');
      alertSub.textContent = t('detail.dueSoonSub');
    } else {
      alertBox.classList.add('hidden');
    }

    document.getElementById('detail-toast').classList.add('hidden');
  }

  async function openDetail(code, origin) {
    const item = await api('/extinguishers/' + encodeURIComponent(code));
    state.currentCode = code;
    state.currentItem = item;
    state.detailOrigin = origin || 'dashboard';
    renderDetail(item);
    show('detail');
    bottomNav.classList.add('hidden');
  }

  function backFromDetail() {
    navigateTo(state.detailOrigin);
  }

  document.getElementById('back-btn').addEventListener('click', backFromDetail);
  document.getElementById('cancel-btn').addEventListener('click', () => {
    if (state.currentItem) renderDetail(state.currentItem);
    backFromDetail();
  });

  function parseNumber(str) {
    const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  document.getElementById('save-btn').addEventListener('click', async () => {
    const payload = {
      type: document.getElementById('detail-type').value,
      pressureBar: parseNumber(document.getElementById('detail-pressure').value),
      lastInspected: document.getElementById('detail-last-inspected').value || null,
      nextDue: document.getElementById('detail-next-due').value || null,
      serialNumber: document.getElementById('detail-serial').value,
    };
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    try {
      const updated = await api('/extinguishers/' + encodeURIComponent(state.currentCode), {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.currentItem = updated;
      renderDetail(updated);
      const toast = document.getElementById('detail-toast');
      toast.textContent = t('toast.changesSaved');
      toast.classList.remove('hidden');
    } catch (err) {
      alert((err.data && err.data.error) || t('errors.requestFailed'));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('inspect-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('inspect-now-btn');
    btn.disabled = true;
    try {
      const updated = await api('/extinguishers/' + encodeURIComponent(state.currentCode) + '/inspect-now', {
        method: 'POST',
      });
      state.currentItem = updated;
      renderDetail(updated);
      const toast = document.getElementById('detail-toast');
      toast.textContent = t('toast.inspectionToday');
      toast.classList.remove('hidden');
    } catch (err) {
      alert((err.data && err.data.error) || t('errors.requestFailed'));
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- Reports ----------------
  const CHART_COLORS = ['#3B82F6', '#DC2626', '#16A34A', '#B45309', '#7C3AED', '#0EA5E9', '#DB2777'];

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  async function loadReports() {
    const [summary, activity, forecast, forecastByType, recent] = await Promise.all([
      api('/reports/summary'),
      api('/reports/activity'),
      api('/reports/forecast?months=12'),
      api('/reports/forecast-by-type?months=12'),
      api('/reports/recent?limit=10'),
    ]);

    destroyChart('summary');
    state.charts.summary = new Chart(document.getElementById('chart-summary'), {
      type: 'doughnut',
      data: {
        labels: [t('status.ok'), t('status.dueSoon'), t('status.overdue')],
        datasets: [{ data: [summary.ok, summary.dueSoon, summary.overdue], backgroundColor: ['#16A34A', '#B45309', '#DC2626'] }],
      },
      options: { plugins: { legend: { position: 'bottom' } } },
    });

    destroyChart('activity');
    state.charts.activity = new Chart(document.getElementById('chart-activity'), {
      type: 'bar',
      data: {
        labels: ['Inspecciones realizadas', 'Cambios a OK'],
        datasets: [{ data: [activity.inspected, activity.statusChangedToOk], backgroundColor: ['#3B82F6', '#16A34A'] }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    destroyChart('forecast');
    state.charts.forecast = new Chart(document.getElementById('chart-forecast'), {
      type: 'line',
      data: {
        labels: forecast.months.map((m) => monthLabel(m.month)),
        datasets: [{ label: t('reports.forecast'), data: forecast.months.map((m) => m.count), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, tension: 0.3 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    destroyChart('forecastType');
    const typeSelect = document.getElementById('forecast-type-filter');
    if (!state.reportsTypesLoaded) {
      forecastByType.series.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.type;
        opt.textContent = typeLabel(s.type);
        typeSelect.appendChild(opt);
      });
      state.reportsTypesLoaded = true;
    }
    state.charts.forecastType = new Chart(document.getElementById('chart-forecast-type'), {
      type: 'line',
      data: {
        labels: forecastByType.months.map(monthLabel),
        datasets: forecastByType.series.map((s, i) => ({
          label: typeLabel(s.type),
          rawType: s.type,
          data: s.counts,
          borderColor: CHART_COLORS[i % CHART_COLORS.length],
          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
          tension: 0.3,
        })),
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    applyForecastTypeFilter();

    const log = document.getElementById('reports-log');
    log.innerHTML = '';
    recent.items.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const actionLabel = entry.action === 'inspected'
        ? t('reports.action.inspected')
        : `${entry.previousStatus ? statusLabel(entry.previousStatus) : '—'} → ${entry.newStatus ? statusLabel(entry.newStatus) : '—'}`;
      row.innerHTML = `
        <div class="log-code">${entry.code}</div>
        <div class="log-type">${typeLabel(entry.type)}</div>
        <div class="log-action">${actionLabel}</div>
        <div class="log-date">${formatDate(entry.performedAt)}</div>
      `;
      log.appendChild(row);
    });
  }

  function applyForecastTypeFilter() {
    const chart = state.charts.forecastType;
    if (!chart) return;
    const value = document.getElementById('forecast-type-filter').value;
    chart.data.datasets.forEach((ds) => {
      ds.hidden = value ? ds.rawType !== value : false;
    });
    chart.update();
  }

  document.getElementById('forecast-type-filter').addEventListener('change', applyForecastTypeFilter);

  // ---------------- Settings ----------------
  function bindSettingsOnce() {
    if (state.settingsBound) return;
    state.settingsBound = true;

    document.getElementById('setting-timezone').addEventListener('change', async (e) => {
      const timezone = e.target.value;
      try {
        await api('/settings/me', { method: 'PUT', body: JSON.stringify({ timezone }) });
        state.session.timezone = timezone;
        const toast = document.getElementById('settings-toast');
        toast.textContent = t('toast.saved');
        toast.classList.remove('hidden');
      } catch (err) {
        alert((err.data && err.data.error) || t('errors.requestFailed'));
      }
    });

    document.getElementById('settings-password-btn').addEventListener('click', async () => {
      const currentPassword = document.getElementById('setting-current-password').value;
      const newPassword = document.getElementById('setting-new-password').value;
      const alertBox = document.getElementById('settings-password-alert');
      alertBox.classList.add('hidden');
      try {
        await api('/settings/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
        document.getElementById('setting-current-password').value = '';
        document.getElementById('setting-new-password').value = '';
        const toast = document.getElementById('settings-toast');
        toast.textContent = t('toast.passwordUpdated');
        toast.classList.remove('hidden');
      } catch (err) {
        alertBox.textContent = (err.data && err.data.error) || t('errors.passwordUpdateFailed');
        alertBox.classList.remove('hidden');
      }
    });

    bindSettingsUsersOnce();
  }

  function updateUsersToolbarState() {
    const n = state.selectedUserIds.size;
    document.getElementById('settings-users-delete-btn').disabled = n === 0;
    document.getElementById('settings-users-reset-btn').disabled = n !== 1;
    document.getElementById('settings-users-hint').classList.toggle('hidden', n <= 1);
  }

  function renderUsersList(users) {
    state.selectedUserIds.clear();
    updateUsersToolbarState();

    const container = document.getElementById('settings-users-list');
    container.innerHTML = '';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <label class="user-row-check">
          <input type="checkbox" data-id="${u.id}" />
        </label>
        <div class="user-row-info">
          <div class="user-row-email">${u.email}</div>
          <div class="user-row-meta">${u.fullName || ''} · ${u.role}${u.locked ? ` · <span class="user-locked">${t('settings.users.locked')}</span>` : ''}</div>
        </div>
        <div class="user-row-actions">
          <button class="link-btn" data-action="${u.locked ? 'unlock' : 'lock'}" data-id="${u.id}">${u.locked ? t('settings.users.unlock') : t('settings.users.lock')}</button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.selectedUserIds.add(cb.dataset.id);
        else state.selectedUserIds.delete(cb.dataset.id);
        updateUsersToolbarState();
      });
    });

    container.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        try {
          await api(`/settings/users/${id}/${action}`, { method: 'POST' });
          await loadSettingsUsers();
        } catch (err) {
          alert((err.data && err.data.error) || t('errors.requestFailed'));
        }
      });
    });
  }

  async function loadSettingsUsers() {
    const data = await api('/settings/users');
    renderUsersList(data.users);
  }

  function openUserCredentialsModal(email, password, title) {
    document.getElementById('user-creds-title').textContent = title;
    document.getElementById('user-creds-email').textContent = email;
    document.getElementById('user-creds-password').textContent = password;
    const copyBtn = document.getElementById('user-creds-copy-btn');
    copyBtn.textContent = t('settings.users.copyPassword');
    document.getElementById('modal-user-credentials').classList.remove('hidden');
  }

  function bindSettingsUsersOnce() {
    const createModal = document.getElementById('modal-create-user');
    const createAlert = document.getElementById('create-user-alert');
    const usersAlert = document.getElementById('settings-users-alert');

    document.getElementById('settings-users-create-btn').addEventListener('click', () => {
      document.getElementById('create-user-email').value = '';
      document.getElementById('create-user-fullname').value = '';
      document.getElementById('create-user-role').value = 'inspector';
      document.getElementById('create-user-password').value = '';
      createAlert.classList.add('hidden');
      createModal.classList.remove('hidden');
    });

    document.getElementById('create-user-cancel-btn').addEventListener('click', () => {
      createModal.classList.add('hidden');
    });

    document.getElementById('create-user-submit-btn').addEventListener('click', async () => {
      const email = document.getElementById('create-user-email').value.trim();
      const fullName = document.getElementById('create-user-fullname').value.trim();
      const role = document.getElementById('create-user-role').value;
      const password = document.getElementById('create-user-password').value.trim();
      createAlert.classList.add('hidden');

      const btn = document.getElementById('create-user-submit-btn');
      btn.disabled = true;
      try {
        const payload = { email, fullName, role };
        if (password) payload.password = password;
        const created = await api('/settings/users', { method: 'POST', body: JSON.stringify(payload) });
        createModal.classList.add('hidden');
        await loadSettingsUsers();
        openUserCredentialsModal(created.email, created.password, t('settings.users.userCreated'));
      } catch (err) {
        createAlert.textContent = (err.data && err.data.error) || t('settings.users.errCreate');
        createAlert.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('settings-users-delete-btn').addEventListener('click', async () => {
      const ids = Array.from(state.selectedUserIds);
      if (ids.length === 0) return;
      if (!confirm(t('settings.users.confirmDelete'))) return;
      usersAlert.classList.add('hidden');
      const results = await Promise.allSettled(ids.map((id) => api(`/settings/users/${id}`, { method: 'DELETE' })));
      await loadSettingsUsers();
      const firstFailure = results.find((r) => r.status === 'rejected');
      if (firstFailure) {
        usersAlert.textContent = (firstFailure.reason.data && firstFailure.reason.data.error) || t('settings.users.errDelete');
        usersAlert.classList.remove('hidden');
      }
    });

    document.getElementById('settings-users-reset-btn').addEventListener('click', async () => {
      const ids = Array.from(state.selectedUserIds);
      if (ids.length !== 1) return;
      usersAlert.classList.add('hidden');
      try {
        const result = await api(`/settings/users/${ids[0]}/reset-password`, { method: 'POST' });
        await loadSettingsUsers();
        openUserCredentialsModal(result.email, result.password, t('settings.users.passwordUpdatedAlert'));
      } catch (err) {
        usersAlert.textContent = (err.data && err.data.error) || t('settings.users.errReset');
        usersAlert.classList.remove('hidden');
      }
    });

    document.getElementById('user-creds-copy-btn').addEventListener('click', async () => {
      const password = document.getElementById('user-creds-password').textContent;
      const copyBtn = document.getElementById('user-creds-copy-btn');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(password);
        } else {
          const ta = document.createElement('textarea');
          ta.value = password;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        copyBtn.textContent = t('settings.users.copied');
        setTimeout(() => { copyBtn.textContent = t('settings.users.copyPassword'); }, 1500);
      } catch (e) { /* clipboard unavailable */ }
    });

    document.getElementById('user-creds-done-btn').addEventListener('click', () => {
      document.getElementById('modal-user-credentials').classList.add('hidden');
    });
  }

  async function loadSettings() {
    bindSettingsOnce();
    const me = await api('/settings/me');
    state.session = { ...(state.session || {}), ...me };
    document.getElementById('setting-timezone').value = me.timezone;
    document.getElementById('settings-admin-card').classList.toggle('hidden', me.role !== 'admin');
    if (me.role === 'admin') {
      loadSettingsUsers().catch(() => {});
    }
  }

  // ---------------- Prefs (language / theme) ----------------
  // Two copies of the controls exist (login screen + dashboard topbar); keep
  // both in sync with the same cookie-backed preference, same pattern as the
  // admin panel.
  const langSelects = [document.getElementById('lang-select'), document.getElementById('app-lang-select')];
  const themeToggleBtns = [document.getElementById('theme-toggle-btn'), document.getElementById('app-theme-toggle-btn')];
  const themeSunIcons = [document.getElementById('theme-icon-sun'), document.getElementById('app-theme-icon-sun')];
  const themeMoonIcons = [document.getElementById('theme-icon-moon'), document.getElementById('app-theme-icon-moon')];

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
  }

  langSelects.forEach((el) => {
    el.addEventListener('change', () => {
      window.FireGuardPrefs.setPreferredLang(el.value);
      window.FireGuardI18n.applyI18n(el.value);
      langSelects.forEach((other) => { other.value = el.value; });
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

  // ---------------- Boot ----------------
  async function boot() {
    checkHealth();
    setInterval(checkHealth, 30000);
    applyStoredPrefs();

    try {
      const me = await api('/auth/me');
      let settings = null;
      try { settings = await api('/settings/me'); } catch (e) { /* ignore */ }
      applySession({
        role: me.session.role,
        email: me.session.email,
        timezone: (settings && settings.timezone) || 'Europe/Madrid',
      });
      await loadDashboard();
      navigateTo('dashboard');
    } catch (e) {
      show('login');
      bottomNav.classList.add('hidden');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
  }

  boot();
})();
