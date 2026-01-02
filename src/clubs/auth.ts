// src/clubs/auth.ts
import { Database } from "better-sqlite3";

export type AuthResult =
  | {
      success: true;
      clubId: string;
      memberId: string;
      name: string;
      role: "club";
    }
  | {
      success: false;
      error?: string;
    };

let staticDb: Database;
let dynamicDb: Database;

export function initialiseAuth(sDb: Database, dDb: Database) {
  staticDb = sDb;
  dynamicDb = dDb;
}

export function authenticateClub(
  clubSecret: string,
  rollNo: string
): AuthResult {
  // 1. Validate Club Secret
  const club = staticDb
    .prepare("SELECT club_id FROM club_identity WHERE club_secret = ?")
    .get(clubSecret) as { club_id: string } | undefined;

  if (!club) return { success: false, error: "Invalid Club Secret" };

  const clubId = club.club_id;

  // 2. Validate Member via Roll No
  const member = staticDb.prepare(
      "SELECT member_id, name FROM club_members WHERE club_id = ? AND roll_no = ?"
  ).get(clubId, rollNo) as { member_id: string, name: string } | undefined;

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
  } catch (e) {
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

export function setDeviceOffline(clubId: string, memberId: string) {
    dynamicDb.prepare(
        "DELETE FROM online_members WHERE club_id = ? AND member_id = ?"
    ).run(clubId, memberId);
}

// Previously used for "Active Device" election. 
// New schema does not explicitly track 'active' vs 'standby'.
// We keep function structure if needed but it's largely irrelevant now.
export function promoteNextActiveDevice(clubId: string): string | null {
  return null; 
}
