// All landing page copy lives here (brief §3 rule 8) so it can be edited
// without touching components. Every non-generic claim carries a `_source`
// pointing at the prd.md / technical-doc.md section it's drawn from, or
// "brief §X" when it's drawn directly from the build brief itself. Claims
// with no `_source` are generic marketing language, not factual claims.

export interface HeroCta {
  label: string;
  href: string;
  variant: "primary" | "secondary";
}

interface HeroPanelCopy {
  eyebrow: string;
  heading: string;
  body: string;
  ctas?: HeroCta[];
  _source: string;
}

export const nav = {
  links: [
    { label: "How it works", href: "#how-it-works" },
    { label: "Who it's for", href: "#who-its-for" },
    { label: "Status", href: "#status" },
    { label: "FAQ", href: "#faq" },
  ],
  github: {
    label: "GitHub",
    href: "https://github.com/Sylox-labs",
  },
  launchApp: {
    label: "Launch app",
    tag: "Testnet",
    href: "https://app.sylox.xyz",
  },
};

export const hero = {
  // Only panels[0] is ever rendered — SimpleHero.tsx is the live hero and
  // only reads hero.panels[0]. The scrolling multi-panel hero (HeroPanel.tsx,
  // panels 2-4 below) was never wired into page.tsx; removed as dead code
  // (see PR #80 follow-up, commit "remove dead code from web/landing").
  // Kept as a one-item array (not a bare object) so SimpleHero.tsx's
  // existing `hero.panels[0]` lookup doesn't need to change.
  panels: [
    // satisfies HeroPanelCopy[] below checks each literal (e.g. variant:
    // "primary") against the real component props at the definition site,
    // so every consumer of hero.panels gets properly narrowed types with
    // no local cast — see the HeroCta type above.
    {
      eyebrow: "+ RISK INFRASTRUCTURE FOR STELLAR",
      heading: "Know your issuer before it fails.",
      body: "Sylox scores anchor issued assets on Stellar in public. If the issuer behind one breaks, cover written against it pays from collateral that's already locked.",
      ctas: [
        { label: "Launch testnet app", href: "https://app.sylox.xyz", variant: "primary" },
        { label: "Read the docs", href: "https://docs.sylox.xyz/docs", variant: "secondary" },
      ] as HeroCta[],
      _source: "landing/copy-and-docs-links brief, Hero section",
    },
  ] satisfies HeroPanelCopy[],
};

export const problem = {
  eyebrow: "+ THE PROBLEM",
  heading:
    "Same name. Same currency. Very different odds of getting your money back.",
  // The component only has two paragraph slots (bodyLeft, bodyRight); the
  // brief's copy is five short beats. Grouped 1-2 into bodyLeft (setup) and
  // 3-5 into bodyRight (consequence + resolution), exact words and sentence
  // order preserved, only the paragraph break point chosen. Flagged in the
  // PR as a judgment call, not a reword.
  bodyLeft:
    "On Stellar, several companies can issue a token for the same currency. Two dollar tokens can sit side by side in your wallet looking identical, and be backed by completely different reserves, banks and track records.",
  bodyRight:
    "Wallets list them as equals. Lenders accept them as equals. Holders find out they weren't the day a withdrawal doesn't come back. Sylox makes the difference visible before that day, and gives you a way to be covered when it comes.",
  _source: "landing/copy-and-docs-links brief, The problem section",
};

export const scoreScale = {
  eyebrow: "+ THE SCORE",
  heading: "One number. Read in a glance. Checked by anyone.",
  // Brief also has an intro line here ("Every covered asset gets a score
  // from 0 to 100, built from live signals like peg, liquidity and
  // withdrawals. Higher means riskier.") and a link after the bands ("How
  // the score is built -> /docs/concepts"). Neither has a slot in
  // ScoreScale.tsx (only eyebrow + heading render before the rows grid, and
  // nothing renders after it) - flagged in the PR, not added.
  sampleLabel: "Illustrative sample, not live data",
  rows: [
    {
      band: "normal",
      range: "0 to 24",
      copy: "The peg holds. Liquidity is deep. Withdrawals clear.",
    },
    {
      band: "watch",
      range: "25 to 49",
      copy: "Something moved. Not a crisis. A reason to look before you add exposure.",
    },
    {
      band: "warning",
      range: "50 to 74",
      copy: "Real stress. This is where a lender would start accepting less of it as collateral.",
    },
    {
      band: "distress",
      range: "75 to 100",
      copy: "Failure signals are stacking up. New cover stops here. You can't buy cover on a house that's already burning.",
    },
    {
      band: "event",
      range: "Declared",
      copy: "A credit event has been declared under rules published in advance. Cover written against it can be claimed.",
    },
  ],
  _source: "landing/copy-and-docs-links brief, The score section",
};

