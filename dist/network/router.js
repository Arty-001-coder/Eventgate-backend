"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeMessage = routeMessage;
// src/network/router.ts
const state_1 = require("../clubs/state");
const port_1 = require("./port");
const auth_1 = require("../clubs/auth");
const events_1 = require("./events");
function routeMessage({ socket, context, message }) {
    // 1. Handle Disconnects
    if (message.kind === "disconnect") {
        handleDisconnect(socket, context);
        return;
    }
    // 2. Event Routing
    // Delegate EVERYTHING to the Event System
    // Authentication is now handled within specific event handlers (e.g., Admin_Access_Required)
    (0, events_1.handleEvent)(context, message);
}
function handleDisconnect(socket, context) {
    if (context.role === "admin") {
        // Pass councilId to correctly remove from map if it exists
        (0, port_1.removeAdminSocket)(socket, context.councilId || undefined);
        console.log(`👮 Admin disconnected${context.councilId ? ` (${context.councilId})` : ''}`);
        return;
    }
    if (context.role === "club" && context.clubId && context.memberId) {
        const { clubId, memberId } = context;
        console.log(`❌ Member disconnected: ${memberId} (Club: ${clubId})`);
        (0, auth_1.setDeviceOffline)(clubId, memberId);
        (0, port_1.removeMemberSocket)(memberId, clubId, socket);
        // Refresh admin view
        (0, port_1.broadcastToAdmins)({ kind: "full_state", events: (0, state_1.getAllClubEvents)() });
        // Refresh club monitor
        (0, events_1.broadcastMonitorUpdate)(clubId);
    }
}
