import { lazy, Suspense } from "react";
const Content = lazy(() => import("./ResearchedAboutContent"));
export default function ResearchedAbout(props) {
  return <Suspense fallback={null}><Content {...props} /></Suspense>;
}
