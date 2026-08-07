const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'fireguard_' });

const httpRequestDuration = new client.Histogram({
  name: 'fireguard_http_request_duration_seconds',
  help: 'Duracion de requests HTTP en segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'fireguard_http_requests_total',
  help: 'Total de requests HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// result: success | invalid_credentials | unknown_account | account_locked_admin
//         | account_locked_temp | too_many_attempts | rate_limited | db_error
const loginAttemptsTotal = new client.Counter({
  name: 'fireguard_login_attempts_total',
  help: 'Intentos de login, por resultado y empresa',
  labelNames: ['result', 'company'],
  registers: [register],
});

module.exports = { register, httpRequestDuration, httpRequestsTotal, loginAttemptsTotal };