export const howItWorks = {
  eyebrow: "+ HOW IT WORKS",
  heading:
    "Three parts. One job: turn hidden risk into something you can see, price and protect against.",
  // Brief also has a link after the three parts ("See the full lifecycle,
  // from signal to payout -> /docs/concepts"). HowItWorks.tsx has no slot
  // after the cards loop - flagged in the PR, not added.
  cards: [
    {
      title: "Risk Oracle",
      body: "A public score for every covered asset, with the raw signals printed right next to it. The formula is open. Don't trust the number? Recompute it.",
      _source: "landing/copy-and-docs-links brief, How it works 01",
    },
    {
      title: "Credit Event Registry",
      body: "Failure gets defined before anyone loses money, not argued about after. Depegs and issuer freezes are checked against fixed rules. Every decision has a challenge window. Edge cases go to a committee with a deadline to rule.",
      _source: "landing/copy-and-docs-links brief, How it works 02",
    },
    {
      title: "Protection Markets",
      body: "Markets per asset, each with a fixed term. Sellers lock USDC and earn premiums for carrying the risk. Buyers pay upfront for cover. Every payout comes from collateral that's already locked. Not from a promise. Not from a treasury that might be empty.",
      _source: "landing/copy-and-docs-links brief, How it works 03",
    },
  ],
};

export const whoItsFor = {
  eyebrow: "+ WHO IT'S FOR",
  heading: "If you hold issuer risk, you already need this.",
  // Array order follows the brief's own order (HOLDERS, WALLETS, LENDERS,
  // ANCHORS); WhoItsFor.tsx destructures by `word` rather than position, so
  // this doesn't change the bento layout. WALLETS and LENDERS each have a
  // link in the brief ("Show risk bands in your wallet ->
  // /docs/integration-guides", "Gate collateral on live risk ->
  // /docs/integration-guides"); BentoCell has no link slot - flagged in
  // the PR, not added.
  //
  // `who` (BentoCell's small label above the big word): the brief only
  // gives an explicit sub-label for HOLDERS ("· Treasuries, NGOs,
  // fintechs, market makers"). WALLETS/LENDERS/ANCHORS have no sub-label
  // line in the brief's copy at all, just the bold word and body text -
  // but BentoCell's `who` prop is required. Rather than invent new copy
  // for a slot the brief leaves empty, these three keep their original
  // pre-existing `who` values ("Wallets", "Lending protocols", "Anchors")
  // unchanged. Flagged in the PR, not reworded.
  rows: [
    {
      word: "HOLDERS",
      who: "Treasuries, NGOs, fintechs, market makers",
      body: "You're carrying issuer risk whether you've priced it or not. Buy cover on what you hold, or write cover and earn premiums for taking the other side.",
    },
    {
      word: "WALLETS",
      who: "Wallets",
      body: "Your users see two identical tokens. Show them the difference: a risk band next to every issued asset, read straight from the feed.",
    },
    {
      word: "LENDERS",
      who: "Lending protocols",
      body: "Stop treating every issuer the same. Set collateral limits from live risk bands, not a guess you made once and never revisited.",
    },
    {
      word: "ANCHORS",
      who: "Anchors",
      body: "Right now, a safe issuer has no way to prove it. Now you do: public signals, read straight from the chain, that anyone can verify.",
    },
  ],
  _source: "landing/copy-and-docs-links brief, Who it's for section",
};

export const status = {
  eyebrow: "+ STATUS",
  heading: "Where we actually are.",
  body: "No roadmap theatre. What's shipped, what's next, and what waits.",
  // Brief also has a line below the list ("Protection markets will not
  // touch mainnet until the contracts are audited and legal review is
  // done. That order is deliberate."). Status.tsx has no slot after the
  // items list - flagged in the PR, not added. The 8 items themselves are
  // kept exactly as they are, per the brief.
  items: [
    { label: "Protocol specification", tag: "PUBLISHED" },
    { label: "Risk Oracle contract", tag: "BUILT AND TESTED" },
    { label: "Credit Event Registry contract", tag: "BUILT AND TESTED" },
    { label: "Staking and Treasury contracts", tag: "BUILT AND TESTED" },
    { label: "Testnet deployment", tag: "IN PROGRESS" },
    { label: "Protection Markets contracts", tag: "NEXT" },
    { label: "Security audit", tag: "BEFORE MAINNET" },
    { label: "Protection markets on mainnet", tag: "AFTER LEGAL REVIEW" },
  ],
  _source: "brief §7.9; roadmap per prd.md §15.2; updated 2026-10-09 to reflect actual build state",
};

