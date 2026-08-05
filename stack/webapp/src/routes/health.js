const express = require('express');
const { checkDirectoryHealth } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const ok = await checkDirectoryHealth();
  res.status(ok ? 200 : 503).json({ ready: ok });
});

module.exports = router;
