const { createServer, listenLocal } = require('./server');

listenLocal(createServer()).then(() => {
  console.log('Preview running at http://127.0.0.1:8080/');
}).catch(error => {
  console.error('Preview failed to start:', error.message);
  process.exitCode = 1;
});
