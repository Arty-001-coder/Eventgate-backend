
import WebSocket from 'ws';
import Database from 'better-sqlite3';



const dbPath = '/Users/antrinmaji/Desktop/EventGate/backend/src/data/dynamic.db';
const dynamicDb = new Database(dbPath, { readonly: true }); // Read only to avoid locking if possible

// Debug: List tables
try {
    const tables = dynamicDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables in DB:', tables.map((t:any) => t.name));
} catch (e) {
    console.error("Failed to list tables:", e);
}

const ws = new WebSocket('ws://localhost:8080');

const TEST_SECRET = 'admin123';
const CLUB_SECRET = `club123_${Date.now()}`;

ws.on('open', () => {
    console.log('Connected to server');
    
    // Send Creation Request
    ws.send(JSON.stringify({
        kind: 'Create_Club_Network',
        council_id: '102ca18c-6733-4a40-951f-3862f6ca3573', // Using the known STC council ID from server logs
        club_name: 'Test Admin Club',
        creator_name: 'Tester',
        creator_roll: 'TEST001',
        club_secret: CLUB_SECRET,
        admin_secret: TEST_SECRET,
        timestamp: Date.now()
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
    
    if (msg.kind === 'creation_request_sent') {
        setTimeout(() => {
            // Check DB
            try {
                const req = dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE club_secret = ?").get(CLUB_SECRET) as any;
                if (req && req.admin_secret === TEST_SECRET) {
                    console.log('✅ SUCCESS: Admin secret stored correctly in request!');
                } else {
                    console.error('❌ FAILURE: Admin secret mismatch or not found.', req);
                }
            } catch (e) {
                console.error('❌ DB Check Failed:', e);
            }
            process.exit(0);
        }, 1000); // Wait for DB write
    }
    
    if (msg.kind === 'error') {
        console.error('❌ Server Error:', msg.error);
        process.exit(1);
    }
});
