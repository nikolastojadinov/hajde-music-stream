import { getBackendHeaders, getCurrentPiUser } from "@/contexts/PiContext";
import { withBackendOrigin } from "@/lib/backendUrl";

export type TrackActivityClientInput = {
  entityType: string;
  entityId: string;
  context?: Record<string, unknown> | null;
  clientLogMessage?: string;
  userIdOverride?: string | null;
};

const logClientEvent = (message: string) => {
  try {
    void fetch(withBackendOrigin("/client-log"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      keepalive: true,
    });
  } catch {
    // ignore
  }
};

export const trackActivityClient = ({ entityType, entityId, context, clientLogMessage, userIdOverride }: TrackActivityClientInput): void => {
  const uid = (userIdOverride || getCurrentPiUser()?.uid || "").trim();
  const entityTypeValue = (entityType || "").trim();
  const entityIdValue = (entityId || "").trim();

  if (!uid || !entityTypeValue || !entityIdValue) {
    return;
  }

  const payload = {
    userId: uid,
    entityType: entityTypeValue,
    entityId: entityIdValue,
    context: context ?? undefined,
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...getBackendHeaders(),
  };

  void fetch(withBackendOrigin("/api/activity/track"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((err) => {
    if (import.meta.env.DEV) {
      console.debug("[Activity] client track failed", err?.message || err);
    }
  });

  if (clientLogMessage) {
    logClientEvent(clientLogMessage);
  }
};

export const logActivityClientEvent = (message: string): void => {
  logClientEvent(message);
};
