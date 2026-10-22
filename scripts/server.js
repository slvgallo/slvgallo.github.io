const express = require('express');
const path = require('path');

function createServer(root = path.join(__dirname, '..', 'dist')) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(root));
  return app;
}

module.exports = { createServer };
