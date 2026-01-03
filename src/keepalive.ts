// Keepalive script to ping the server's own health endpoint
// This prevents Render from spinning down the service

import http from 'http';

const KEEPALIVE_INTERVAL = 12 * 60 * 1000; // 12 minutes
const PORT = process.env.PORT || 8080;
const HEALTH_URL = `http://localhost:${PORT}/health`;

function pingHealth() {
  const req = http.get(HEALTH_URL, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const parsed = JSON.parse(data);
          console.log(`✅ Keepalive ping successful at ${new Date().toLocaleTimeString()}:`, parsed);
        } catch (e) {
          console.log(`✅ Keepalive ping successful at ${new Date().toLocaleTimeString()}`);
        }
      } else {
        console.warn(`⚠️ Keepalive ping returned status ${res.statusCode}`);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Keepalive ping failed:', error.message);
  });

  req.setTimeout(5000, () => {
    console.warn('⚠️ Keepalive ping timeout');
    req.destroy();
  });
}

// Start keepalive after a short delay to ensure server is ready
export function startKeepalive() {
  setTimeout(() => {
    console.log(`🔄 Starting keepalive service (pinging every ${KEEPALIVE_INTERVAL / 1000 / 60} minutes)`);
    pingHealth(); // Ping immediately
    
    // Then ping every 12 minutes
    setInterval(pingHealth, KEEPALIVE_INTERVAL);
  }, 5000); // Wait 5 seconds for server to start
}

