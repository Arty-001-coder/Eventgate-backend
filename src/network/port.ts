// src/network/port.ts
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { routeMessage } from "./router";

import { getAllClubEvents } from "../clubs/state";
import {
  getAllAuthRequests,
  getAllRegistrations
} from "../clubs/state";
export type ConnectionContext = {
  role: "admin" | "club" | "calendar_viewer" | null;
  clubId: string | null;
  memberId: string | null;
  councilId: string | null;
  socket: WebSocket;
};

// ... (existing code)



// --- Socket Management ---
const memberSockets = new Map<string, WebSocket>(); // memberId -> WS
const clubSockets = new Map<string, Set<WebSocket>>(); // clubId -> Set<WS>
const adminSockets = new Map<string, Set<WebSocket>>(); // councilId -> Set<WS>
// Keep a set of anonymous admins? No, force councilId. 
// If legacy admin (admin_secret_123) is used, we might need a dummy ID "global-admin".
const globalAdmins = new Set<WebSocket>(); 

export function registerMemberSocket(memberId: string, clubId: string, socket: WebSocket) {
    memberSockets.set(memberId, socket);
    if (!clubSockets.has(clubId)) {
        clubSockets.set(clubId, new Set());
    }
    clubSockets.get(clubId)?.add(socket);
}

export function removeMemberSocket(memberId: string, clubId: string, socket: WebSocket) {
    memberSockets.delete(memberId);
    const clubSet = clubSockets.get(clubId);
    if (clubSet) {
        clubSet.delete(socket);
        if (clubSet.size === 0) {
            clubSockets.delete(clubId);
        }
    }
}

export function getMemberSocket(memberId: string): WebSocket | undefined {
    return memberSockets.get(memberId);
}

// Returns ANY connected socket for a club (useful for pushing admin commands)
export function getAnyClubSocket(clubId: string): WebSocket | undefined {
  const set = clubSockets.get(clubId);
  if (set && set.size > 0) {
      return set.values().next().value;
  }
  return undefined;
}

export function addAdminSocket(socket: WebSocket, councilId?: string) {
  if (councilId) {
      if (!adminSockets.has(councilId)) {
          adminSockets.set(councilId, new Set());
      }
      adminSockets.get(councilId)?.add(socket);
  } else {
      globalAdmins.add(socket);
  }
}

export function removeAdminSocket(socket: WebSocket, councilId?: string) {
  if (councilId) {
      const set = adminSockets.get(councilId);
      if (set) {
          set.delete(socket);
          if (set.size === 0) adminSockets.delete(councilId);
      }
  } else {
      globalAdmins.delete(socket);
  }
}

export function getAdminSocket(councilId: string): WebSocket | undefined {
    const set = adminSockets.get(councilId);
    if (set && set.size > 0) return set.values().next().value;
    return undefined;
}

export function broadcastToAdmins(message: any) {
  const payload = JSON.stringify(message);
  
  // Send to Council Admins
  for (const set of adminSockets.values()) {
      for (const socket of set) {
          if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
  }
  // Send to Global Admins
  for (const socket of globalAdmins) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function broadcastToClub(clubId: string, message: any) {
    const set = clubSockets.get(clubId);
    if (set) {
        const payload = JSON.stringify(message);
        let count = 0;
        for (const socket of set) {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(payload);
                count++;
            }
        }
        console.log(`   -> Sent to ${count} clients in club ${clubId}`);
    } else {
        console.log(`   -> No clients connected for club ${clubId}`);
    }
}
// --------------------------------

const PORT = process.env.PORT || 8080;

export function startServer() {
  const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === "/health" || req.url === "/health/") {
      // Add CORS headers
      res.writeHead(200, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
      return;
    }

    // Handle CORS preflight for health endpoint
    if (req.method === "OPTIONS" && (req.url === "/health" || req.url === "/health/")) {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    // All other HTTP requests return 404 (this server only handles WebSocket and health checks)
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server });

  console.log(`🚀 Server listening on port ${PORT} (HTTP + WS)`);

  wss.on("connection", (socket: WebSocket) => {
    // Initial context is empty/unauthenticated
    const context: ConnectionContext = {
      role: "admin", // Default to admin for this demo
      clubId: null,
      memberId: null,
      councilId: null,
      socket: socket,
    };
    
    // Register as Global Admin to receive broadcasts
    addAdminSocket(socket);

    // Send initial state immediately (Temporary for development/demo)
    try {
        const events = getAllClubEvents();
        // Since we are in the port, we might not have direct access to getAllAuthRequests unless exported from state.ts
        // I need to check if I can import it. Assuming I update the import.
        const authRequests = getAllAuthRequests();
        const registrations = getAllRegistrations();

        console.log(`DEBUG: Sending state to new client`);
        socket.send(JSON.stringify({
            kind: "full_state",
            events,
            authRequests,
            registrations
        }));
        console.log("📤 Sent initial state to new connection");
    } catch (e) {
        console.error("Failed to send initial state:", e);
    }

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        routeMessage({ socket, context, message });
      } catch (err) {
        socket.send(JSON.stringify({ error: "Invalid JSON payload" }));
      }
    });

    socket.on("close", () => {
      routeMessage({ socket, context, message: { kind: "disconnect" } });
    });

    socket.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  server.listen(PORT);
}
