// Simple test script to verify health endpoint
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

console.log(`Testing health endpoint at ${BACKEND_URL}/health...`);

const req = http.get(`${BACKEND_URL}/health`, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ Health check successful!');
      console.log('Response:', data);
      process.exit(0);
    } else {
      console.log(`❌ Health check failed with status ${res.statusCode}`);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.log('❌ Connection error:', error.message);
  console.log('Make sure the server is running on', BACKEND_URL);
  process.exit(1);
});

req.setTimeout(5000, () => {
  console.log('❌ Request timeout');
  req.destroy();
  process.exit(1);
});

