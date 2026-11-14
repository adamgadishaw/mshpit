import { openTicketLink } from "../lib/ticketLinks";

// The shared hook's browser branch delegates straight to this existing opener.
export default function useIOSTicketAction() {
  return { open: openTicketLink, error: "" };
}
