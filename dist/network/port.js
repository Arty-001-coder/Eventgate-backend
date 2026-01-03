"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMemberSocket = registerMemberSocket;
exports.removeMemberSocket = removeMemberSocket;
exports.getMemberSocket = getMemberSocket;
exports.getAnyClubSocket = getAnyClubSocket;
exports.addAdminSocket = addAdminSocket;
exports.removeAdminSocket = removeAdminSocket;
exports.getAdminSocket = getAdminSocket;
exports.broadcastToAdmins = broadcastToAdmins;
exports.broadcastToClub = broadcastToClub;
exports.startServer = startServer;
// src/network/port.ts
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const router_1 = require("./router");
const state_1 = require("../clubs/state");
// ... (existing code)
// --- Socket Management ---
const memberSockets = new Map(); // memberId -> WS
const clubSockets = new Map(); // clubId -> Set<WS>
const adminSockets = new Map(); // councilId -> Set<WS>
// Keep a set of anonymous admins? No, force councilId. 
// If legacy admin (admin_secret_123) is used, we might need a dummy ID "global-admin".
const globalAdmins = new Set();
function registerMemberSocket(memberId, clubId, socket) {
    memberSockets.set(memberId, socket);
    if (!clubSockets.has(clubId)) {
        clubSockets.set(clubId, new Set());
    }
    clubSockets.get(clubId)?.add(socket);
}
function removeMemberSocket(memberId, clubId, socket) {
    memberSockets.delete(memberId);
    const clubSet = clubSockets.get(clubId);
    if (clubSet) {
        clubSet.delete(socket);
        if (clubSet.size === 0) {
            clubSockets.delete(clubId);
        }
    }
}
function getMemberSocket(memberId) {
    return memberSockets.get(memberId);
}
// Returns ANY connected socket for a club (useful for pushing admin commands)
function getAnyClubSocket(clubId) {
    const set = clubSockets.get(clubId);
    if (set && set.size > 0) {
        return set.values().next().value;
    }
    return undefined;
}
function addAdminSocket(socket, councilId) {
    if (councilId) {
        if (!adminSockets.has(councilId)) {
            adminSockets.set(councilId, new Set());
        }
        adminSockets.get(councilId)?.add(socket);
    }
    else {
        globalAdmins.add(socket);
    }
}
function removeAdminSocket(socket, councilId) {
    if (councilId) {
        const set = adminSockets.get(councilId);
        if (set) {
            set.delete(socket);
            if (set.size === 0)
                adminSockets.delete(councilId);
        }
    }
    else {
        globalAdmins.delete(socket);
    }
}
function getAdminSocket(councilId) {
    const set = adminSockets.get(councilId);
    if (set && set.size > 0)
        return set.values().next().value;
    return undefined;
}
function broadcastToAdmins(message) {
    const payload = JSON.stringify(message);
    // Send to Council Admins
    for (const set of adminSockets.values()) {
        for (const socket of set) {
            if (socket.readyState === ws_1.WebSocket.OPEN)
                socket.send(payload);
        }
    }
    // Send to Global Admins
    for (const socket of globalAdmins) {
        if (socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(payload);
        }
    }
}
function broadcastToClub(clubId, message) {
    const set = clubSockets.get(clubId);
    if (set) {
        const payload = JSON.stringify(message);
        let count = 0;
        for (const socket of set) {
            if (socket.readyState === ws_1.WebSocket.OPEN) {
                socket.send(payload);
                count++;
            }
        }
        console.log(`   -> Sent to ${count} clients in club ${clubId}`);
    }
    else {
        console.log(`   -> No clients connected for club ${clubId}`);
    }
}
// --------------------------------
const PORT = process.env.PORT || 8080;
function startServer() {
    const server = http_1.default.createServer((req, res) => {
        // Health check endpoint
        if (req.url === "/health" || req.url === "/health/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
            return;
        }
        // Serve static files from public/
        const publicDir = path_1.default.join(__dirname, "../../public");
        let filePath = path_1.default.join(publicDir, req.url === "/" ? "index.html" : req.url);
        // Basic security check to prevent directory traversal
        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        fs_1.default.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === "ENOENT") {
                    res.writeHead(404);
                    res.end("Not Found");
                }
                else {
                    res.writeHead(500);
                    res.end("Server Error");
                }
            }
            else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(content);
            }
        });
    });
    const wss = new ws_1.WebSocketServer({ server });
    console.log(`🚀 Server listening on port ${PORT} (HTTP + WS)`);
    wss.on("connection", (socket) => {
        // Initial context is empty/unauthenticated
        const context = {
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
            const events = (0, state_1.getAllClubEvents)();
            // Since we are in the port, we might not have direct access to getAllAuthRequests unless exported from state.ts
            // I need to check if I can import it. Assuming I update the import.
            const authRequests = require("../clubs/state").getAllAuthRequests();
            const registrations = require("../clubs/state").getAllRegistrations();
            console.log(`DEBUG: Sending state to new client`);
            socket.send(JSON.stringify({
                kind: "full_state",
                events,
                authRequests,
                registrations
            }));
            console.log("📤 Sent initial state to new connection");
        }
        catch (e) {
            console.error("Failed to send initial state:", e);
        }
        socket.on("message", (raw) => {
            try {
                const message = JSON.parse(raw.toString());
                (0, router_1.routeMessage)({ socket, context, message });
            }
            catch (err) {
                socket.send(JSON.stringify({ error: "Invalid JSON payload" }));
            }
        });
        socket.on("close", () => {
            (0, router_1.routeMessage)({ socket, context, message: { kind: "disconnect" } });
        });
        socket.on("error", (err) => {
            console.error("WebSocket error:", err);
        });
    });
    server.listen(PORT);
}
