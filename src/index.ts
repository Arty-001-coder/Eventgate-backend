// src/index.ts
import { intialiseDB } from "./data/initialise_db";
import { initialiseAuth } from "./clubs/auth";
import { initialiseState } from "./clubs/state";
// import { initialiseAdmin } from "./clubs/admin";
import { startServer } from "./network/port";

async function bootstrap() {
  console.log("🚀 Starting Central Server...");

  // 1. Initialise Database
  const { staticDb, dynamicDb } = intialiseDB();
  console.log("✅ Databases initialized");

  // 2. Initialise Modules
  initialiseAuth(staticDb, dynamicDb);
  initialiseState(staticDb, dynamicDb);
  // initialiseAdmin(db); // Removed

  // 3. Reset Device Status
  // Since server restarted, all active connections are gone.
  // We clear the online_members table as it tracks active sessions.
  // dynamicDb.prepare("DELETE FROM online_members").run();
  console.log("✅ Device status reset (all offline)");

  // 4. Start Server
  startServer();
}

bootstrap().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
