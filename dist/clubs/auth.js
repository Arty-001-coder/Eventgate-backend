"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialiseAuth = initialiseAuth;
exports.authenticateClub = authenticateClub;
exports.setDeviceOffline = setDeviceOffline;
exports.promoteNextActiveDevice = promoteNextActiveDevice;
let staticDb;
let dynamicDb;
function initialiseAuth(sDb, dDb) {
    staticDb = sDb;
    dynamicDb = dDb;
}
function authenticateClub(clubSecret, rollNo) {
    // 1. Validate Club Secret
    const club = staticDb
        .prepare("SELECT club_id FROM club_identity WHERE club_secret = ?")
        .get(clubSecret);
    if (!club)
        return { success: false, error: "Invalid Club Secret" };
    const clubId = club.club_id;
    // 2. Validate Member via Roll No
    const member = staticDb.prepare("SELECT member_id, name FROM club_members WHERE club_id = ? AND roll_no = ?").get(clubId, rollNo);
    if (!member) {
        // Not a member? Maybe auto-create specific logic or just fail. 
        // For strict compliance to new schema, we fail if not in members table.
        return { success: false, error: "Member not found in club roster" };
    }
    // 3. Mark as Online
    try {
        dynamicDb.prepare(`
        INSERT OR IGNORE INTO online_members (club_id, member_id)
        VALUES (?, ?)
      `).run(clubId, member.member_id);
    }
    catch (e) {
        console.error("Failed to mark member online:", e);
    }
    // Update last login (Static DB)
    staticDb.prepare("UPDATE club_members SET last_login = ? WHERE member_id = ?")
        .run(Date.now(), member.member_id);
    return {
        success: true,
        clubId,
        memberId: member.member_id,
        name: member.name,
        role: "club"
    };
}
function setDeviceOffline(clubId, memberId) {
    dynamicDb.prepare("DELETE FROM online_members WHERE club_id = ? AND member_id = ?").run(clubId, memberId);
}
// Previously used for "Active Device" election. 
// New schema does not explicitly track 'active' vs 'standby'.
// We keep function structure if needed but it's largely irrelevant now.
function promoteNextActiveDevice(clubId) {
    return null;
}
