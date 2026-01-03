"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialiseState = initialiseState;
exports.cacheClubState = cacheClubState;
exports.getAllClubEvents = getAllClubEvents;
exports.getAllAuthRequests = getAllAuthRequests;
exports.getAllRegistrations = getAllRegistrations;
exports.getMonitorData = getMonitorData;
let staticDb;
let dynamicDb;
function initialiseState(sDb, dDb) {
    staticDb = sDb;
    dynamicDb = dDb;
}
function cacheClubState(clubId, data) {
    // Clear existing events for this club (full sync model)
    const deleteStmt = dynamicDb.prepare("DELETE FROM club_events WHERE club_id = ?");
    deleteStmt.run(clubId);
    if (data.events && Array.isArray(data.events)) {
        const insertStmt = dynamicDb.prepare(`
          INSERT INTO club_events (event_id, club_id, event_data, status)
          VALUES (?, ?, ?, ?)
      `);
        const transaction = dynamicDb.transaction((events) => {
            for (const evt of events) {
                insertStmt.run(evt.event_id, clubId, JSON.stringify(evt), "active" // Default status
                );
            }
        });
        transaction(data.events);
    }
    console.log(`💾 Events synced for club: ${clubId}`);
}
function getAllClubEvents() {
    if (!staticDb || !dynamicDb)
        return [];
    // 1. Get all clubs
    const clubs = staticDb.prepare("SELECT club_id, club_name FROM club_identity").all();
    console.log(`DEBUG: getAllClubEvents found ${clubs.length} clubs`);
    const results = [];
    for (const club of clubs) {
        const events = dynamicDb.prepare("SELECT event_data, status FROM club_events WHERE club_id = ?").all(club.club_id);
        console.log(`DEBUG: Club ${club.club_name} has ${events.length} events`);
        if (events.length === 0) {
            // Optional: include club with null event if we want to show it has no events
            continue;
        }
        for (const evtRow of events) {
            try {
                const evt = JSON.parse(evtRow.event_data);
                results.push({
                    club_id: club.club_id,
                    club_name: club.club_name,
                    event_id: evt.event_id,
                    event_name: evt.event_name,
                    event_description: evt.event_description,
                    event_venue: evt.event_venue,
                    event_date: evt.event_date,
                    event_start_time: evt.event_start_time,
                    event_end_time: evt.event_end_time,
                    event_timestamp: evt.event_timestamp,
                    status: evtRow.status
                });
            }
            catch (e) { }
        }
    }
    return results;
}
function getAllAuthRequests() {
    if (!dynamicDb)
        return [];
    const requests = [];
    // 1. Club Creation Requests
    const clubReqs = dynamicDb.prepare(`
        SELECT request_id, club_name, creator_name, creator_rollNo, status, timestamp 
        FROM club_creation_requests 
        WHERE status = 'pending'
    `).all();
    for (const req of clubReqs) {
        requests.push({
            id: req.request_id,
            type: 'club',
            name: req.creator_name,
            rollNo: req.creator_rollNo,
            clubName: req.club_name,
            timestamp: req.timestamp || Date.now(), // Fallback if null (shouldn't be)
            status: req.status
        });
    }
    // 2. Admin Access Requests
    const adminReqs = dynamicDb.prepare(`
        SELECT request_id, name, roll_no, status, timestamp
        FROM admin_access_requests 
        WHERE status = 'pending'
    `).all();
    for (const req of adminReqs) {
        requests.push({
            id: req.request_id,
            type: 'admin',
            name: req.name,
            rollNo: req.roll_no,
            timestamp: req.timestamp || Date.now(),
            status: req.status
        });
    }
    return requests.sort((a, b) => b.timestamp - a.timestamp);
}
function getAllRegistrations() {
    if (!staticDb)
        return { clubs: [], admins: [] };
    // 1. Clubs: fetch name and member count
    // We need to join club_identity and club_members
    // actually, just counting members per club_id
    const clubsData = staticDb.prepare(`
        SELECT ci.club_id, ci.club_name, COUNT(cm.member_id) as member_count
        FROM club_identity ci
        LEFT JOIN club_members cm ON ci.club_id = cm.club_id
        GROUP BY ci.club_id
    `).all();
    const clubs = clubsData.map(c => ({
        id: c.club_id,
        name: c.club_name,
        members: c.member_count
    }));
    // 2. Admins
    // Assuming council_id is shared or we just fetch all admins in admin_access
    const adminsData = staticDb.prepare(`
        SELECT name, roll_no, last_login 
        FROM admin_access
    `).all();
    const admins = adminsData.map((a, index) => ({
        id: `admin-${index}`, // We don't have a specific ID in the schema (composite primary key), generating one or using roll_no
        name: a.name,
        rollNo: a.roll_no,
        lastLogin: a.last_login
    }));
    return { clubs, admins };
}
function getMonitorData(clubId) {
    if (!staticDb || !dynamicDb)
        return { authorizedUsers: [], joinRequests: [] };
    // 1. Authorized Users (Club Members)
    const members = staticDb.prepare("SELECT member_id, name, roll_no, last_login FROM club_members WHERE club_id = ?").all(clubId);
    console.log(`DEBUG: Fetched ${members.length} members for monitor. Sample lastLogin:`, members[0]?.lastLogin);
    // Check online status
    const onlineMembers = new Set(dynamicDb.prepare("SELECT member_id FROM online_members WHERE club_id = ?").all(clubId).map(m => m.member_id));
    const authorizedUsers = members.map(m => ({
        id: m.member_id,
        name: m.name,
        roll: m.roll_no,
        lastLogin: m.last_login || 0,
        online: onlineMembers.has(m.member_id)
    }));
    // 2. Pending Join Requests
    const requests = dynamicDb.prepare("SELECT request_id, name, roll_no, timestamp FROM club_join_requests WHERE club_id = ? AND status = 'pending'").all(clubId);
    const joinRequests = requests.map(r => ({
        id: r.request_id,
        name: r.name,
        roll: r.roll_no,
        timestamp: r.timestamp || Date.now()
    }));
    return { authorizedUsers, joinRequests };
}
