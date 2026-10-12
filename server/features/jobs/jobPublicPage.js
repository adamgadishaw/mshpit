import { jobApplicationHref } from "../../../src/domain/jobs.mjs";
import { isJobId } from "./jobRoutes.js";
export function jobPublicPage(repository, pathname, { cursor = "" } = {}) {
  const normalized = pathname.replace(/\/+$/, "");
  const base = { title: "Work at mshpit", description: "Current job openings at mshpit.", intro: "Explore current openings on the mshpit team.", path: normalized, indexable: true };
  if (normalized === "/jobs") {
    if (cursor && !isJobId(cursor)) return { ...base, indexable: false, sections: [{ heading: "Invalid page", paragraphs: ["Return to the jobs list."], links: [{ label: "Work at mshpit", href: "/jobs" }] }], status: 400 };
    const page = repository.publicList(cursor);
    return { ...base, indexable: !cursor, sections: [
      ...(page.jobs.length ? page.jobs.map(job => ({ heading: job.title, paragraphs: [`${job.location} · ${job.arrangement}`], links: [{ label: "View opening", href: `/jobs/${job.id}` }] })) : [{ heading: "No open positions", paragraphs: ["There are no published openings at the moment. Check back for future opportunities."] }]),
      ...(page.cursor ? [{ heading: "More openings", links: [{ label: "Next page", href: `/jobs?cursor=${encodeURIComponent(page.cursor)}` }] }] : []),
    ] };
  }
  const match = normalized.match(/^\/jobs\/([^/]+)$/);
  if (!match) return null;
  const job = isJobId(match[1]) ? repository.publicRead(match[1]) : null;
  if (!job) return { ...base, status: 404, indexable: false, sections: [{ heading: "Opening unavailable", paragraphs: ["This opening is no longer available."], links: [{ label: "View current openings", href: "/jobs" }] }] };
  return { ...base, title: `${job.title} | Work at mshpit`, intro: `${job.location} · ${job.arrangement}`, description: `${job.title} at mshpit. ${job.location}.`, primaryAction: { label: "Apply", href: jobApplicationHref(job.application) }, sections: [{ heading: "About the role", paragraphs: job.description.split(/\n\s*\n/u) }, { heading: "Applications", paragraphs: ["Apply using the destination provided for this opening. Applications are handled outside this website."], links: [{ label: "All openings", href: "/jobs" }, { label: "Contact us", href: "/contact" }] }] };
}
