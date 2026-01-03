"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchClubData = fetchClubData;
// club/fetch-data.ts
const uuid_1 = require("uuid");
const ws_1 = __importDefault(require("ws"));
const port_1 = require("../network/port");
/**
 * Fetch authoritative club data from the active device
 */
function fetchClubData(clubId) {
    return new Promise((resolve, reject) => {
        const socket = (0, port_1.getAnyClubSocket)(clubId);
        if (!socket || socket.readyState !== ws_1.default.OPEN) {
            reject(new Error("No active club device connected"));
            return;
        }
        const requestId = (0, uuid_1.v4)();
        const timeout = setTimeout(() => {
            reject(new Error("Club device response timeout"));
        }, 30000);
        function onMessage(raw) {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.kind === "club_data" &&
                    msg.request_id === requestId) {
                    cleanup();
                    // Basic validation
                    if (msg.club_id !== clubId ||
                        !Array.isArray(msg.events)) {
                        reject(new Error("Invalid club data payload"));
                        return;
                    }
                    resolve({
                        club_id: msg.club_id,
                        events: msg.events,
                    });
                }
            }
            catch {
                // ignore unrelated messages
            }
        }
        function cleanup() {
            clearTimeout(timeout);
            if (socket) {
                socket.off("message", onMessage);
            }
        }
        socket.on("message", onMessage);
        socket.send(JSON.stringify({
            kind: "fetch_data",
            request_id: requestId,
            club_id: clubId,
        }));
    });
}
