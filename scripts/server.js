const express = require('express');
const path = require('path');

function createServer(root = path.join(__dirname, '..', 'dist')) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(root));
  return app;
}

function listenLocal(app, port = 8080) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', error => {
      if (error) reject(error);
      else resolve(server);
    });
  });
}

module.exports = { createServer, listenLocal };
