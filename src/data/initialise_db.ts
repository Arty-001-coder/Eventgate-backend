import DatabaseConstructor, { Database } from "better-sqlite3";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export const staticDbChanged = true;

const DB_PATH__STATIC = path.resolve(__dirname, "static.db");
const DB_PATH__DYNAMIC = path.resolve(__dirname, "dynamic.db");

// Export the two database instances
export const staticDb = new DatabaseConstructor(DB_PATH__STATIC);
export const dynamicDb = new DatabaseConstructor(DB_PATH__DYNAMIC);

// Enable Foreign Keys & WAL
staticDb.pragma('foreign_keys = ON');
staticDb.pragma('journal_mode = WAL');

dynamicDb.pragma('foreign_keys = ON');
dynamicDb.pragma('journal_mode = WAL');

export function intialiseDB() {
  console.log("✅ Databases initialized");

  // --- Static DB (Identity & Access) ---
  staticDb.exec(`
    CREATE TABLE IF NOT EXISTS club_identity (
      club_id TEXT PRIMARY KEY,
      club_name TEXT NOT NULL,
      club_secret TEXT NOT NULL UNIQUE,
      admin_secret TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_club_secret ON club_identity(club_secret);
    CREATE INDEX IF NOT EXISTS idx_club_id ON club_identity(club_id);
    
    CREATE TABLE IF NOT EXISTS club_members (
      member_id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      name TEXT NOT NULL,
      roll_no TEXT NOT NULL,
      last_login INTEGER DEFAULT 0,
      FOREIGN KEY(club_id) REFERENCES club_identity(club_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_members_club_id ON club_members(club_id);
    CREATE INDEX IF NOT EXISTS idx_members_roll_no ON club_members(roll_no);
    
    CREATE TABLE IF NOT EXISTS council (
      council_id TEXT PRIMARY KEY,
      council_name TEXT NOT NULL,
      council_secret TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_council_id ON council(council_id);

    CREATE TABLE IF NOT EXISTS admin_access (
      council_id TEXT NOT NULL,
      name TEXT NOT NULL,
      roll_no TEXT NOT NULL,
      last_login INTEGER DEFAULT 0,
      PRIMARY KEY (council_id, roll_no),
      FOREIGN KEY(council_id) REFERENCES council(council_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_admin_council_id ON admin_access(council_id);
    CREATE INDEX IF NOT EXISTS idx_admin_roll_no ON admin_access(roll_no);
  `);
  
  // Add admin_secret column to existing club_identity tables (migration)
  try {
    staticDb.exec(`ALTER TABLE club_identity ADD COLUMN admin_secret TEXT`);
    console.log("✅ Added admin_secret column to club_identity table");
  } catch (e: any) {
    // Column already exists or table doesn't exist yet (will be created with column)
    if (e.message && !e.message.includes('duplicate column')) {
      console.log("ℹ️ admin_secret column migration:", e.message);
    }
  }

  // --- Dynamic DB (Events & Requests) ---
  dynamicDb.exec(`
    CREATE TABLE IF NOT EXISTS club_events (
      event_id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      event_data JSON NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected', 'modified')) DEFAULT 'pending',
      event_name TEXT GENERATED ALWAYS AS (json_extract(event_data, '$.event_name')) VIRTUAL,
      event_timestamp INTEGER GENERATED ALWAYS AS (json_extract(event_data, '$.event_timestamp')) VIRTUAL
    );
    CREATE INDEX IF NOT EXISTS idx_events_dedupe ON club_events(club_id, event_name, event_timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_club_id ON club_events(club_id);
    
    CREATE TABLE IF NOT EXISTS online_members (
      club_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      socket_id TEXT NOT NULL,
      PRIMARY KEY (club_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_online_club_id ON online_members(club_id);
    
    CREATE TABLE IF NOT EXISTS club_creation_requests (
      request_id TEXT PRIMARY KEY,
      club_name TEXT NOT NULL,
      club_secret TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      creator_rollNo TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_req_secret ON club_creation_requests(club_secret);
    CREATE INDEX IF NOT EXISTS idx_req_secret_status ON club_creation_requests(club_secret, status);
    
    CREATE TABLE IF NOT EXISTS club_join_requests (
      request_id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      name TEXT NOT NULL,
      roll_no TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_join_club_id ON club_join_requests(club_id);
    CREATE INDEX IF NOT EXISTS idx_join_roll_no ON club_join_requests(roll_no);

    CREATE TABLE IF NOT EXISTS admin_access_requests (
      request_id TEXT PRIMARY KEY,
      council_id TEXT NOT NULL,
      name TEXT NOT NULL,
      roll_no TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_adm_req_council_id ON admin_access_requests(council_id);
  `);
  
  // Initialize STC council if it doesn't exist
  try {
    // Check if STC council already exists
    const existingCouncil = staticDb.prepare("SELECT council_id FROM council WHERE council_name = ? AND council_secret = ?").get('STC', 'STCsecret101') as { council_id?: string } | undefined;
    
    if (!existingCouncil) {
      // Insert STC council
      const stcCouncilId = uuidv4();
      staticDb.prepare(`
        INSERT INTO council (council_id, council_name, council_secret)
        VALUES (?, ?, ?)
      `).run(stcCouncilId, 'STC', 'STCsecret101');
      
      console.log(`✅ Inserted STC council with ID: ${stcCouncilId}`);
      
      // Insert admin access for Antrin Maji
      try {
        staticDb.prepare(`
          INSERT INTO admin_access (council_id, name, roll_no, last_login)
          VALUES (?, ?, ?, ?)
        `).run(stcCouncilId, 'Antrin Maji', 'IMS24038', Date.now());
        
        console.log(`✅ Inserted admin access for Antrin Maji (IMS24038) in STC council`);
      } catch (e: any) {
        if (e.message && !e.message.includes('UNIQUE constraint')) {
          console.error("❌ Failed to insert admin access:", e);
        }
      }
    } else {
      // Check if Antrin Maji admin access exists
      const existingAdmin = staticDb.prepare("SELECT roll_no FROM admin_access WHERE council_id = ? AND roll_no = ?").get(existingCouncil.council_id, 'IMS24038') as { roll_no?: string } | undefined;
      
      if (!existingAdmin) {
        try {
          staticDb.prepare(`
            INSERT INTO admin_access (council_id, name, roll_no, last_login)
            VALUES (?, ?, ?, ?)
          `).run(existingCouncil.council_id, 'Antrin Maji', 'IMS24038', Date.now());
          
          console.log(`✅ Inserted admin access for Antrin Maji (IMS24038) in STC council`);
        } catch (e: any) {
          if (e.message && !e.message.includes('UNIQUE constraint')) {
            console.error("❌ Failed to insert admin access:", e);
          }
        }
      }
      console.log(`ℹ️ STC council already exists, skipping insertion`);
    }
  } catch (e: any) {
    console.error("❌ Failed to initialize STC council:", e);
  }
  
  console.log("✅ Database initialization complete");
  
  return { staticDb, dynamicDb };
}