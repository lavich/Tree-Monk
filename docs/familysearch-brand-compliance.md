# FamilySearch brand compliance — TreeMonk (Pro)

How TreeMonk implements the **FamilySearch Solutions Program Brand Guide v1.0 (9/2018)**
and the developer **Integration Logos** guide. Written so a FamilySearch reviewer can
check each requirement against a concrete place in the app.

All artwork is the **unmodified official download** from
`edge.fscdn.org/assets/img/certification/…`, stored in
`src/renderer/src/assets/familysearch/`. Nothing is recoloured, cropped or redrawn.

Implementation lives in one place — `src/renderer/src/components/common/FsBrand.tsx` —
so call sites cannot get the rules wrong.

## Logo

| Requirement | Implementation |
|---|---|
| Full colour whenever possible | `FsLogo` always renders the full-colour logo. Because the guide states the logo is white when placed on another colour, we instead give it its own **light safe-area** in both light and dark themes — the approved full-colour rendering is therefore used everywhere, and never sits on an arbitrary background. |
| Minimum height 32 pt | `FsLogo` clamps height to ≥ 43 px (32 pt = 42.67 px). Measured in the shipped markup: **44 px**. |
| Clear space | Padding of 32 % of logo height on all four sides. Measured: **14 px** on each side at the default 44 px height. |
| Not distorted | Height is set, width is `auto`; verified aspect ratio matches the source 3462×900. |
| Used when visually referring to FamilySearch | FamilySearch hub dialog header (`components/settings/FamilySearchDialog.tsx`). The launch splash uses the Solutions Program logo instead (see below). |

## Tree icon

| Requirement | Implementation |
|---|---|
| Only for programmatic functions (API calls, authentication) | `FsTreeIcon` is used solely on the FamilySearch **connection-state badge** (`components/layout/FamilySearchStatusBadge.tsx`), which reflects API sign-in state. |
| Whole graphic at 16×16 or 32×32 | `FsTreeIcon` accepts only `16 | 32` and sets both width and height. Measured: **16×16** rendered from the official 32×32 source. |
| Never on a button with other words | The badge is a non-interactive `<span>` indicator; the icon carries no text. No button in the app places the tree icon next to a label. |
| Never a favicon, never a link to a FamilySearch website | The app favicon/window icon is TreeMonk's own (`build/icon.*`). The icon is not wrapped in any link. |
| Does not replace the FamilySearch logo or a Solutions Program logo | The logo is used in the FamilySearch dialog; the icon appears only in the compact status badge. |

## Solutions Program tier logo

`FsSolutionBadge` renders the official **FamilySearch Compatible Solution** artwork
(`SOLUTION_TIER = 'compatible'` in `FsBrand.tsx`), unmodified.

Where it appears:

- **Settings → Help → About** (`AboutBlock` in `components/settings/SettingsView.tsx`) — the
  app's credit-notice section, and the primary placement: tier logo, the trademark notice
  and our own name + version together.
- **Credit area of the FamilySearch hub dialog**, above the trademark notice.
- **Launch splash** (`components/common/Preloader.tsx`) — see the note below.

> **Open point on the splash.** The guide names "a solution provider's website and print
> collateral" as the surfaces for this logo; a desktop launch splash is not in that list
> (though page 5 implies the Solutions Program logo does have a place within a solution,
> since the tree icons "are not to replace" it). Because a splash is the most prominent,
> unavoidable brand surface in the app, it is worth confirming that placement with our
> FamilySearch contact in writing. The About block above is the placement the guide
> itself names, so it stands on its own if the splash usage is dropped.

How the guide's rules are met:

| Requirement | Implementation |
|---|---|
| Only shown for the approved tier | The tier is a single constant, set to the level FamilySearch accepted TreeMonk at. Changing tier is a one-line change; the three official tier files are all present. |
| Only shown when the integration exists | Both placements are gated on `familysearch.configured()`, so a build with no AppKey shows no FamilySearch branding at all. |
| Approved rendering, not on an arbitrary colour | The logo gets its own white safe-area with clear space (26 % of its height), so the full-colour artwork is never placed directly on the deep-teal splash. |
| No added wording | The artwork already carries its own "COMPATIBLE SOLUTION" wording, so no label is placed next to it. |
| Our name stays more prominent | On the splash the TreeMonk wordmark is 44 px extrabold with the animated TreeMonk mark above it; the tier logo is 52 px tall, lower on the screen and visually secondary. |
| Links to our Solutions Gallery listing | `SOLUTION_GALLERY_URL` — set it once the listing is live and the badge becomes clickable. The guide requires the link for websites and web applications; the desktop splash is neither, and is not interactive. |
| Not an endorsement | The badge indicates programme acceptance only; no text anywhere claims sponsorship, endorsement or legal association. |

## Trademark and text usage

| Requirement | Implementation |
|---|---|
| Ownership notice in the credit-notice section | `FsTrademarkNotice` renders the guide's exact wording — "FamilySearch and the FamilySearch logo are trademarks of Intellectual Reserve" — in the credit area at the bottom of the FamilySearch hub dialog. Kept verbatim in English in all locales, as a legal notice. (The splash is a brand surface, not the credit-notice section, so it carries the tier logo only.) |
| Our company/product name more prominent than the FamilySearch trademark | `FsWorksWithHeader` renders "TreeMonk" at 18 px semibold above an 11 px muted relationship line, next to the logo. |
| Relationship phrased with "work with" | The header line reads "works with FamilySearch" (hu: "együttműködik a FamilySearch szolgáltatással", de: "arbeitet mit FamilySearch zusammen") — never "FamilySearch application/service". |
| No possessive or plural form of the trademark | Fixed in all three locales: `fs.signInHelp` now says "the FamilySearch website" (hu "a FamilySearch weboldalán", de "auf der FamilySearch Website") instead of the previous possessive "FamilySearch's own page" / "FamilySearch saját oldalán" / "der eigenen Seite von FamilySearch". |
| No abbreviation or acronym | The string "FamilySearch" is always spelled in full, CamelCase, in every locale file. |
| "Sign in" / "sign out", not "log in" / "log out" | `fs.signInBtn`, `fs.signedIn`, `fs.signOut`, `fs.loginFailed` all use sign-in wording in the user-facing text. |
| No implied endorsement, sponsorship or legal association | No claim of certification, approval or partnership appears anywhere; the tier logo (the only endorsement-adjacent asset) is disabled until approval. |

## Data-use notice

Independently of the brand guide, the Solutions Program data-resale prohibition is shown
on both the sign-in and the import screens (`fs.dataResaleNotice`).

## Verification

`npm run typecheck` and `npm run build` are green, the brand assets are emitted into the
renderer bundle, and the sizes above were measured on the rendered markup.
