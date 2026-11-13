import { api } from "../../lib/api";
import { createLocalAlertApi } from "./localAlertApi.mjs";

export const localAlertClient = createLocalAlertApi({ apiCall: api });

export async function fetchLocalAlertEvent({ accountId, alertId, signal }) {
  const { target } = await localAlertClient.target({ accountId, alertId, signal });
  if (!target?.eventId || target.event?.id !== target.eventId) throw new Error("This show update is no longer available.");
  return target.event;
}
