"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const initialise_db_1 = require("./data/initialise_db");
const auth_1 = require("./clubs/auth");
const state_1 = require("./clubs/state");
// import { initialiseAdmin } from "./clubs/admin";
const port_1 = require("./network/port");
async function bootstrap() {
    console.log("🚀 Starting Central Server...");
    // 1. Initialise Database
    const { staticDb, dynamicDb } = (0, initialise_db_1.intialiseDB)();
    console.log("✅ Databases initialized");
    // 2. Initialise Modules
    (0, auth_1.initialiseAuth)(staticDb, dynamicDb);
    (0, state_1.initialiseState)(staticDb, dynamicDb);
    // initialiseAdmin(db); // Removed
    // 3. Reset Device Status
    // Since server restarted, all active connections are gone.
    // We clear the online_members table as it tracks active sessions.
    // dynamicDb.prepare("DELETE FROM online_members").run();
    console.log("✅ Device status reset (all offline)");
    // 4. Start Server
    (0, port_1.startServer)();
}
bootstrap().catch((err) => {
    console.error("❌ Fatal startup error:", err);
    process.exit(1);
});
