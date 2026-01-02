import { ConnectionContext, getAnyClubSocket, addAdminSocket, getAdminSocket, registerMemberSocket, getMemberSocket, broadcastToAdmins, broadcastToClub } from "./port";
import { dynamicDb, staticDb } from "../data/initialise_db";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { fetchClubData } from "../clubs/fetch-data";
import { getAllClubEvents, cacheClubState, getMonitorData } from "../clubs/state";

// Helper for sync workflow
function performSync(clubId: string) {
  console.log(`🔄 Syncing data for club ${clubId}...`);
  fetchClubData(clubId)
    .then((data) => {
      cacheClubState(clubId, data);
      
      // Broadcast update to admins
      const allEvents = getAllClubEvents();
      broadcastToAdmins({ kind: "full_state", events: allEvents });
      console.log(`✅ Sync complete for ${clubId}`);
    })
    .catch((err) => {
      console.error(`❌ Failed to sync club ${clubId}:`, err);
    });
}

// ... [Skipping to Handlers] ...


export enum EventType {
  Event_Accepted = "Event_Accepted",
  Event_Rejected = "Event_Rejected",
  Event_Notification = "Event_Notification",
  Club_Creation_Accepted = "Club_Creation_Accepted",
  Club_Creation_Rejected = "Club_Creation_Rejected",
  Admin_Access_Accepted = "Admin_Access_Accepted",
  Admin_Access_Rejected = "Admin_Access_Rejected",
  Data_Changed = "Data_Changed",
  Club_joining_Accepted = "Club_joining_Accepted",
  Club_joining_Rejected = "Club_joining_Rejected",
  Get_Club_Details = "Get_Club_Details", // NEW
  Get_Calendar_Events = "Get_Calendar_Events",
  Get_Councils = "Get_Councils",
  
  // New Events
  Admin_Access_Request = "Admin_Access_Request",
  Admin_Access_Required = "Admin_Access_Required",
  Access_Club_Network = "Access_Club_Network",
  Create_Club_Network = "Create_Club_Network",
  Check_creation_request = "Check_creation_request",
  Check_join_request = "Check_join_request",
  
  // P2P Events2210
  p2p_handshake = "p2p_handshake",
  p2p_signal = "p2p_signal",

  // Monitor Events
  Monitor_Subscribe = "Monitor_Subscribe",
  Monitor_State = "Monitor_State"
}

export interface NetworkEvent {
  event: EventType;
  payload: any;
}

// Helper to broadcast state update
function broadcastStateUpdate() {
    const events = getAllClubEvents();
    const authRequests = require("../clubs/state").getAllAuthRequests();
    const registrations = require("../clubs/state").getAllRegistrations();
    broadcastToAdmins({
        kind: "full_state",
        events,
        authRequests,
        registrations
    });
}

export function broadcastMonitorUpdate(clubId: string) {
    console.log(`📢 Broadcasting Monitor Update for ${clubId}`);
    const data = getMonitorData(clubId);
    broadcastToClub(clubId, { kind: "Monitor_State", data });
}

