// club/fetch-data.ts
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { getAnyClubSocket } from "../network/port";

export type Event = {
  event_id: string;
  event_name: string;
  event_timestamp: number;
  event_description: string;
  event_venue: string;
};

export type ClubData = {
  club_id: string;
  events: Event[];
};

/**
 * Fetch authoritative club data from the active device
 */
export function fetchClubData(
  clubId: string
): Promise<ClubData> {
  return new Promise((resolve, reject) => {
    const socket: WebSocket | undefined =
      getAnyClubSocket(clubId);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error("No active club device connected"));
      return;
    }

    const requestId = uuidv4();

    const timeout = setTimeout(() => {
      reject(new Error("Club device response timeout"));
    }, 30000);

    function onMessage(raw: WebSocket.RawData) {
      try {
        const msg = JSON.parse(raw.toString());

        if (
          msg.kind === "club_data" &&
          msg.request_id === requestId
        ) {
          cleanup();

          // Basic validation
          if (
            msg.club_id !== clubId ||
            !Array.isArray(msg.events)
          ) {
            reject(new Error("Invalid club data payload"));
            return;
          }

          resolve({
            club_id: msg.club_id,
            events: msg.events,
          });
        }
      } catch {
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

    socket.send(
      JSON.stringify({
        kind: "fetch_data",
        request_id: requestId,
        club_id: clubId,
      })
    );
  });
}
