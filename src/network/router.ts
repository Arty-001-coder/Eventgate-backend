// src/network/router.ts
import { getAllClubEvents } from "../clubs/state";
import { 
  ConnectionContext, 
  removeMemberSocket,
  removeAdminSocket,
  broadcastToAdmins
} from "./port";
import { setDeviceOffline } from "../clubs/auth";
import { handleEvent, broadcastMonitorUpdate } from "./events";

type RouterInput = {
  socket: any;
  context: ConnectionContext;
  message: any;
};

export function routeMessage({ socket, context, message }: RouterInput) {
  // 1. Handle Disconnects
  if (message.kind === "disconnect") {
    handleDisconnect(socket, context);
    return;
  }

  // 2. Event Routing
  // Delegate EVERYTHING to the Event System
  // Authentication is now handled within specific event handlers (e.g., Admin_Access_Required)
  handleEvent(context, message);
}

function handleDisconnect(socket: any, context: ConnectionContext) {
  if (context.role === "admin") {
    // Pass councilId to correctly remove from map if it exists
    removeAdminSocket(socket, context.councilId || undefined);
    console.log(`👮 Admin disconnected${context.councilId ? ` (${context.councilId})` : ''}`);
    return;
  }

  if (context.role === "club" && context.clubId && context.memberId) {
    const { clubId, memberId } = context;
    console.log(`❌ Member disconnected: ${memberId} (Club: ${clubId})`);
    
    setDeviceOffline(clubId, memberId);
    removeMemberSocket(memberId, clubId, socket);
    
    // Refresh admin view
    broadcastToAdmins({ kind: "full_state", events: getAllClubEvents() });
    
    // Refresh club monitor
    broadcastMonitorUpdate(clubId);
  }
}
