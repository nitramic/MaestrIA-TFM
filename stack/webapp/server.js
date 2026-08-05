const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const authRoutes = require('./src/routes/auth');
const extinguisherRoutes = require('./src/routes/extinguishers');
const healthRoutes = require('./src/routes/health');
const adminRoutes = require('./src/routes/admin');
const internalRoutes = require('./src/routes/internal');
const sitesRoutes = require('./src/routes/sites');
const reportsRoutes = require('./src/routes/reports');
const settingsRoutes = require('./src/routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// The app always sits behind exactly one hop (the Apache lb), which sets
// X-Forwarded-For. Without this, express-rate-limit refuses to trust that
// header and throws on every rate-limited request routed through the lb.
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/extinguishers', extinguisherRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);

// Only reachable over the internal fireguard-net overlay network (this
// service isn't published to the host); protected by a shared-secret header
// checked inside internalRoutes. Real provisioning power (docker socket)
// only exists on the dedicated admin-worker service.
app.use('/internal', internalRoutes);

app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use('/vendor/chartjs', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/internal/')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FireGuard webapp listening on port ${PORT}`);
});
