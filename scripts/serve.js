const { createServer } = require('./server');

createServer().listen(8080, '127.0.0.1', () => {
  console.log('Preview running at http://127.0.0.1:8080/');
});
