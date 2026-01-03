"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventType = void 0;
exports.broadcastMonitorUpdate = broadcastMonitorUpdate;
exports.handleEvent = handleEvent;
const port_1 = require("./port");
const initialise_db_1 = require("../data/initialise_db");
const ws_1 = __importDefault(require("ws"));
const uuid_1 = require("uuid");
const fetch_data_1 = require("../clubs/fetch-data");
const state_1 = require("../clubs/state");
// Cleanup expired events every hour
// Removing events 24 hours after their event_date
function cleanupExpiredEvents() {
    console.log("🧹 Running cleanup for expired events...");
    try {
        // Calculate date for Yesterday (Current Date - 1 Day)
        // Format: YYYY-MM-DD
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        // Delete events where event_date < yesterday (meaning 24h passed since that date)
        // Note: event_date is YYYY-MM-DD string
        const result = initialise_db_1.dynamicDb.prepare("DELETE FROM club_events WHERE event_date < ?").run(yesterday);
        if (result.changes > 0) {
            console.log(`🧹 Deleted ${result.changes} expired events (older than ${yesterday})`);
            broadcastStateUpdate();
        }
    }
    catch (e) {
        console.error("Failed to cleanup expired events:", e);
    }
}
// Start Cleanup Interval (Every hour)
setInterval(cleanupExpiredEvents, 60 * 60 * 1000);
// Run once on startup
setTimeout(cleanupExpiredEvents, 5000);
// Helper for sync workflow
function performSync(clubId) {
    console.log(`🔄 Syncing data for club ${clubId}...`);
    (0, fetch_data_1.fetchClubData)(clubId)
        .then((data) => {
        (0, state_1.cacheClubState)(clubId, data);
        // Broadcast update to admins
        const allEvents = (0, state_1.getAllClubEvents)();
        (0, port_1.broadcastToAdmins)({ kind: "full_state", events: allEvents });
        console.log(`✅ Sync complete for ${clubId}`);
    })
        .catch((err) => {
        console.error(`❌ Failed to sync club ${clubId}:`, err);
    });
}
// ... [Skipping to Handlers] ...
var EventType;
(function (EventType) {
    EventType["Event_Accepted"] = "Event_Accepted";
    EventType["Event_Rejected"] = "Event_Rejected";
    EventType["Event_Notification"] = "Event_Notification";
    EventType["Club_Creation_Accepted"] = "Club_Creation_Accepted";
    EventType["Club_Creation_Rejected"] = "Club_Creation_Rejected";
    EventType["Admin_Access_Accepted"] = "Admin_Access_Accepted";
    EventType["Admin_Access_Rejected"] = "Admin_Access_Rejected";
    EventType["Data_Changed"] = "Data_Changed";
    EventType["Club_joining_Accepted"] = "Club_joining_Accepted";
    EventType["Club_joining_Rejected"] = "Club_joining_Rejected";
    EventType["Get_Club_Details"] = "Get_Club_Details";
    EventType["Get_Calendar_Events"] = "Get_Calendar_Events";
    EventType["Get_Councils"] = "Get_Councils";
    // New Granular Events
    EventType["Event_Created"] = "Event_Created";
    EventType["Event_Deleted"] = "Event_Deleted";
    // New Events
    EventType["Admin_Access_Request"] = "Admin_Access_Request";
    EventType["Admin_Access_Required"] = "Admin_Access_Required";
    EventType["Access_Club_Network"] = "Access_Club_Network";
    EventType["Create_Club_Network"] = "Create_Club_Network";
    EventType["Check_creation_request"] = "Check_creation_request";
    EventType["Check_join_request"] = "Check_join_request";
    // P2P Events2210
    EventType["p2p_handshake"] = "p2p_handshake";
    EventType["p2p_signal"] = "p2p_signal";
    // Monitor Events
    EventType["Monitor_Subscribe"] = "Monitor_Subscribe";
    EventType["Monitor_State"] = "Monitor_State";
    // Logout
    EventType["Member_Logout"] = "Member_Logout";
    // Admin Validation
    EventType["Validate_Club_Admin"] = "Validate_Club_Admin";
    EventType["Club_Admin_Valid"] = "Club_Admin_Valid";
    EventType["Club_Admin_Invalid"] = "Club_Admin_Invalid";
})(EventType || (exports.EventType = EventType = {}));
// Helper to broadcast state update
function broadcastStateUpdate() {
    const events = (0, state_1.getAllClubEvents)();
    const authRequests = require("../clubs/state").getAllAuthRequests();
    const registrations = require("../clubs/state").getAllRegistrations();
    (0, port_1.broadcastToAdmins)({
        kind: "full_state",
        events,
        authRequests,
        registrations
    });
}
function broadcastMonitorUpdate(clubId) {
    console.log(`📢 Broadcasting Monitor Update for ${clubId}`);
    const data = (0, state_1.getMonitorData)(clubId);
    (0, port_1.broadcastToClub)(clubId, { kind: "Monitor_State", data });
}
// Helper to broadcast club events to the specific club
// Helper to get club events payload
function getClubEventsPayload(clubId) {
    const events = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? ORDER BY rowid DESC").all(clubId);
    return events.map((e) => ({
        event_id: e.event_id,
        event_data: typeof e.event_data === 'string' ? JSON.parse(e.event_data) : e.event_data,
        status: e.status
    }));
}
// Helper to broadcast club events to the specific club
function broadcastClubEvents(clubId) {
    console.log(`📢 Broadcasting Events Update for ${clubId}`);
    try {
        const payload = getClubEventsPayload(clubId);
        (0, port_1.broadcastToClub)(clubId, { kind: "Club_Events_List", events: payload });
    }
    catch (e) {
        console.error(`❌ Failed to broadcast events for ${clubId}:`, e);
    }
}
// Stub handlers for now
const handlers = {
    [EventType.Monitor_Subscribe]: (ctx, payload) => {
        const { club_id } = payload;
        if (!club_id)
            return;
        console.log(`🔌 MONITOR SUBSCRIBE: ${club_id} (Socket ID: ${(0, uuid_1.v4)()})`);
        // Register as a "socket for this club" so it receives broadcasts
        // We use a dummy member ID for the monitor page
        const monitorId = `monitor-${(0, uuid_1.v4)()}`;
        // Update Context for cleanup
        ctx.role = "calendar_viewer"; // reused or new role? 'monitor' isn't in type. 'calendar_viewer' is close enough or add 'monitor'
        ctx.clubId = club_id;
        ctx.memberId = monitorId;
        (0, port_1.registerMemberSocket)(monitorId, club_id, ctx.socket);
        // Send immediate state
        const data = (0, state_1.getMonitorData)(club_id);
        ctx.socket.send(JSON.stringify({ kind: "Monitor_State", data }));
    },
    [EventType.Monitor_State]: (ctx, payload) => {
        // Outgoing only
    },
    [EventType.Member_Logout]: (ctx, payload) => {
        const { club_id, member_id } = payload;
        console.log(`[Event] Member_Logout detected for ${member_id} in ${club_id}`);
        try {
            initialise_db_1.dynamicDb.prepare("DELETE FROM online_members WHERE club_id = ? AND member_id = ?").run(club_id, member_id);
            console.log(`✅ Removed member ${member_id} from online_members`);
            broadcastMonitorUpdate(club_id);
        }
        catch (e) {
            console.error("Failed to process logout:", e);
        }
    },
    [EventType.Validate_Club_Admin]: (ctx, payload) => {
        const { club_id, secret } = payload;
        console.log(`[Event] Validating admin for club ${club_id}`);
        const club = initialise_db_1.staticDb.prepare("SELECT admin_secret FROM club_identity WHERE club_id = ?").get(club_id);
        if (club && club.admin_secret === secret) {
            console.log(`✅ Admin Access Validated for ${club_id} (Validated secret)`);
            ctx.socket.send(JSON.stringify({ kind: "Club_Admin_Valid", club_id }));
            // Also subscribe to monitor
            ctx.socket.send(JSON.stringify({ kind: "Monitor_Subscribe", club_id })); // Trigger client to sub? Or just auto-add? 
            // Better to let client handle subscription after login
        }
        else {
            console.log(`❌ Admin Access Denied for ${club_id} (Invalid secret)`);
            ctx.socket.send(JSON.stringify({ kind: "Club_Admin_Invalid", club_id }));
        }
    },
    [EventType.Club_Admin_Valid]: (ctx, payload) => { }, // Outgoing only
    [EventType.Club_Admin_Invalid]: (ctx, payload) => { }, // Outgoing only
    // ... existing handlers ...  // ... existing handlers ...
    [EventType.Event_Accepted]: (ctx, payload) => {
        const { club_id, event_id } = payload;
        console.log(`[Event] Event_Accepted received for ${club_id} (Event: ${event_id})`);
        // 1. Validate
        const event = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? AND event_id = ?").get(club_id, event_id);
        if (!event) {
            console.warn(`⚠️ Event ${event_id} for club ${club_id} not found.`);
            return;
        }
        // 2. Update Status
        try {
            initialise_db_1.dynamicDb.prepare("UPDATE club_events SET status = 'accepted' WHERE event_id = ?").run(event_id);
            console.log(`✅ Event ${event_id} marked as ACCEPTED`);
            // Broadcast update to admins
            broadcastStateUpdate();
            broadcastClubEvents(club_id); // Sync Club
        }
        catch (e) {
            console.error("Failed to update event status:", e);
            return;
        }
        // 3. Forward to Club via Broadcast
        (0, port_1.broadcastToClub)(club_id, {
            kind: "Event_Accepted",
            club_id,
            event_id
        });
        console.log(`➡️ Broadcasted Event_Accepted to club ${club_id}`);
    },
    [EventType.Event_Rejected]: (ctx, payload) => {
        const { club_id, event_id, message } = payload;
        console.log(`[Event] Event_Rejected received for ${club_id} (Event: ${event_id})`);
        // 1. Validate
        if (!club_id || !event_id) {
            console.warn(`⚠️ Missing data for Event_Rejected: `, payload);
            return;
        }
        // 2. Reject Event (Soft Delete)
        // "dont remove it immeditely ... remove only 24 hours after date"
        try {
            const result = initialise_db_1.dynamicDb.prepare("UPDATE club_events SET status = 'rejected' WHERE club_id = ? AND event_id = ?").run(club_id, event_id);
            if (result.changes > 0) {
                console.log(`✅ Event Rejected (Soft Delete): ${event_id}`);
                // 3. Broadcast State
                broadcastStateUpdate();
                broadcastClubEvents(club_id);
            }
            else {
                console.warn(`⚠️ Event ${event_id} not found for rejection.`);
            }
        }
        catch (e) {
            console.error("Failed to reject event:", e);
        }
        // 3. Forward to Club via Broadcast
        (0, port_1.broadcastToClub)(club_id, {
            kind: "Event_Rejected",
            club_id,
            event_id,
            message // Forward the rejection reason
        });
        console.log(`➡️ Broadcasted Event_Rejected to club ${club_id}`);
    },
    [EventType.Event_Notification]: (ctx, payload) => {
        const { club_id, event_id, message } = payload;
        console.log(`[Event] Event_Notification for ${club_id} (Event: ${event_id}): ${message}`);
        // 1. Validate
        const event = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? AND event_id = ?").get(club_id, event_id);
        if (!event) {
            console.warn(`⚠️ Event ${event_id} for club ${club_id} not found.`);
            return;
        }
        // Notification: Status unchanged
        // 3. Forward to Club via Broadcast
        (0, port_1.broadcastToClub)(club_id, {
            kind: "Event_Notification",
            club_id,
            event_id,
            message
        });
        console.log(`➡️ Broadcasted Event_Notification to club ${club_id}`);
    },
    [EventType.Club_Creation_Accepted]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Club_Creation_Accepted for Request: ${request_id}`);
        // 1. Validate Request
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Club Request ${request_id} not found.`);
            return;
        }
        // 2. Create Club Identity
        const newClubId = (0, uuid_1.v4)();
        // Use requested admin_secret or Generate one (using UUID for uniqueness) if missing
        const adminSecret = request.admin_secret || (0, uuid_1.v4)();
        try {
            initialise_db_1.staticDb.prepare("INSERT INTO club_identity (club_id, club_name, club_secret, admin_secret) VALUES (?, ?, ?, ?)").run(newClubId, request.club_name, request.club_secret, adminSecret);
            console.log(`✅ Created new club: ${request.club_name} (${newClubId})`);
        }
        catch (e) {
            console.error("Failed to create club identity (likely duplicate secret):", e);
            return;
        }
        // 3. Register Creator as Club Member
        const creatorMemberId = (0, uuid_1.v4)();
        try {
            initialise_db_1.staticDb.prepare("INSERT INTO club_members (member_id, club_id, name, roll_no, last_login) VALUES (?, ?, ?, ?, ?)")
                .run(creatorMemberId, newClubId, request.creator_name, request.creator_rollNo, Date.now());
            console.log(`✅ Registered creator ${request.creator_name} (${request.creator_rollNo}) as member of ${request.club_name}`);
        }
        catch (e) {
            console.error("Failed to register creator as member:", e);
            // Continue even if member registration fails - club is already created
        }
        // 4. Update Request Status
        initialise_db_1.dynamicDb.prepare("UPDATE club_creation_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
        // Broadcast
        broadcastStateUpdate();
    },
    [EventType.Club_Creation_Rejected]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Club_Creation_Rejected for Request: ${request_id}`);
        // 1. Validate
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Club Request ${request_id} not found.`);
            return;
        }
        // 2. Delete Request
        initialise_db_1.dynamicDb.prepare("DELETE FROM club_creation_requests WHERE request_id = ?").run(request_id);
        console.log(`❌ Club Request ${request_id} DELETED (Rejected)`);
        // Broadcast
        broadcastStateUpdate();
    },
    [EventType.Admin_Access_Accepted]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Admin_Access_Accepted for Request: ${request_id}`);
        // 1. Validate Request
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM admin_access_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Admin Request ${request_id} not found.`);
            return;
        }
        // 2. Create Admin Access
        // FIX: Use the council_id from the request, do not generate a new one which violates FK constraint
        try {
            initialise_db_1.staticDb.prepare("INSERT INTO admin_access (council_id, name, roll_no, last_login) VALUES (?, ?, ?, ?)").run(request.council_id, request.name, request.roll_no, Date.now());
            console.log(`✅ Granted Admin Access: ${request.name} to Council ${request.council_id}`);
        }
        catch (e) {
            console.error("Failed to create admin access:", e);
            return;
        }
        // 3. Update Request Status
        initialise_db_1.dynamicDb.prepare("UPDATE admin_access_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
        // Broadcast
        broadcastStateUpdate();
    },
    [EventType.Admin_Access_Rejected]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Admin_Access_Rejected for Request: ${request_id}`);
        // 1. Validate Request
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM admin_access_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Admin Request ${request_id} not found.`);
            return;
        }
        // 2. Delete Request
        initialise_db_1.dynamicDb.prepare("DELETE FROM admin_access_requests WHERE request_id = ?").run(request_id);
        console.log(`❌ Admin Request ${request_id} DELETED (Rejected)`);
        // Broadcast
        broadcastStateUpdate();
    },
    [EventType.Data_Changed]: (ctx, payload) => {
        console.log(`[Event] Data_Changed received from club ${ctx.clubId}`);
        // 1. Validate Club Identity
        if (!ctx.clubId) {
            console.warn(`⚠️ Missing club_id in Data_Changed`);
            return;
        }
        const club = initialise_db_1.staticDb.prepare("SELECT club_id FROM club_identity WHERE club_id = ?").get(ctx.clubId);
        if (!club) {
            console.warn(`⚠️ Invalid club_id ${ctx.clubId} in Data_Changed`);
            return;
        }
        // 2. Fetch Data
        (0, fetch_data_1.fetchClubData)(ctx.clubId)
            .then((data) => {
            console.log(`📥 Fetched ${data.events.length} events from ${ctx.clubId}`);
            // 3. Write to DB
            const insertStmt = initialise_db_1.dynamicDb.prepare(`
                INSERT INTO club_events (event_id, club_id, event_data, status)
                VALUES (?, ?, ?, 'pending')
            `);
            const checkStmt = initialise_db_1.dynamicDb.prepare(`
                SELECT event_id FROM club_events 
                WHERE club_id = ? AND json_extract(event_data, '$.event_name') = ? AND json_extract(event_data, '$.event_timestamp') = ?
            `);
            // Transaction for atomicity
            const processEvents = initialise_db_1.dynamicDb.transaction((events) => {
                for (const evt of events) {
                    // Check Duplicate (Same Name + Timestamp)
                    const existing = checkStmt.get(ctx.clubId, evt.event_name, evt.event_timestamp);
                    if (existing) {
                        // console.log(`ℹ️ Skipping duplicate event: ${evt.event_name}`);
                        continue;
                    }
                    const newEventId = (0, uuid_1.v4)();
                    // Store the fetched event structure as JSON
                    // Note: We are overwriting the 'event_id' inside the data blob with the new server-generated one?
                    // Or keeping original? User said "generate a event_id". 
                    // I will inject the server ID into the blob to be consistent.
                    evt.event_id = newEventId;
                    insertStmt.run(newEventId, ctx.clubId, JSON.stringify(evt));
                    console.log(`✅ Analyzed & Stored new event: ${evt.event_name} (${newEventId})`);
                }
            });
            processEvents(data.events);
        })
            .catch((err) => {
            console.error(`❌ Failed to fetch data for ${ctx.clubId}:`, err);
        });
    },
    [EventType.Club_joining_Accepted]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Club_joining_Accepted for Request: ${request_id}`);
        // 1. Validate Request
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_join_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Join Request ${request_id} not found.`);
            return;
        }
        // 2. Create Member
        const newMemberId = (0, uuid_1.v4)();
        try {
            initialise_db_1.staticDb.prepare("INSERT INTO club_members (member_id, club_id, name, roll_no, last_login) VALUES (?, ?, ?, ?, ?)").run(newMemberId, request.club_id, request.name, request.roll_no, Date.now());
            console.log(`✅ Member Added: ${request.name} (${newMemberId}) to Club ${request.club_id}`);
        }
        catch (e) {
            console.error("Failed to add member:", e);
            return;
        }
        // 3. Update Request Status
        initialise_db_1.dynamicDb.prepare("UPDATE club_join_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
        // 4. Update Monitors
        broadcastMonitorUpdate(request.club_id);
    },
    [EventType.Club_joining_Rejected]: (ctx, payload) => {
        const { request_id } = payload;
        console.log(`[Event] Club_joining_Rejected for Request: ${request_id}`);
        // 1. Validate
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_join_requests WHERE request_id = ?").get(request_id);
        if (!request) {
            console.warn(`⚠️ Join Request ${request_id} not found.`);
            return;
        }
        // 2. Update Status
        initialise_db_1.dynamicDb.prepare("UPDATE club_join_requests SET status = 'rejected' WHERE request_id = ?").run(request_id);
        // 3. Update Monitors
        broadcastMonitorUpdate(request.club_id);
    },
    [EventType.Event_Created]: (ctx, payload) => {
        const { club_id, event_id, event_data, timestamp } = payload;
        console.log(`[Event] Event_Created received for ${club_id} (Event: ${event_id})`);
        // 1. Validate
        if (!club_id || !event_id || !event_data) {
            console.warn(`⚠️ Missing data for Event_Created: `, payload);
            return;
        }
        // 2. Insert or Replace Event
        try {
            const insertStmt = initialise_db_1.dynamicDb.prepare(`
            INSERT OR REPLACE INTO club_events (event_id, club_id, event_data, status)
            VALUES (?, ?, ?, 'pending')
        `);
            // Ensure event_data includes the ID if not already
            let eventDataObj = typeof event_data === 'string' ? JSON.parse(event_data) : event_data;
            eventDataObj.event_id = event_id;
            insertStmt.run(event_id, club_id, JSON.stringify(eventDataObj));
            console.log(`✅ Event Created/Updated: ${event_id}`);
            // 3. Broadcast State
            broadcastStateUpdate();
            broadcastClubEvents(club_id);
        }
        catch (e) {
            console.error("Failed to create event:", e);
        }
    },
    [EventType.Event_Deleted]: (ctx, payload) => {
        const { club_id, event_id } = payload;
        console.log(`[Event] Event_Deleted received for ${club_id} (Event: ${event_id})`);
        // 1. Validate
        if (!club_id || !event_id) {
            console.warn(`⚠️ Missing data for Event_Deleted: `, payload);
            return;
        }
        // 2. Delete Event
        try {
            const result = initialise_db_1.dynamicDb.prepare("DELETE FROM club_events WHERE club_id = ? AND event_id = ?").run(club_id, event_id);
            if (result.changes > 0) {
                console.log(`✅ Event Deleted: ${event_id}`);
                // 3. Broadcast State
                broadcastStateUpdate();
                broadcastClubEvents(club_id);
            }
            else {
                console.warn(`⚠️ Event ${event_id} not found for deletion.`);
            }
        }
        catch (e) {
            console.error("Failed to delete event:", e);
        }
    },
    // --- New Event Implementations ---
    [EventType.Admin_Access_Request]: (ctx, payload) => {
        const { council_id, name, roll_no, timestamp } = payload;
        console.log(`[Event] Admin_Access_Request received for ${council_id} from ${roll_no}`);
        // 1. Validate Council
        const council = initialise_db_1.staticDb.prepare("SELECT council_id FROM council WHERE council_id = ?").get(council_id);
        if (!council) {
            console.warn(`⚠️ Council ${council_id} not found.`);
            return;
        }
        // 2. Add Request to DB
        const reqId = (0, uuid_1.v4)();
        try {
            initialise_db_1.dynamicDb.prepare("INSERT INTO admin_access_requests (request_id, council_id, name, roll_no, status) VALUES (?, ?, ?, ?, 'pending')")
                .run(reqId, council_id, name, roll_no);
            console.log(`✅ Admin Access Request Created: ${reqId}`);
        }
        catch (e) {
            console.error("Failed to insert admin access request:", e);
            return;
        }
        // 3. Forward to Council Admin & Broadcast State
        broadcastStateUpdate();
        const adminSocket = (0, port_1.getAdminSocket)(council_id);
        if (adminSocket && adminSocket.readyState === ws_1.default.OPEN) {
            // Optional: Send specific notification if needed (Frontend currently ignores this but good for future)
            adminSocket.send(JSON.stringify({
                kind: "Admin_Access_Request",
                request_id: reqId,
                name,
                roll_no,
                timestamp
            }));
        }
    },
    [EventType.Admin_Access_Required]: (ctx, payload) => {
        const { council_id, roll_no, secret, timestamp } = payload;
        console.log(`[Event] Admin_Access_Required for ${council_id} (User: ${roll_no})`);
        // 1. Validate Council & Secret
        const council = initialise_db_1.staticDb.prepare("SELECT * FROM council WHERE council_id = ?").get(council_id);
        if (!council || council.council_secret !== secret) {
            console.warn(`❌ Admin Access DENIED for ${roll_no} (Invalid secret or council)`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "access_denied", roll_no }));
            }
            return;
        }
        // 2. Validate Admin Access Membership
        const adminMember = initialise_db_1.staticDb.prepare("SELECT roll_no FROM admin_access WHERE council_id = ? AND roll_no = ?").get(council_id, roll_no);
        if (adminMember) {
            // Success
            console.log(`✅ Admin Access GRANTED for ${roll_no}`);
            // 3. Update Last Login
            initialise_db_1.staticDb.prepare("UPDATE admin_access SET last_login = ? WHERE council_id = ? AND roll_no = ?")
                .run(Date.now(), council_id, roll_no);
            // 4. Upgrade Context
            ctx.role = "admin";
            ctx.councilId = council_id;
            (0, port_1.addAdminSocket)(ctx.socket, council_id);
            // 5. Send Response & Broadcast State (Initial Load)
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "access_granted", council_id, roll_no }));
            }
            broadcastStateUpdate();
        }
        else {
            // Failure: Not in List
            console.warn(`❌ Admin Access DENIED for ${roll_no} (User not found in admin_access)`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "access_denied", roll_no }));
            }
        }
    },
    // [Stubs for others remain...]
    [EventType.Access_Club_Network]: (ctx, payload) => {
        const { name, roll_no, secret, timestamp, confirm_join } = payload;
        console.log(`[Event] Access_Club_Network received from ${roll_no}`);
        // 1. Authenticate Club
        const club = initialise_db_1.staticDb.prepare("SELECT club_id, club_name FROM club_identity WHERE club_secret = ?").get(secret);
        if (!club) {
            console.warn(`❌ Invalid Club Secret provided by ${roll_no}`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "error", error: "Invalid Club Secret" }));
            }
            return;
        }
        const clubId = club.club_id;
        // 2. Check Membership
        const member = initialise_db_1.staticDb.prepare("SELECT member_id, name, roll_no FROM club_members WHERE club_id = ? AND roll_no = ?").get(clubId, roll_no);
        if (member) {
            // --- MEMBER EXISTS: LOGIN ---
            console.log(`✅ Access Granted for Member: ${member.name}`);
            // Update Last Login
            try {
                initialise_db_1.staticDb.prepare("UPDATE club_members SET last_login = ? WHERE member_id = ?").run(Date.now(), member.member_id);
            }
            catch (e) {
                console.error("Failed to update last_login", e);
            }
            // Update Context
            ctx.role = "club";
            ctx.clubId = clubId;
            ctx.memberId = member.member_id;
            // Register Socket
            (0, port_1.registerMemberSocket)(member.member_id, clubId, ctx.socket);
            // Track Online Member
            try {
                initialise_db_1.dynamicDb.prepare(`
               INSERT OR REPLACE INTO online_members (club_id, member_id, name, roll_no, joined_at)
               VALUES (?, ?, ?, ?, ?)
             `).run(clubId, member.member_id, member.name, member.roll_no, Date.now());
                console.log(`✅ Tracked ${member.name} as ONLINE`);
            }
            catch (e) {
                console.error("Failed to track online member:", e);
            }
            // Send Response
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({
                    kind: "Access_Granted",
                    club_id: clubId,
                    member_id: member.member_id,
                    name: member.name,
                    roll_no: member.roll_no,
                    role: "club",
                    club_secret: secret,
                    // P2P Config?
                }));
            }
            broadcastMonitorUpdate(clubId);
            // Trigger Data Sync
            // performSync(clubId); // Old Sync
            broadcastClubEvents(clubId); // New Sync
        }
        else {
            // --- MEMBER NOT FOUND ---
            if (confirm_join) {
                // Create Join Request
                console.log(`📝 Creating Join Request for ${name} (${roll_no}) in ${club.club_name}`);
                const reqId = (0, uuid_1.v4)();
                try {
                    initialise_db_1.dynamicDb.prepare("INSERT INTO club_join_requests (request_id, club_id, name, roll_no, status, timestamp) VALUES (?, ?, ?, ?, 'pending', ?)")
                        .run(reqId, clubId, name, roll_no, timestamp || Date.now());
                    if (ctx.socket.readyState === ws_1.default.OPEN) {
                        ctx.socket.send(JSON.stringify({ kind: "join_request_sent", request_id: reqId }));
                    }
                    // Broadcast to Monitor
                    broadcastMonitorUpdate(clubId);
                }
                catch (e) {
                    console.error("Failed to create join request:", e);
                    if (ctx.socket.readyState === ws_1.default.OPEN) {
                        ctx.socket.send(JSON.stringify({ kind: "error", error: "Failed to create request" }));
                    }
                }
            }
            else {
                // Notify Client Record Doesn't Exist
                console.warn(`⚠️ Member record not found for ${roll_no}`);
                if (ctx.socket.readyState === ws_1.default.OPEN) {
                    ctx.socket.send(JSON.stringify({
                        kind: "record_doesnt_exist",
                        message: "Roll number not enrolled in this club.",
                        roll_no
                    }));
                }
            }
        }
    },
    [EventType.Create_Club_Network]: (ctx, payload) => {
        const { council_id, club_name, creator_name, creator_roll, club_secret, admin_secret, timestamp } = payload;
        console.log(`[Event] Create_Club_Network received for ${club_name}`);
        // 1. Validate Council
        const council = initialise_db_1.staticDb.prepare("SELECT council_id FROM council WHERE council_id = ?").get(council_id);
        if (!council) {
            console.warn(`❌ Invalid Council ID ${council_id}`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "error", error: "Invalid Council ID" }));
            }
            return;
        }
        // 2. Check Duplicate Secret
        const existingIdentity = initialise_db_1.staticDb.prepare("SELECT club_id FROM club_identity WHERE club_secret = ?").get(club_secret);
        const existingRequest = initialise_db_1.dynamicDb.prepare("SELECT request_id FROM club_creation_requests WHERE club_secret = ? AND status = 'pending'").get(club_secret);
        if (existingIdentity || existingRequest) {
            console.warn(`❌ Club Secret already in use: ${club_secret}`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "error", error: "Club secret already in use" }));
            }
            return;
        }
        // 3. Create Request
        const reqId = (0, uuid_1.v4)();
        try {
            // Note: Ignoring council_id storage as per current schema, using it only for authorized routing/validation.
            initialise_db_1.dynamicDb.prepare("INSERT INTO club_creation_requests (request_id, club_name, club_secret, admin_secret, creator_name, creator_rollNo, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
                .run(reqId, club_name, club_secret, admin_secret, creator_name, creator_roll);
            console.log(`✅ Club Creation Request Sent: ${reqId}`);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "creation_request_sent", request_id: reqId }));
            }
            // Broadcast state update to all admins
            broadcastStateUpdate();
            // Forward to Council Admin
            const adminSocket = (0, port_1.getAdminSocket)(council_id);
            if (adminSocket && adminSocket.readyState === ws_1.default.OPEN) {
                adminSocket.send(JSON.stringify({
                    kind: "Club_Creation_Request",
                    request_id: reqId,
                    club_name,
                    creator_name,
                    creator_roll,
                    timestamp
                }));
            }
        }
        catch (e) {
            console.error("Failed to create club request:", e);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "error", error: "Server Error" }));
            }
        }
    },
    [EventType.Check_creation_request]: (ctx, payload) => {
        const { club_secret } = payload;
        console.log(`[Event] Check_creation_request received`);
        const request = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE club_secret = ?").get(club_secret);
        if (ctx.socket.readyState === ws_1.default.OPEN) {
            if (request) {
                ctx.socket.send(JSON.stringify({
                    kind: "creation_request_status",
                    found: true,
                    request_id: request.request_id,
                    status: request.status,
                    club_name: request.club_name
                }));
            }
            else {
                ctx.socket.send(JSON.stringify({ kind: "creation_request_status", found: false }));
            }
        }
    },
    [EventType.Check_join_request]: (ctx, payload) => {
        const { roll_no } = payload;
        console.log(`[Event] Check_join_request received for ${roll_no}`);
        const requests = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_join_requests WHERE roll_no = ?").all(roll_no);
        const enrichedRequests = requests.map(req => {
            const club = initialise_db_1.staticDb.prepare("SELECT club_name FROM club_identity WHERE club_id = ?").get(req.club_id);
            return {
                ...req,
                club_name: club ? club.club_name : "Unknown Club"
            };
        });
        if (ctx.socket.readyState === ws_1.default.OPEN) {
            ctx.socket.send(JSON.stringify({
                kind: "join_request_status",
                requests: enrichedRequests
            }));
        }
    },
    [EventType.Get_Club_Details]: (ctx, payload) => {
        const { club_id } = payload;
        const club = initialise_db_1.staticDb.prepare("SELECT club_name FROM club_identity WHERE club_id = ?").get(club_id);
        if (club) {
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                // Register as a guest listener for this club to receive broadcasts
                const guestId = `guest_${(0, uuid_1.v4)()}`;
                (0, port_1.registerMemberSocket)(guestId, club_id, ctx.socket);
                // Update context
                ctx.clubId = club_id;
                ctx.memberId = guestId;
                ctx.socket.send(JSON.stringify({ kind: "Club_Details", club_id, club_name: club.club_name }));
                // Also send the events list DIRECTLY to this socket
                // (Broadcast might miss it if it's not yet registered in the club room)
                try {
                    const eventsPayload = getClubEventsPayload(club_id);
                    ctx.socket.send(JSON.stringify({ kind: "Club_Events_List", events: eventsPayload }));
                    console.log(`📤 Sent direct event sync to client for ${club_id} (Registered as ${guestId})`);
                }
                catch (e) {
                    console.error("Failed to send direct event sync:", e);
                }
            }
        }
        else {
            console.warn(`⚠️ Club Details not found for ${club_id}`);
        }
    },
    [EventType.Get_Calendar_Events]: (ctx, payload) => {
        console.log(`[Event] Get_Calendar_Events received`);
        try {
            // 1. Fetch Accepted Events
            // Using 'accepted' as per my check, but user prompt said 'accepted'. (DB check confirmed 'accepted' status existed).
            const events = initialise_db_1.dynamicDb.prepare("SELECT * FROM club_events WHERE status = 'accepted'").all();
            if (events.length === 0) {
                if (ctx.socket.readyState === ws_1.default.OPEN) {
                    ctx.socket.send(JSON.stringify({ kind: "Calendar_Events_List", events: [] }));
                }
                return;
            }
            // 2. Fetch Club Names (Optimization: Batch fetch or cache? For now, simple loop is fine or get all clubs)
            // Since we might have many events, fetch all clubs map is better.
            const clubs = initialise_db_1.staticDb.prepare("SELECT club_id, club_name FROM club_identity").all();
            const clubMap = new Map();
            clubs.forEach(c => clubMap.set(c.club_id, c.club_name));
            // 3. Transform Data
            const responseEvents = events.map(e => {
                let eventDetails;
                try {
                    eventDetails = JSON.parse(e.event_data);
                }
                catch (parseErr) {
                    console.warn(`Failed to parse event data for ${e.event_id}`);
                    eventDetails = {};
                }
                return {
                    club_name: clubMap.get(e.club_id) || "Unknown Club",
                    event_name: e.event_name, // Virtual column or from JSON
                    event_date: eventDetails.event_date,
                    event_starttime: eventDetails.event_start_time,
                    event_endtime: eventDetails.event_end_time,
                    event_description: eventDetails.event_description,
                    event_venue: eventDetails.event_venue
                };
            });
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "Calendar_Events_List", events: responseEvents }));
            }
        }
        catch (err) {
            console.error("Error fetching calendar events:", err);
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "error", error: "Failed to fetch events" }));
            }
        }
    },
    [EventType.Get_Councils]: (ctx, payload) => {
        console.log(`[Event] Get_Councils received`);
        try {
            const councils = initialise_db_1.staticDb.prepare("SELECT council_id, council_name FROM council").all();
            if (ctx.socket.readyState === ws_1.default.OPEN) {
                ctx.socket.send(JSON.stringify({ kind: "Councils_List", councils }));
            }
        }
        catch (err) {
            console.error("Error fetching councils:", err);
        }
    },
    [EventType.p2p_handshake]: (ctx, payload) => {
        console.log(`[Event] p2p_handshake received from ${ctx.memberId}`);
        // TODO: Add existing p2p logic here
    },
    [EventType.p2p_signal]: (ctx, payload) => {
        console.log(`[Event] p2p_signal received from ${ctx.memberId}`);
        // ... (existing)
        const { target, signal } = payload;
        const targetSocket = (0, port_1.getMemberSocket)(target);
        if (targetSocket && targetSocket.readyState === ws_1.default.OPEN) {
            targetSocket.send(JSON.stringify({
                kind: "p2p_signal",
                from: ctx.memberId,
                signal
            }));
        }
    },
};
function handleEvent(context, message) {
    // Check if it's a valid event
    const eventName = message.event || message.kind; // Support both for now or strict?
    if (!Object.values(EventType).includes(eventName)) {
        console.warn(`⚠️ Unknown or Unauthorized Event: ${eventName}`);
        return;
    }
    const handler = handlers[eventName];
    if (handler) {
        handler(context, message);
    }
}