// Stub handlers for now
const handlers: Record<EventType, (context: ConnectionContext, payload: any) => void> = {
   [EventType.Monitor_Subscribe]: (ctx, payload) => {
      const { club_id } = payload;
      if (!club_id) return;
      
      console.log(`🔌 MONITOR SUBSCRIBE: ${club_id} (Socket ID: ${uuidv4()})`);

      // Register as a "socket for this club" so it receives broadcasts
      // We use a dummy member ID for the monitor page
      const monitorId = `monitor-${uuidv4()}`;
      
      // Update Context for cleanup
      ctx.role = "calendar_viewer"; // reused or new role? 'monitor' isn't in type. 'calendar_viewer' is close enough or add 'monitor'
      ctx.clubId = club_id;
      ctx.memberId = monitorId;

      registerMemberSocket(monitorId, club_id, ctx.socket);
      
      // Send immediate state
      const data = getMonitorData(club_id);
      ctx.socket.send(JSON.stringify({ kind: "Monitor_State", data }));
   },
   [EventType.Monitor_State]: (ctx, payload) => {
       // Outgoing only
   },
// ... existing handlers ...  // ... existing handlers ...
  [EventType.Event_Accepted]: (ctx, payload) => {
    const { club_id, event_id } = payload;
    console.log(`[Event] Event_Accepted received for ${club_id} (Event: ${event_id})`);

    // 1. Validate
    const event = dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? AND event_id = ?").get(club_id, event_id);
    if (!event) {
        console.warn(`⚠️ Event ${event_id} for club ${club_id} not found.`);
        return;
    }

    // 2. Update Status
    try {
        dynamicDb.prepare("UPDATE club_events SET status = 'accepted' WHERE event_id = ?").run(event_id);
        console.log(`✅ Event ${event_id} marked as ACCEPTED`);
        
        // Broadcast update to admins
        broadcastStateUpdate();
    } catch (e) {
        console.error("Failed to update event status:", e);
        return;
    }

    // 3. Forward to Club
    const socket = getAnyClubSocket(club_id);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            kind: "Event_Accepted",
            club_id,
            event_id
        }));
        console.log(`➡️ Forwarded Event_Accepted to club ${club_id}`);
    } else {
        console.warn(`Club ${club_id} not connected, cannot forward Event_Accepted`);
    }
  },
  [EventType.Event_Rejected]: (ctx, payload) => {
    const { club_id, event_id, message } = payload;
    console.log(`[Event] Event_Rejected for ${club_id} (Event: ${event_id}): ${message}`);

    // 1. Validate
    const event = dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? AND event_id = ?").get(club_id, event_id);
    if (!event) {
        console.warn(`⚠️ Event ${event_id} for club ${club_id} not found.`);
        return;
    }

    // 2. Delete Entry (As per requirement)
    try {
        dynamicDb.prepare("DELETE FROM club_events WHERE event_id = ?").run(event_id);
        console.log(`❌ Event ${event_id} DELETED (Rejected)`);
        
        // Broadcast update to admins
        broadcastStateUpdate();
    } catch (e) {
        console.error("Failed to delete event:", e);
        return;
    }

    // 3. Forward to Club
    const socket = getAnyClubSocket(club_id);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            kind: "Event_Rejected",
            club_id,
            event_id,
            message
        }));
        console.log(`➡️ Forwarded Event_Rejected to club ${club_id}`);
    } else {
        console.warn(`Club ${club_id} not connected, cannot forward Event_Rejected`);
    }
  },
  [EventType.Event_Notification]: (ctx, payload) => {
    const { club_id, event_id, message } = payload;
    console.log(`[Event] Event_Notification for ${club_id} (Event: ${event_id}): ${message}`);

    // 1. Validate
    const event = dynamicDb.prepare("SELECT * FROM club_events WHERE club_id = ? AND event_id = ?").get(club_id, event_id);
    if (!event) {
        console.warn(`⚠️ Event ${event_id} for club ${club_id} not found.`);
        return;
    }
    
    // Notification: Status unchanged

    // 3. Forward to Club
    const socket = getAnyClubSocket(club_id);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            kind: "Event_Notification",
            club_id,
            event_id,
            message
        }));
        console.log(`➡️ Forwarded Event_Notification to club ${club_id}`);
    } else {
        console.warn(`Club ${club_id} not connected, cannot forward Event_Notification`);
    }
  },
  [EventType.Club_Creation_Accepted]: (ctx, payload) => {
    const { request_id } = payload;
    console.log(`[Event] Club_Creation_Accepted for Request: ${request_id}`);

    // 1. Validate Request
    const request: any = dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Club Request ${request_id} not found.`);
        return;
    }

    // 2. Create Club Identity
    const newClubId = uuidv4();
    // Generate admin_secret (using UUID for uniqueness)
    const adminSecret = uuidv4();
    try {
        staticDb.prepare("INSERT INTO club_identity (club_id, club_name, club_secret, admin_secret) VALUES (?, ?, ?, ?)").run(newClubId, request.club_name, request.club_secret, adminSecret);
        console.log(`✅ Created new club: ${request.club_name} (${newClubId})`);
    } catch (e) {
        console.error("Failed to create club identity (likely duplicate secret):", e);
        return;
    }

    // 3. Register Creator as Club Member
    const creatorMemberId = uuidv4();
    try {
        staticDb.prepare("INSERT INTO club_members (member_id, club_id, name, roll_no, last_login) VALUES (?, ?, ?, ?, ?)")
                 .run(creatorMemberId, newClubId, request.creator_name, request.creator_rollNo, Date.now());
        console.log(`✅ Registered creator ${request.creator_name} (${request.creator_rollNo}) as member of ${request.club_name}`);
    } catch (e) {
        console.error("Failed to register creator as member:", e);
        // Continue even if member registration fails - club is already created
    }

    // 4. Update Request Status
    dynamicDb.prepare("UPDATE club_creation_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
    
    // Broadcast
    broadcastStateUpdate();
  },
  [EventType.Club_Creation_Rejected]: (ctx, payload) => {
    const { request_id } = payload;
    console.log(`[Event] Club_Creation_Rejected for Request: ${request_id}`);

    // 1. Validate
    const request: any = dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Club Request ${request_id} not found.`);
        return;
    }
    
    // 2. Delete Request
    dynamicDb.prepare("DELETE FROM club_creation_requests WHERE request_id = ?").run(request_id);
    console.log(`❌ Club Request ${request_id} DELETED (Rejected)`);
    
    // Broadcast
    broadcastStateUpdate();
  },
  [EventType.Admin_Access_Accepted]: (ctx, payload) => {
    const { request_id } = payload;
    console.log(`[Event] Admin_Access_Accepted for Request: ${request_id}`);

     // 1. Validate Request
    const request: any = dynamicDb.prepare("SELECT * FROM admin_access_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Admin Request ${request_id} not found.`);
        return;
    }

    // 2. Create Admin Access
    // FIX: Use the council_id from the request, do not generate a new one which violates FK constraint
    try {
        staticDb.prepare("INSERT INTO admin_access (council_id, name, roll_no, last_login) VALUES (?, ?, ?, ?)").run(request.council_id, request.name, request.roll_no, Date.now());
        console.log(`✅ Granted Admin Access: ${request.name} to Council ${request.council_id}`);
    } catch (e) {
        console.error("Failed to create admin access:", e);
        return;
    }

    // 3. Update Request Status
    dynamicDb.prepare("UPDATE admin_access_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
    
    // Broadcast
    broadcastStateUpdate();
  },
  [EventType.Admin_Access_Rejected]: (ctx, payload) => {
    const { request_id } = payload;
    console.log(`[Event] Admin_Access_Rejected for Request: ${request_id}`);

     // 1. Validate Request
    const request: any = dynamicDb.prepare("SELECT * FROM admin_access_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Admin Request ${request_id} not found.`);
        return;
    }

    // 2. Delete Request
    dynamicDb.prepare("DELETE FROM admin_access_requests WHERE request_id = ?").run(request_id);
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
    const club = staticDb.prepare("SELECT club_id FROM club_identity WHERE club_id = ?").get(ctx.clubId);
    if (!club) {
        console.warn(`⚠️ Invalid club_id ${ctx.clubId} in Data_Changed`);
        return;
    }

    // 2. Fetch Data
    fetchClubData(ctx.clubId)
        .then((data) => {
            console.log(`📥 Fetched ${data.events.length} events from ${ctx.clubId}`);
            
            // 3. Write to DB
            const insertStmt = dynamicDb.prepare(`
                INSERT INTO club_events (event_id, club_id, event_data, status)
                VALUES (?, ?, ?, 'pending')
            `);
            const checkStmt = dynamicDb.prepare(`
                SELECT event_id FROM club_events 
                WHERE club_id = ? AND json_extract(event_data, '$.event_name') = ? AND json_extract(event_data, '$.event_timestamp') = ?
            `);
            
            // Transaction for atomicity
            const processEvents = dynamicDb.transaction((events: any[]) => {
                for (const evt of events) {
                     // Check Duplicate (Same Name + Timestamp)
                     const existing = checkStmt.get(ctx.clubId, evt.event_name, evt.event_timestamp);
                     if (existing) {
                         // console.log(`ℹ️ Skipping duplicate event: ${evt.event_name}`);
                         continue; 
                     }

                     const newEventId = uuidv4();
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
    const request: any = dynamicDb.prepare("SELECT * FROM club_join_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Join Request ${request_id} not found.`);
        return;
    }

    // 2. Create Member
    const newMemberId = uuidv4();
    try {
        staticDb.prepare("INSERT INTO club_members (member_id, club_id, name, roll_no, last_login) VALUES (?, ?, ?, ?, ?)").run(newMemberId, request.club_id, request.name, request.roll_no, Date.now());
        console.log(`✅ Member Added: ${request.name} (${newMemberId}) to Club ${request.club_id}`);
    } catch (e) {
        console.error("Failed to add member:", e);
        return;
    }

    // 3. Update Request Status
    dynamicDb.prepare("UPDATE club_join_requests SET status = 'accepted' WHERE request_id = ?").run(request_id);
    
    // 4. Update Monitors
    broadcastMonitorUpdate(request.club_id);
  },
  [EventType.Club_joining_Rejected]: (ctx, payload) => {
    const { request_id } = payload;
    console.log(`[Event] Club_joining_Rejected for Request: ${request_id}`);

    // 1. Validate
    const request: any = dynamicDb.prepare("SELECT * FROM club_join_requests WHERE request_id = ?").get(request_id);
    if (!request) {
        console.warn(`⚠️ Join Request ${request_id} not found.`);
        return;
    }

    // 2. Update Status
    dynamicDb.prepare("UPDATE club_join_requests SET status = 'rejected' WHERE request_id = ?").run(request_id);
    
    // 3. Update Monitors
    broadcastMonitorUpdate(request.club_id);
  },
  
  // --- New Event Implementations ---
  [EventType.Admin_Access_Request]: (ctx, payload) => {
      const { council_id, name, roll_no, timestamp } = payload;
      console.log(`[Event] Admin_Access_Request received for ${council_id} from ${roll_no}`);
      
      // 1. Validate Council
      const council = staticDb.prepare("SELECT council_id FROM council WHERE council_id = ?").get(council_id);
      if (!council) {
          console.warn(`⚠️ Council ${council_id} not found.`);
          return;
      }

      // 2. Add Request to DB
      const reqId = uuidv4();
      try {
          dynamicDb.prepare("INSERT INTO admin_access_requests (request_id, council_id, name, roll_no, status) VALUES (?, ?, ?, ?, 'pending')")
                   .run(reqId, council_id, name, roll_no);
          console.log(`✅ Admin Access Request Created: ${reqId}`);
      } catch (e) {
          console.error("Failed to insert admin access request:", e);
          return;
      }

      // 3. Forward to Council Admin & Broadcast State
      broadcastStateUpdate();
      
      const adminSocket = getAdminSocket(council_id);
      if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
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
      const council: any = staticDb.prepare("SELECT * FROM council WHERE council_id = ?").get(council_id);
      
      if (!council || council.council_secret !== secret) {
           console.warn(`❌ Admin Access DENIED for ${roll_no} (Invalid secret or council)`);
           if (ctx.socket.readyState === WebSocket.OPEN) {
               ctx.socket.send(JSON.stringify({ kind: "access_denied", roll_no }));
           }
           return;
      }

      // 2. Validate Admin Access Membership
      const adminMember = staticDb.prepare("SELECT roll_no FROM admin_access WHERE council_id = ? AND roll_no = ?").get(council_id, roll_no);
      
      if (adminMember) {
           // Success
           console.log(`✅ Admin Access GRANTED for ${roll_no}`);
           
           // 3. Update Last Login
           staticDb.prepare("UPDATE admin_access SET last_login = ? WHERE council_id = ? AND roll_no = ?")
                   .run(Date.now(), council_id, roll_no);

           // 4. Upgrade Context
           ctx.role = "admin";
           ctx.councilId = council_id;
           addAdminSocket(ctx.socket, council_id);

           // 5. Send Response & Broadcast State (Initial Load)
           if (ctx.socket.readyState === WebSocket.OPEN) {
               ctx.socket.send(JSON.stringify({ kind: "access_granted", council_id, roll_no }));
           }
           broadcastStateUpdate();
      } else {
           // Failure: Not in List
           console.warn(`❌ Admin Access DENIED for ${roll_no} (User not found in admin_access)`);
           if (ctx.socket.readyState === WebSocket.OPEN) {
               ctx.socket.send(JSON.stringify({ kind: "access_denied", roll_no }));
           }
      }
  },
  
  // [Stubs for others remain...]
  [EventType.Access_Club_Network]: (ctx, payload) => {
      const { name, roll_no, secret, timestamp, confirm_join } = payload;
      console.log(`[Event] Access_Club_Network received from ${roll_no}`);
      
      // 1. Authenticate Club
      const club = staticDb.prepare("SELECT club_id, club_name FROM club_identity WHERE club_secret = ?").get(secret) as any;
      
      if (!club) {
          console.warn(`❌ Invalid Club Secret provided by ${roll_no}`);
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "error", error: "Invalid Club Secret" }));
          }
          return;
      }
      
      const clubId = club.club_id;
      
      // 2. Check Membership
      const member = staticDb.prepare("SELECT member_id, name, roll_no FROM club_members WHERE club_id = ? AND roll_no = ?").get(clubId, roll_no) as any;
      
      if (member) {
          // --- MEMBER EXISTS: LOGIN ---
          console.log(`✅ Access Granted for Member: ${member.name}`);
          
          // Update Context
          ctx.role = "club";
          ctx.clubId = clubId;
          ctx.memberId = member.member_id;
          
          // Register Socket
          registerMemberSocket(member.member_id, clubId, ctx.socket);
          
          // Send Response
          if (ctx.socket.readyState === WebSocket.OPEN) {
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
          performSync(clubId);
          
      } else {
          // --- MEMBER NOT FOUND ---
          if (confirm_join) {
              // Create Join Request
              console.log(`📝 Creating Join Request for ${name} (${roll_no}) in ${club.club_name}`);
              
              const reqId = uuidv4();
              try {
                  dynamicDb.prepare("INSERT INTO club_join_requests (request_id, club_id, name, roll_no, status, timestamp) VALUES (?, ?, ?, ?, 'pending', ?)")
                           .run(reqId, clubId, name, roll_no, timestamp || Date.now());
                           
                  if (ctx.socket.readyState === WebSocket.OPEN) {
                      ctx.socket.send(JSON.stringify({ kind: "join_request_sent", request_id: reqId }));
                  }
                  
                  // Broadcast to Monitor
                  broadcastMonitorUpdate(clubId);
                  
              } catch (e) {
                  console.error("Failed to create join request:", e);
                  if (ctx.socket.readyState === WebSocket.OPEN) {
                      ctx.socket.send(JSON.stringify({ kind: "error", error: "Failed to create request" }));
                  }
              }
              
          } else {
              // Notify Client Record Doesn't Exist
              console.warn(`⚠️ Member record not found for ${roll_no}`);
              if (ctx.socket.readyState === WebSocket.OPEN) {
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
      const { council_id, club_name, creator_name, creator_roll, club_secret, timestamp } = payload;
      console.log(`[Event] Create_Club_Network received for ${club_name}`);
      
      // 1. Validate Council
      const council = staticDb.prepare("SELECT council_id FROM council WHERE council_id = ?").get(council_id);
      if (!council) {
          console.warn(`❌ Invalid Council ID ${council_id}`);
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "error", error: "Invalid Council ID" }));
          }
          return;
      }
      
      // 2. Check Duplicate Secret
      const existingIdentity = staticDb.prepare("SELECT club_id FROM club_identity WHERE club_secret = ?").get(club_secret);
      const existingRequest = dynamicDb.prepare("SELECT request_id FROM club_creation_requests WHERE club_secret = ? AND status = 'pending'").get(club_secret);
      
      if (existingIdentity || existingRequest) {
          console.warn(`❌ Club Secret already in use: ${club_secret}`);
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "error", error: "Club secret already in use" }));
          }
          return;
      }
      
      // 3. Create Request
      const reqId = uuidv4();
      try {
          // Note: Ignoring council_id storage as per current schema, using it only for authorized routing/validation.
          dynamicDb.prepare("INSERT INTO club_creation_requests (request_id, club_name, club_secret, creator_name, creator_rollNo, status) VALUES (?, ?, ?, ?, ?, 'pending')")
                   .run(reqId, club_name, club_secret, creator_name, creator_roll);
                   
          console.log(`✅ Club Creation Request Sent: ${reqId}`);
          
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "creation_request_sent", request_id: reqId }));
          }
          
          // Broadcast state update to all admins
          broadcastStateUpdate();

          // Forward to Council Admin
          const adminSocket = getAdminSocket(council_id);
          if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
               adminSocket.send(JSON.stringify({
                   kind: "Club_Creation_Request",
                   request_id: reqId,
                   club_name,
                   creator_name,
                   creator_roll,
                   timestamp
               }));
          }

      } catch (e) {
          console.error("Failed to create club request:", e);
           if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "error", error: "Server Error" }));
          }
      }
  },
  [EventType.Check_creation_request]: (ctx, payload) => {
      const { club_secret } = payload;
      console.log(`[Event] Check_creation_request received`);

      const request: any = dynamicDb.prepare("SELECT * FROM club_creation_requests WHERE club_secret = ?").get(club_secret);
      
      if (ctx.socket.readyState === WebSocket.OPEN) {
          if (request) {
              ctx.socket.send(JSON.stringify({ 
                  kind: "creation_request_status", 
                  found: true,
                  request_id: request.request_id,
                  status: request.status,
                  club_name: request.club_name
              }));
          } else {
              ctx.socket.send(JSON.stringify({ kind: "creation_request_status", found: false }));
          }
      }
  },
  [EventType.Check_join_request]: (ctx, payload) => {
      const { roll_no } = payload;
      console.log(`[Event] Check_join_request received for ${roll_no}`);

      const requests: any[] = dynamicDb.prepare("SELECT * FROM club_join_requests WHERE roll_no = ?").all(roll_no);
      
      const enrichedRequests = requests.map(req => {
          const club = staticDb.prepare("SELECT club_name FROM club_identity WHERE club_id = ?").get(req.club_id) as any;
          return {
              ...req,
              club_name: club ? club.club_name : "Unknown Club"
          };
      });

      if (ctx.socket.readyState === WebSocket.OPEN) {
          ctx.socket.send(JSON.stringify({ 
              kind: "join_request_status", 
              requests: enrichedRequests 
          }));
      }
  },
  
  [EventType.Get_Club_Details]: (ctx, payload) => {
      const { club_id } = payload;
      const club: any = staticDb.prepare("SELECT club_name FROM club_identity WHERE club_id = ?").get(club_id);
      
      if (club) {
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "Club_Details", club_id, club_name: club.club_name }));
          }
      } else {
          console.warn(`⚠️ Club Details not found for ${club_id}`);
      }
  },

  [EventType.Get_Calendar_Events]: (ctx, payload) => {
      console.log(`[Event] Get_Calendar_Events received`);
      
      try {
          // 1. Fetch Accepted Events
          // Using 'accepted' as per my check, but user prompt said 'accepted'. (DB check confirmed 'accepted' status existed).
          const events: any[] = dynamicDb.prepare("SELECT * FROM club_events WHERE status = 'accepted'").all();
          
          if (events.length === 0) {
              if (ctx.socket.readyState === WebSocket.OPEN) {
                  ctx.socket.send(JSON.stringify({ kind: "Calendar_Events_List", events: [] }));
              }
              return;
          }

          // 2. Fetch Club Names (Optimization: Batch fetch or cache? For now, simple loop is fine or get all clubs)
          // Since we might have many events, fetch all clubs map is better.
          const clubs = staticDb.prepare("SELECT club_id, club_name FROM club_identity").all() as { club_id: string, club_name: string }[];
          const clubMap = new Map<string, string>();
          clubs.forEach(c => clubMap.set(c.club_id, c.club_name));

          // 3. Transform Data
          const responseEvents = events.map(e => {
              let eventDetails;
              try {
                  eventDetails = JSON.parse(e.event_data);
              } catch (parseErr) {
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

          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "Calendar_Events_List", events: responseEvents }));
          }

      } catch (err) {
          console.error("Error fetching calendar events:", err);
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "error", error: "Failed to fetch events" }));
          }
      }
  },

  [EventType.Get_Councils]: (ctx, payload) => {
      console.log(`[Event] Get_Councils received`);
      try {
          const councils = staticDb.prepare("SELECT council_id, council_name FROM council").all();
          if (ctx.socket.readyState === WebSocket.OPEN) {
              ctx.socket.send(JSON.stringify({ kind: "Councils_List", councils }));
          }
      } catch (err) {
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
      const targetSocket = getMemberSocket(target);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify({
              kind: "p2p_signal",
              from: ctx.memberId,
              signal
          }));
      }
  },
};

export function handleEvent(context: ConnectionContext, message: any) {
  // Check if it's a valid event
  const eventName = message.event || message.kind; // Support both for now or strict?
  
  if (!Object.values(EventType).includes(eventName)) {
    console.warn(`⚠️ Unknown or Unauthorized Event: ${eventName}`);
    return;
  }

  const handler = handlers[eventName as EventType];
  if (handler) {
    handler(context, message);
  }
}
