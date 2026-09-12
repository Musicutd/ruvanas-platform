export const ruvanasProductGuides = Object.freeze([
  {
    id: "retail",
    tabLabel: "Retail",
    tabDescription: "Shops and customer spaces",
    eyebrow: "RETAIL RADIO",
    title: "Run consistent radio across every location",
    introduction: "Retail Radio connects your approved music, promotions, schedules and physical players. You prepare the experience in the dashboard; each enrolled player receives the correct programme for its location and zone.",
    outcome: "A controlled in-store service that keeps playing, follows local schedules and records delivery evidence.",
    startHref: "/dashboard/retail",
    startLabel: "Open Retail Radio",
    chapters: [
      {
        title: "1. Confirm the account and service",
        summary: "Know who can make changes and which plan allowances apply.",
        detail: "Your organisation is the security and billing boundary. Owners and managers control setup; other team roles see only the tools allowed to them. Account & plan shows the active Retail plan, location allowance, player allowance and optional services.",
        steps: ["Open Account & plan and confirm Retail Radio is active.", "Open Organisation & team and give each colleague the smallest suitable role.", "Check Notification centre for anything that blocks setup or playback."],
        links: [{ href: "/dashboard/account", label: "Account & plan" }, { href: "/dashboard/team", label: "Organisation & team" }]
      },
      {
        title: "2. Create locations and listening zones",
        summary: "Describe where audio will play before connecting devices.",
        detail: "A location represents a physical shop or venue. A zone represents a listening area inside it, such as the shop floor, café or entrance. Schedules and players use these records so content cannot accidentally cross into another location.",
        steps: ["Create the physical location with its local timezone and opening hours.", "Add one or more clearly named zones inside the location.", "Use location groups only when several shops should share the same controlled setup."],
        links: [{ href: "/dashboard/locations", label: "Locations & zones" }]
      },
      {
        title: "3. Prepare music and audio safely",
        summary: "Build a rights-cleared library without exposing storage details.",
        detail: "Your Media library holds organisation-owned music, promotions and voice material. Every music track needs clear rights, permitted territories and product uses. Ruvanas catalogue music remains subject to the genre access included in the current plan.",
        steps: ["Upload audio and enter accurate title, artist and rights information.", "Select Retail Radio only when the licence permits retail use.", "Wait for the item to become approved or ready before using it in programming."],
        links: [{ href: "/dashboard/media", label: "Media library" }]
      },
      {
        title: "4. Build programming and AutoDJ",
        summary: "Choose what plays, when it plays and what fills every gap.",
        detail: "Programming combines Music Modes, schedules and AutoDJ. Music Modes define an approved rotation. Weekly schedules decide when each mode applies. Continuous AutoDJ protects unscheduled time, while timed playlist generation prepares a finite, reviewable sequence for a chosen date and window.",
        steps: ["Create or select an approved Music Mode for the required mood.", "Add weekly schedule blocks in the location timezone.", "Configure Continuous AutoDJ as the gap-filling default and optional backup.", "Use Timed playlist for a fixed, versioned programme in a particular window.", "Preview the result before publishing it."],
        links: [{ href: "/dashboard/programming", label: "Programming & AutoDJ" }]
      },
      {
        title: "5. Add promotions without breaking the music flow",
        summary: "Schedule approved messages with dates, times and delivery rules.",
        detail: "Promotions are controlled insertions, not replacements for the underlying music schedule. Each promotion carries its own campaign window, destination and approval status. The playout resolver inserts only currently eligible material.",
        steps: ["Prepare or upload the promotional audio.", "Choose the correct Retail destination and campaign dates.", "Review the delivery preview and publish only approved material.", "Use delivery reports to confirm completed plays."],
        links: [{ href: "/dashboard/promotions", label: "Promotions" }, { href: "/dashboard/reports", label: "Delivery reports" }]
      },
      {
        title: "6. Enrol and place each player",
        summary: "Connect the device that turns the plan into audio in the shop.",
        detail: "A player belongs to one organisation and one location zone. The one-time enrolment code establishes that relationship. Once online, the player asks the shared resolver for the correct programme and reports operational evidence back to Ruvanas.",
        steps: ["Create the player for the exact location and zone.", "Open the player page on the listening device and enter the one-time code.", "Keep one active player session per intended audio device.", "Check that the player reports online before leaving the location."],
        links: [{ href: "/dashboard/players", label: "Players & devices" }, { href: "/dashboard/player-sessions", label: "Live streams" }]
      },
      {
        title: "7. Monitor service and delivery evidence",
        summary: "See what is online, what played and what needs attention.",
        detail: "Service insights shows operational trends, while Live streams shows current connections. Delivery reports use verified proof-of-play records rather than assuming that a scheduled item played. Notifications surface issues that need an owner or manager.",
        steps: ["Check Live streams for active device sessions.", "Review Service insights for interruptions or unusual trends.", "Open Delivery reports when a campaign needs evidence.", "Follow Notification centre actions instead of repeatedly changing a healthy schedule."],
        links: [{ href: "/dashboard/analytics", label: "Service insights" }, { href: "/dashboard/notifications", label: "Notification centre" }]
      },
      {
        title: "8. Add optional visual and production services",
        summary: "Use Digital Signage, Retail Media or Studio only when included.",
        detail: "Optional services reuse the same organisation boundary. Digital Signage manages screens, visual playlists and takeovers. Retail Media coordinates governed campaigns. Ruvanas Studio provides professional production requests without giving production staff uncontrolled access to your radio setup.",
        steps: ["Confirm the optional service appears in Account & plan.", "Open its dedicated workspace rather than mixing visual and audio devices.", "Keep approvals and delivery evidence with the related campaign or production order."],
        links: [{ href: "/dashboard/digital-signage", label: "Digital Signage" }, { href: "/dashboard/retail-media", label: "Retail Media" }, { href: "/dashboard/studio", label: "Ruvanas Studio" }]
      }
    ]
  },
  {
    id: "school",
    tabLabel: "School",
    tabDescription: "Safeguarded broadcasting",
    eyebrow: "SCHOOL RADIO",
    title: "Create radio with safeguarding built in",
    introduction: "School Radio is a staff-managed workspace for supervised programmes, learning and controlled publishing. Safeguarding, consent and staff responsibility come before student access or public release.",
    outcome: "A private-by-default environment where staff remain responsible for every student workflow and publication decision.",
    startHref: "/dashboard/school",
    startLabel: "Open School Radio",
    chapters: [
      {
        title: "1. Complete safeguarding readiness first",
        summary: "Record the school rules before inviting students or publishing.",
        detail: "The safeguarding pack defines territory, age and consent expectations, the responsible privacy contact, moderation arrangements and retention. Completing it does not automatically enable students, messaging or public publishing; it creates the controlled policy boundary those later actions must respect.",
        steps: ["Open the School production suite and start in Overview.", "Complete territory, age, consent, privacy and retention information.", "Name the responsible safeguarding and operational contacts.", "Submit the pack for the required staff approval."],
        links: [{ href: "/dashboard/school-radio", label: "School production suite" }]
      },
      {
        title: "2. Assign staff responsibility and student access",
        summary: "Keep supervision explicit and access time-bounded.",
        detail: "Staff roles and student access are separate. An authorised staff member supervises the programme and remains accountable for review. Student invitations are limited to the school workspace and do not create general subscriber or administration access.",
        steps: ["Add staff through Organisation & team with the correct role.", "Assign the staff supervisor before creating a student-led programme.", "Invite students only through the guarded student-access workflow.", "Revoke access promptly when participation ends."],
        links: [{ href: "/dashboard/team", label: "Organisation & team" }, { href: "/dashboard/school-radio", label: "People & safety" }]
      },
      {
        title: "3. Prepare school locations and private listening",
        summary: "Connect school audio without making the workspace public.",
        detail: "Physical School Radio uses locations, zones and enrolled players in the same protected delivery core as Retail Radio, but school policy remains stricter. A classroom, studio or common area should have its own clearly identified zone and device assignment.",
        steps: ["Create the school location and local timezone.", "Add only the listening zones the school intends to operate.", "Enrol a player for the exact zone and confirm it is online.", "Keep public publishing disabled unless the separate approval path is complete."],
        links: [{ href: "/dashboard/locations", label: "Locations & zones" }, { href: "/dashboard/players", label: "Players & devices" }]
      },
      {
        title: "4. Record and edit in the production Studio",
        summary: "Create audio non-destructively from recording to mastered review.",
        detail: "The School Studio provides guided recording, waveform editing, voice cleanup, effects, mastering and multitrack tools. Original recordings remain protected. Edits create recoverable versions, and rendered previews remain subject to staff review.",
        steps: ["Create a project and record or upload a protected take.", "Trim, fade and save waveform edits as a new version.", "Use voice cleanup and compare Before and After previews.", "Apply a delivery preset and confirm mastering quality.", "Build and render the multitrack project, then send it for staff review."],
        links: [{ href: "/dashboard/school-radio", label: "Studio workspace" }]
      },
      {
        title: "5. Build programmes and editorial content",
        summary: "Turn supervised ideas into structured shows and stories.",
        detail: "Programmes group episodes, production responsibility and release decisions. Show Builder, news and editorial tools keep scripts, fact-checking, audio and approvals connected. Saving a draft never means it is approved or public.",
        steps: ["Create the programme and assign its staff supervisor.", "Prepare the episode outline, script or newsroom assignment.", "Attach facts, sources and production material where required.", "Complete the staff editorial review before requesting publication."],
        links: [{ href: "/dashboard/school-radio", label: "Programmes" }]
      },
      {
        title: "6. Review, approve and publish deliberately",
        summary: "Separate production completion from permission to release.",
        detail: "A finished recording can still be unsuitable for release. School publication checks safeguarding readiness, staff authority, editorial state, rights and the chosen destination. Private playback, a podcast and a public page are different destinations with different consequences.",
        steps: ["Confirm the final audio and metadata are correct.", "Choose the intended private or approved public destination.", "Complete the staff review and publication checklist.", "Publish once, then verify the destination rather than creating duplicates.", "Withdraw the release immediately if safeguarding or rights change."],
        links: [{ href: "/dashboard/school-radio", label: "Publishing controls" }]
      },
      {
        title: "7. Use learning and school exchange safely",
        summary: "Keep assessment and collaboration inside guarded boundaries.",
        detail: "Learning tools connect submissions, assessments and staff feedback without exposing general account data. School Exchange shares only approved material between explicitly participating schools. Neither feature turns the school workspace into open social messaging.",
        steps: ["Create the learning activity or approved exchange item.", "Limit participation to the intended school members.", "Review submissions and release staff feedback deliberately.", "Remove or withdraw shared material when its approval no longer applies."],
        links: [{ href: "/dashboard/school-radio", label: "Learning & exchange" }]
      },
      {
        title: "8. Monitor privacy, retention and support",
        summary: "Review evidence without exposing student information.",
        detail: "School operations preserve audit and moderation evidence under the stated retention rules. Notifications identify required action without placing private student content in general dashboards. Owners and authorised staff should use Support requests when the safe next step is unclear.",
        steps: ["Review school readiness and outstanding moderation work.", "Follow the approved retention and withdrawal process.", "Keep student information out of screenshots and ordinary support notes.", "Send a secure support request when staff cannot resolve the issue."],
        links: [{ href: "/dashboard/notifications", label: "Notification centre" }, { href: "/dashboard/support", label: "Support requests" }]
      }
    ]
  },
  {
    id: "radio",
    tabLabel: "Radio",
    tabDescription: "Online station and listeners",
    eyebrow: "ONLINE RADIO",
    title: "Operate a complete online radio station",
    introduction: "Online Radio brings station identity, music programming, live operation, public listening, podcasts, advertising and reporting into one governed service. The public player receives only material that the shared resolver considers active and eligible.",
    outcome: "A professional online station with controlled scheduling, resilient playout, public listening and attributable delivery evidence.",
    startHref: "/dashboard/radio",
    startLabel: "Open Online Radio",
    chapters: [
      {
        title: "1. Create the station and confirm its identity",
        summary: "Set the foundation before publishing a player or website.",
        detail: "The station record holds the listener-facing name, slug, stream configuration and channel relationship. It belongs to the signed-in organisation and stays separate from Retail and School products even when the same team operates them.",
        steps: ["Open Online Radio and create the first station if prompted.", "Confirm the station name, public identity and required stream settings.", "Complete the setup checks before sharing listener links.", "Use Station networks only for explicit cross-organisation relationships."],
        links: [{ href: "/dashboard/radio", label: "Online Radio dashboard" }]
      },
      {
        title: "2. Build the rights-cleared music library",
        summary: "Prepare content the scheduler and resolver are allowed to use.",
        detail: "Organisation uploads remain separate from the Ruvanas catalogues. Track eligibility considers approval state, rights dates, territory, explicit-content rules and Online Radio product use. Locked catalogue genres cannot be selected by changing a browser request.",
        steps: ["Upload owned or licensed material in Media library.", "Enter accurate rights, territory and Online Radio usage information.", "Choose genres that reflect the recording and current plan access.", "Wait for approval before adding a track to live programming."],
        links: [{ href: "/dashboard/media", label: "Media library" }]
      },
      {
        title: "3. Plan music with modes, schedules and AutoDJ",
        summary: "Create a deliberate sound while protecting every unscheduled minute.",
        detail: "Music Modes define rotations. The Advanced Scheduler and Radio Clocks place programmes and exact-time events. Continuous AutoDJ fills gaps using approved sources and a backup policy. Timed playlists generate a finite, reviewable sequence with frozen versions for a specific local window.",
        steps: ["Prepare Music Modes for the station formats or dayparts.", "Build the weekly schedule in the station timezone.", "Configure Continuous AutoDJ and keep a distinct backup where available.", "Generate a Timed playlist for special windows, review its order and publish the approved version.", "Use schedule preview to identify gaps or conflicts."],
        links: [{ href: "/dashboard/programming", label: "Programming & AutoDJ" }]
      },
      {
        title: "4. Operate live and recorded programming",
        summary: "Use live sources without sacrificing scheduled fallback.",
        detail: "External Live, Browser Live Studio, DJ access and voice tracking are controlled inputs to the same playout decision. A live source must be healthy and authorised. When unavailable, the resolver returns to eligible scheduled or AutoDJ material instead of claiming that silence is live content.",
        steps: ["Prepare the live source and verify its health before activation.", "Grant presenters only the station, channel and time window they need.", "Keep scheduled or AutoDJ material ready as fallback.", "End the live session cleanly and review its operational evidence."],
        links: [{ href: "/dashboard/programming", label: "Live & advanced programming" }]
      },
      {
        title: "5. Publish the public player and station website",
        summary: "Give listeners a branded, capacity-controlled destination.",
        detail: "The Public player is the approved web listening surface and can provide an embed. The station website adds now-playing, podcasts, installable mobile behaviour and optional verified-domain routing. Listener sessions remain capacity controlled and privacy aware.",
        steps: ["Complete station setup and verify a playable programme is available.", "Open Public player and review the listener-facing identity.", "Publish or share the approved station URL and embed.", "Configure the station website and custom domain only after provider verification."],
        links: [{ href: "/dashboard/radio", label: "Station and public player" }]
      },
      {
        title: "6. Create shows, podcasts and newsroom output",
        summary: "Manage recorded editorial content from draft to release.",
        detail: "Show Builder structures programmes and episodes. Podcasts add an approved public series and RSS destination. Newsroom separates assignment, sourcing, fact-checking, production and editorial release. Each workflow keeps drafts private until the relevant approval is recorded.",
        steps: ["Create the programme, episode or newsroom assignment.", "Prepare scripts, sources and production audio.", "Complete editorial and rights review.", "Publish to the intended station, podcast or web destination.", "Verify the public result and withdraw it if approval changes."],
        links: [{ href: "/dashboard/podcasts", label: "Podcasts" }, { href: "/dashboard/radio/newsroom", label: "Newsroom" }]
      },
      {
        title: "7. Manage advertising, syndication and distribution",
        summary: "Connect commercial and partner workflows without bypassing governance.",
        detail: "Promotions and Radio advertising use protected placement and proof rules. Syndication shares approved programmes or live relays through explicit agreements. Distribution connects provider adapters such as directories or CDN partners; it does not invent provider approval or credentials.",
        steps: ["Configure commercial limits and approve the audio before scheduling.", "Use syndication only with a recorded rights-controlled agreement.", "Connect distribution providers through the governed integration workspace.", "Review delivery and failure evidence before treating an external destination as live."],
        links: [{ href: "/dashboard/radio/advertising", label: "Radio advertising" }, { href: "/dashboard/radio/syndication", label: "Programme syndication" }, { href: "/dashboard/radio/distribution", label: "Station distribution" }]
      },
      {
        title: "8. Monitor listeners, rights and station health",
        summary: "Use evidence to operate the station instead of guessing.",
        detail: "Listener analytics reports privacy-safe audience sessions and trends. Service insights surfaces operational changes. Rights & royalty reports build attested usage exports from recognised identifiers and verified playout evidence. Notifications identify problems that require attention.",
        steps: ["Review live sessions and listener trends in the appropriate period.", "Check station and source health before changing programming.", "Reconcile rights reports against verified usage evidence.", "Follow notifications and escalate unresolved incidents through Support requests."],
        links: [{ href: "/dashboard/listener-analytics", label: "Listener analytics" }, { href: "/dashboard/radio/rights-reporting", label: "Rights & royalty reports" }, { href: "/dashboard/support", label: "Support requests" }]
      }
    ]
  }
]);