export const faq = {
  eyebrow: "+ FAQ",
  // Brief lists exactly 5 entries; the previous 6 included an "Is this
  // [the I-word]?" entry (removed - banned term per the CI word check
  // below, and not in the brief's list anyway) and "Do I need to hold the
  // asset to buy cover?" (removed - not in the brief's list). Both
  // dropped; the remaining 4 are replaced
  // word-for-word and reordered to match the brief, plus one new entry
  // ("Can I use the risk feed...") that already existed under slightly
  // different wording and is now replaced with the brief's exact copy.
  // The last entry's link ("Start with the integration guides ->
  // /docs/integration-guides") has no slot in Faq.tsx (answers render as
  // plain text) - flagged in the PR, not added.
  items: [
    {
      question: "How is cover different from a policy?",
      answer:
        "Cover is backed by collateral sellers lock onchain, and payouts follow rules published in advance, not a claims adjuster.",
    },
    {
      question: "Who decides if an issuer failed?",
      answer:
        "The rules do, first. Depegs and freezes are checked against fixed, published definitions. Anyone can challenge inside a set window. Edge cases go to a committee with a deadline to rule.",
    },
    {
      question: "Is the score a credit rating?",
      answer:
        "No. It's a live readout of public signals with an open formula. It shows what the market is signalling right now, not an opinion about the company.",
    },
    {
      question: "Is it audited?",
      answer: "Not yet. The audit happens before mainnet. Until then, everything runs on testnet.",
    },
    {
      question: "Can I use the risk feed in my wallet or protocol?",
      answer:
        "Yes. The feed is public. Read it straight from the contract, or use the Sylox SDK. Start with the integration guides.",
    },
  ],
  _source: "landing/copy-and-docs-links brief, FAQ section",
};

export const openSource = {
  eyebrow: "+ OPEN BY DEFAULT",
  // FinalCtaAndFooter.tsx renders `heading` as a small one-line text-sm
  // blurb inside the footer's first grid column, not as a real <h2> - and
  // the brief wants this section to carry its own H2 plus a two-button row
  // (Read the docs /docs, View the contracts /docs/contract-reference),
  // neither of which the component has a slot for (`link` below has never
  // been rendered either, even before this change). Flagged in the PR as
  // a genuine layout gap, not silently built or reworded; `heading` is
  // still updated to the brief's words since that string IS rendered,
  // just at blurb scale rather than H2 scale.
  heading: "Don't trust us. Check us.",
  items: [
    {
      title: "Soroban contracts",
      body: "The rules live onchain on Stellar. Not on our servers.",
    },
    {
      title: "Open formula",
      body: "Every score and every event definition is public. Same inputs, same math, same answer, for anyone.",
    },
    {
      title: "Apache 2.0",
      body: "Read it. Fork it. Build on it.",
    },
  ],
  link: { label: "View the code on GitHub", href: "https://github.com/Sylox-labs" },
  _source: "landing/copy-and-docs-links brief, Open by default section",
};

export const footer = {
  tagline: "Security infrastructure for a fragmented world.",
  // Brief's link row: Docs, SDK reference, Contract reference, Spec,
  // GitHub - replaces the previous GitHub / X / Contact row entirely (X
  // and Contact are dropped, per the brief's explicit list). Internal
  // links (docs, sdkReference, contractReference) open in the same tab;
  // github and spec open in a new tab, matching how GitHub already
  // behaved here before this change. "Spec" reuses the existing spec
  // link (GitHub repo), same as the hero's own "Read the spec" link.
  links: {
    docs: "https://docs.sylox.xyz/docs",
    sdkReference: "https://docs.sylox.xyz/docs/sdk-reference",
    contractReference: "https://docs.sylox.xyz/docs/contract-reference",
    spec: "https://github.com/Sylox-labs",
    github: "https://github.com/Sylox-labs",
  },
  builtOnStellar: "Built on Stellar",
};
