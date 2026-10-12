import { Header } from "@/components/layout/Header";
import { SimpleHero } from "@/components/hero/SimpleHero";
import { ProblemStatement } from "@/components/sections/ProblemStatement";
import { ScoreScale } from "@/components/sections/ScoreScale";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { WhoItsFor } from "@/components/sections/WhoItsFor";
import { Status } from "@/components/sections/Status";
import { Faq } from "@/components/sections/Faq";
import { FinalCtaAndFooter } from "@/components/sections/FinalCtaAndFooter";

export default function Home() {
  return (
    <>
      <Header />
      {/* <main> landmark around every section between the header and footer.
          None of the individual section components has an aria-label (axe's
          region rule only treats an unlabeled <section> as a landmark if
          it's inside one), so without this wrapper almost the entire page
          body reads as "not contained by landmarks" — see e2e/accessibility.spec.ts. */}
      <main>
        <div id="top">
          <SimpleHero />
        </div>
        <ProblemStatement />
        <ScoreScale />
        <HowItWorks />
        <Status />
        <WhoItsFor />
        <Faq />
      </main>
      <FinalCtaAndFooter />
    </>
  );
}
