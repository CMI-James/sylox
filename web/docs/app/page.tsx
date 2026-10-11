import { redirect } from "next/navigation";

// This workspace is docs-only - there's no separate marketing home
// page here (that's web/landing). Visiting the bare domain root goes
// straight to the docs tree.
export default function RootPage() {
  redirect("/docs");
}
