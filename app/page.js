import styles from "./home.module.css";
import { prisma } from "@/lib/prisma";
import { registrationProducts, registrationProductsFromDatabasePlans } from "@/lib/registration-experience.mjs";
import { SELF_SERVICE_REGISTRATION_ENABLED } from "@/lib/registration-availability.mjs";
import { isHomepageProductVisible } from "@/lib/public-homepage-launch.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ruvanas Retail | Music for your shops by 21-Three",
  description:
    "Ruvanas Retail brings continuous music, scheduling and shop announcements together, with a Focused Licensed Music Catalogue subject to product-use and territory rights.",
};

const platforms = [
  {
    productId: "RETAIL",
    number: "01",
    title: "In-house & Retail Radio",
    text: "Create a consistent branded atmosphere across one shop or an entire estate, with central scheduling, professional playout and location-level control.",
    features: ["Multi-location control", "Branded messages", "Proof of play"],
    icon: "retail",
  },
  {
    productId: "SCHOOL",
    number: "02",
    title: "School Radio",
    text: "Give students a creative voice through a purpose-built platform with supervised production, safeguarded publishing and multi-school administration.",
    features: ["Safeguarded workflows", "Student production", "Noticeboards"],
    icon: "school",
  },
  {
    productId: "ONLINE",
    number: "03",
    title: "Complete Online Radio",
    text: "Build a full online station with live and automated programming, public listening, a growing music database and operational tools in one place.",
    features: ["Live & AutoDJ", "Public web player", "Music database ready"],
    icon: "broadcast",
  },
  {
    productId: "HEALTH",
    number: "04",
    title: "Ruvanas Health",
    text: "Help hospitals, health organisations and wellbeing teams operate their own privacy-aware audio, podcasts and digital displays.",
    features: ["Hospital and ward channels", "Moderated requests", "Restricted listening"],
    icon: "health",
  },
  {
    productId: "FAITH",
    number: "05",
    title: "Ruvanas Faith",
    text: "Give churches and ministries one subscriber-operated home for continuous radio, live services, teachings and campus media.",
    features: ["24/7 AutoDJ", "Live-service handoff", "Sermon archives"],
    icon: "faith",
  },
  {
    productId: "ORGANISATIONS",
    number: "06",
    title: "Ruvanas Organisations",
    text: "Give NGOs, clubs, associations, civic groups and networks one governed home for their own media, events, announcements and displays.",
    features: ["Governed announcements", "Event Mode", "Branch controls"],
    icon: "organisations",
  },
  {
    productId: "CORRECTIONS",
    number: "07",
    title: "Ruvanas Inside",
    text: "A governed foundation for private correctional-facility radio and rehabilitation media. Facility controls and secure delivery are being prepared.",
    features: ["Private by design", "Facility governance", "Rehabilitation media"],
    icon: "organisations",
  },
];

const services = [
  ["High-quality sound", "Professional audio delivery up to 320 kbps for a clear, reliable listening experience."],
  ["Smart scheduling", "Plan music, programmes, announcements and campaigns by day, time, location or audience."],
  ["Continuous AutoDJ", "Keep every channel moving with synchronized playout, smooth transitions and resilient recovery."],
  ["Central control", "Manage your shop locations, listening areas and players from one secure workspace."],
  ["Music & media", "Organise approved music, programmes, jingles and promotional audio in a protected media library."],
  ["Reporting & insight", "Understand activity with listener, player, campaign and proof-of-play reporting."],
  ["Safe collaboration", "Use role-based access, approvals and audit trails designed for teams and supervised environments."],
  ["Room to grow", "Start with one shop, then bring more locations and audio campaigns into your Retail workspace as you expand."],
];

const pricingFamilyDefinitions = [
  {
    id: "retail",
    productId: "RETAIL",
    eyebrow: "In-house & Retail Radio",
    title: "Build the right atmosphere in every location.",
    text: "Professional music, messages and reporting for independent shops, growing businesses and multi-site brands."
  },
  {
    id: "school",
    productId: "SCHOOL",
    eyebrow: "School Radio",
    title: "Give every school a safe, creative voice.",
    text: "Purpose-built tools for supervised production, protected publishing and confident school-wide broadcasting."
  },
  {
    id: "online",
    productId: "ONLINE",
    eyebrow: "Complete Online Radio",
    title: "Launch a station built to reach listeners everywhere.",
    text: "Live and automated broadcasting, public listening and professional station operations in one complete platform."
  },
  {
    id: "health",
    productId: "HEALTH",
    eyebrow: "Ruvanas Health",
    title: "Support every health space with calm, controlled audio.",
    text: "Hospital and wellbeing radio, moderated requests, podcasts, players and displays with non-clinical privacy boundaries."
  },
  {
    id: "faith",
    productId: "FAITH",
    eyebrow: "Ruvanas Faith",
    title: "Keep ministry media connected throughout the week.",
    text: "Continuous radio, live-service handoff, teachings, podcasts and multi-campus delivery under subscriber control."
  },
  {
    id: "organisations",
    productId: "ORGANISATIONS",
    eyebrow: "Ruvanas Organisations",
    title: "Bring your organisation’s media into one governed workspace.",
    text: "Subscriber-operated channels, announcements, events, podcasts, sponsors, displays and branch controls."
  },
  {
    id: "corrections",
    productId: "CORRECTIONS",
    eyebrow: "Ruvanas Inside",
    title: "Prepare secure media for correctional environments.",
    text: "Commercial and account foundation is available; private delivery and facility governance require a later setup stage."
  },
];

function planFeatures(plan) {
  if (plan.productFamily === "CORRECTIONS") return [
    { label: "Corrections product access and guided foundation", included: true },
    { label: `Ruvanas Studio ${plan.studioLevel} tier entitlement`, included: true },
    { label: plan.catalogueDescription, included: plan.licensedMusicCatalogueLevel !== "NONE" },
    { label: "Private playback requires facility policy and delivery setup", included: false }
  ];
  if (plan.productFamily === "RETAIL") {
    const siteLabel = plan.stationLimit === 1 ? "1 site" : `Up to ${plan.stationLimit} sites`;
    return [
      { label: siteLabel, included: true },
      { label: `${plan.storageLimitGb} GB media storage`, included: true },
      { label: `High-quality audio up to ${plan.maxBitrateKbps} kbps`, included: true },
      { label: `Ruvanas Studio ${plan.studioLevel}`, included: true },
      { label: plan.catalogueDescription, included: plan.licensedMusicCatalogueLevel !== "NONE" }
    ];
  }
  return [
    { label: `Up to ${plan.stationLimit} ${["HEALTH", "FAITH", "ORGANISATIONS"].includes(plan.productFamily) ? "site or station" : "station"}${plan.stationLimit === 1 ? "" : "s"}`, included: true },
    { label: `${plan.storageLimitGb} GB media storage`, included: true },
    { label: `Up to ${plan.listenerLimit.toLocaleString("en-GB")} active listeners`, included: true },
    { label: `High-quality audio up to ${plan.maxBitrateKbps} kbps`, included: true },
    { label: plan.catalogueDescription, included: plan.licensedMusicCatalogueLevel !== "NONE" }
  ];
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function PlatformIcon({ type }) {
  if (type === "health") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 7h12v11h11v12H30v11H18V30H7V18h11V7Z" /></svg>;
  }
  if (type === "faith") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="4" /><path d="M16 16a11 11 0 0 0 0 16M32 16a11 11 0 0 1 0 16M10 10a20 20 0 0 0 0 28M38 10a20 20 0 0 1 0 28" /></svg>;
  }
  if (type === "organisations") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="11" r="5"/><circle cx="11" cy="35" r="5"/><circle cx="37" cy="35" r="5"/><path d="M24 16v8M14 32l7-6M34 32l-7-6"/></svg>;
  }
  if (type === "school") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M5 19 24 8l19 11-19 11L5 19Z" />
        <path d="M12 24v10c5 6 19 6 24 0V24M42 21v13" />
      </svg>
    );
  }

  if (type === "broadcast") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="4" />
        <path d="M16 16a11 11 0 0 0 0 16M32 16a11 11 0 0 1 0 16M10 10a20 20 0 0 0 0 28M38 10a20 20 0 0 1 0 28" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 39V17h32v22M5 17h38L39 8H9L5 17Z" />
      <path d="M15 39V26h9v13M31 26v5M36 26v5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className={styles.arrowIcon} viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 9h11M10 4l5 5-5 5" />
    </svg>
  );
}

export default async function HomePage() {
  let approvedProductPlans = registrationProducts();
  try {
    const databasePlans = await prisma.plan.findMany({ where: { publiclyAvailable: true } });
    approvedProductPlans = registrationProductsFromDatabasePlans(databasePlans);
  } catch (error) {
    console.error("Unable to load live pricing; using the verified catalogue defaults:", error);
  }
  const visiblePlatforms = platforms.filter((platform) => isHomepageProductVisible(platform.productId));
  const pricingFamilies = pricingFamilyDefinitions.filter((family) => isHomepageProductVisible(family.productId)).map((family) => ({
    ...family,
    tiers: approvedProductPlans.find((product) => product.id === family.productId)?.plans || []
  }));
  const waveform = [28, 45, 68, 38, 82, 54, 92, 62, 35, 74, 48, 88, 58, 32, 67, 44, 78, 52, 90, 40, 64, 30, 55, 36];

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>

      <header className={styles.header}>
        <div className={styles.navShell}>
          <a className={styles.logo} href="#top" aria-label="Ruvanas home">
            <BrandMark />
            <span className={styles.logoText}>RUVANAS</span>
            <span className={styles.logoParent}>Part of 21-Three</span>
          </a>

          <nav className={styles.navLinks} aria-label="Main navigation">
            <a href="#platforms">Retail Radio</a>
            <a href="/how-it-works">How it works</a>
            <a href="#services">Services</a>
            <a href="#pricing">Pricing</a>
            <a href="#story">Our story</a>
          </nav>

          <div className={styles.navActions}>
            <a className={styles.loginLink} href="/login">Log in</a>
            <a className={styles.navCta} href="/login">Log in <ArrowIcon /></a>
          </div>
        </div>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid} id="main-content">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> Retail radio by 21-Three</p>
            <h1>Every shop deserves its <em>own sound.</em></h1>
            <p className={styles.heroLead}>
              Bring the right music, your shop announcements and a simple weekly plan together—across one shop or all your locations.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="/login">Log in with issued code <ArrowIcon /></a>
              <a className={styles.secondaryButton} href="/how-it-works">See how it works</a>
            </div>
            <div className={styles.heroProof} aria-label="Ruvanas platform highlights">
              <div><strong>320</strong><span>kbps high-quality audio</span></div>
              <div><strong>24/7</strong><span>automated playout</span></div>
              <div><strong>One plan</strong><span>music for your shops</span></div>
            </div>
          </div>

          <div className={styles.heroVisual} aria-label="Illustrative Retail audio network concept">
            <div className={styles.livePanel}>
              <div className={styles.panelTop}>
                <div>
                  <span className={styles.liveBadge}><i /> Retail audio concept</span>
                  <p>Your shared Retail programme</p>
                </div>
                <span className={styles.qualityBadge}>HQ 320</span>
              </div>
              <div className={styles.nowPlaying}>
                <div className={styles.albumArt}><BrandMark /></div>
                <div>
                  <span>Now playing</span>
                  <strong>Your brand. Your sound.</strong>
                  <small>Shared channel clock · Smooth mix</small>
                </div>
                <button type="button" aria-label="Illustrative audio display; no playback" disabled>
                  <span /><span /><span />
                </button>
              </div>
              <div className={styles.waveform} aria-hidden="true">
                {waveform.map((height, index) => <span key={index} style={{ "--bar-height": `${height}%` }} />)}
              </div>
              <div className={styles.networkLine}>
                <span>Music</span><i /><span>Messages</span><i /><span>Your shops</span>
              </div>
            </div>

            <div className={`${styles.floatingCard} ${styles.cardRetail}`}>
              <PlatformIcon type="retail" /><span><strong>Retail</strong>One shared programme</span>
            </div>
            {isHomepageProductVisible("SCHOOL") ? <div className={`${styles.floatingCard} ${styles.cardSchool}`}>
              <PlatformIcon type="school" /><span><strong>School</strong>Safeguarded publishing</span>
            </div> : null}
            {isHomepageProductVisible("ONLINE") ? <div className={`${styles.floatingCard} ${styles.cardOnline}`}>
              <PlatformIcon type="broadcast" /><span><strong>Online</strong>Listeners connected</span>
            </div> : null}
          </div>
        </div>
      </section>

      <section className={styles.introStrip} aria-label="Ruvanas introduction">
        <p>One music plan for all your shops.</p>
        <div><span>Music</span><i /><span>Scheduling</span><i /><span>Shop messages</span></div>
      </section>

      <section className={styles.section} id="platforms">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Built for Retail</p>
            <h2>Your brand. Your music. Every location.</h2>
          </div>
          <p>Choose approved music, plan the day and share your own messages through one Retail audio workspace.</p>
        </div>

        <div className={`${styles.platformGrid} ${visiblePlatforms.length === 1 ? styles.singlePlatform : ""}`}>
          {visiblePlatforms.map((platform) => (
            <article className={styles.platformCard} key={platform.title}>
              <div className={styles.platformTop}>
                <span className={styles.platformIcon}><PlatformIcon type={platform.icon} /></span>
                <span className={styles.platformNumber}>{platform.number}</span>
              </div>
              <h3>{platform.title}</h3>
              <p>{platform.text}</p>
              <ul>
                {platform.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.soundSection}>
        <div className={styles.soundVisual} aria-hidden="true">
          <div className={styles.orbit}><BrandMark /></div>
          <span className={styles.soundRingOne} />
          <span className={styles.soundRingTwo} />
          <span className={styles.soundDotOne} />
          <span className={styles.soundDotTwo} />
          <span className={styles.soundDotThree} />
        </div>
        <div className={styles.soundCopy}>
          <p className={styles.sectionEyebrow}>Sound quality without compromise</p>
          <h2>Clear, continuous and unmistakably yours.</h2>
          <p>Ruvanas is engineered for professional, high-quality sound across web players and enrolled devices. Synchronized channels, smooth transitions and resilient recovery keep your audience in the moment.</p>
          <div className={styles.soundFacts}>
            <div><strong>Up to 320 kbps</strong><span>High-quality audio delivery</span></div>
            <div><strong>Shared live clock</strong><span>Listeners join at the current moment</span></div>
            <div><strong>Smooth transitions</strong><span>Professional two-second crossfades</span></div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.servicesSection}`} id="services">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>What Ruvanas offers</p>
            <h2>Everything needed to stay on air.</h2>
          </div>
          <p>From your music selection to your own shop announcements, keep everyday audio work in one place.</p>
        </div>
        <div className={styles.servicesGrid}>
          {services.map(([title, text], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{title}</h3><p>{text}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.pricingSection} id="pricing">
        <div className={styles.pricingHeader}>
          <p className={styles.sectionEyebrow}>Retail plans</p>
          <h2>Start with your shop. Grow when you are ready.</h2>
          <p>Five Retail tiers, each with the Focused Licensed Music Catalogue, subject to product-use and territory rights.</p>
        </div>

        <div className={styles.pricingFamilies}>
          {pricingFamilies.map((family, familyIndex) => (
            <section className={styles.pricingFamily} id={`pricing-${family.id}`} key={family.id}>
              <div className={styles.familyHeader}>
                <span>{String(familyIndex + 1).padStart(2, "0")}</span>
                <div>
                  <p>{family.eyebrow}</p>
                  <h3>{family.title}</h3>
                </div>
                <p>{family.text}</p>
              </div>
              <div className={styles.pricingGrid}>
                {family.tiers.map((tier) => (
                  <article className={`${styles.priceCard} ${tier.tierNumber === 3 ? styles.featuredTier : ""}`} key={tier.name}>
                    {tier.tierNumber === 3 ? <span className={styles.popularLabel}>Most popular</span> : null}
                    <h4>{tier.name}</h4>
                    <p className={styles.tierDescription}>{tier.description}</p>
                    <div className={`${styles.price} ${styles.priceLabel}`}><strong>{tier.priceLabel}</strong></div>
                    {SELF_SERVICE_REGISTRATION_ENABLED ? (
                      <a className={tier.tierNumber === 3 ? styles.priceCtaFeatured : styles.priceCta} href="/login">
                        {tier.enterpriseContactRequired ? "Discuss " : "Choose "}{tier.name} <ArrowIcon />
                      </a>
                    ) : <span className={styles.priceCtaDisabled} aria-disabled="true">Registration paused</span>}
                    <ul>
                      {planFeatures(tier).map((feature) => <li className={feature.included ? undefined : styles.unavailableFeature} key={feature.label}><span aria-hidden="true">{feature.included ? "✓" : "⮽"}</span>{feature.label}</li>)}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.enterprisePlan}>
          <div><p>Enterprise</p><h3>Need a larger or specially configured service?</h3></div>
          <p>Discuss Retail locations, storage, account access, onboarding and support for your business.</p>
          {SELF_SERVICE_REGISTRATION_ENABLED
            ? <a href="/login">Talk to Ruvanas <ArrowIcon /></a>
            : <span className={styles.enterpriseRegistrationPaused} aria-disabled="true">Registration paused</span>}
        </div>
        <p className={styles.pricingNote}>Prices are shown in euro and exclude applicable tax. Music licensing, production, media, unusually high delivery volumes and bespoke services may be agreed separately. Final eligibility and service configuration are confirmed during onboarding.</p>
      </section>

      <section className={styles.storySection} id="story">
        <div className={styles.storyLabel}><span>Our story</span><i /></div>
        <div className={styles.storyContent}>
          <p className={styles.storyKicker}>Ruvanas · A 21-Three platform</p>
          <h2>Built from radio experience. Shaped by retail. Designed for what comes next.</h2>

          <div className={styles.storyIntro}>
            <p>The idea behind <strong>Ruvanas</strong> began with <strong>Manuel Chircop</strong>, whose connection with radio dates back to <strong>1993</strong>. Over more than three decades in broadcasting, Manuel experienced first-hand how radio evolved from traditional studios and scheduled programming into a world of streaming, automation, digital distribution and on-demand content.</p>
            <p>Alongside that broadcasting experience, more than a decade working within the <strong>retail environment</strong> gave him a different perspective: businesses increasingly needed better ways to manage music, promotions, customer communication and digital media across their physical locations.</p>
            <p>Those two worlds — <strong>broadcasting and retail</strong> — eventually came together.</p>
            <p>Manuel&apos;s objective was to bring that radio experience into everyday retail: professional music, shop announcements and straightforward planning in one connected audio workspace.</p>
            <p>Working with a team of professional engineers, that idea developed into <strong>Ruvanas</strong>.</p>
          </div>

          <section className={styles.storyChapter} aria-labelledby="story-five-worlds">
            <p className={styles.storyChapterNumber}>01</p>
            <div>
              <h3 id="story-five-worlds">One Retail workspace. Every shop connected.</h3>
              <p>Ruvanas Retail brings your music selection, weekly plan and shop messages together, so your locations share the sound of your business.</p>
              <div className={styles.storyProducts}>
                {isHomepageProductVisible("RETAIL") ? <article><span>Retail</span><p><strong>Ruvanas Retail</strong> gives retailers, hospitality businesses and other commercial organisations the tools to manage their own in-store audio, promotions, scheduling and multi-location audio.</p></article> : null}
                {isHomepageProductVisible("SCHOOL") ? <article><span>School</span><p><strong>Ruvanas School</strong> provides schools and educational organisations with a structured environment for school radio, podcasting, media production and supervised student participation.</p></article> : null}
                {isHomepageProductVisible("ONLINE") ? <article><span>Radio</span><p><strong>Ruvanas Radio</strong> provides broadcasters and organisations with the technology to create and operate their own online radio services, including automation, live broadcasting, scheduling, podcasts and listener-facing experiences.</p></article> : null}
                {isHomepageProductVisible("FAITH") ? <article><span>Faith</span><p><strong>Ruvanas Faith</strong> brings the traditional concept of Church Radio into a modern digital environment, giving churches, ministries and faith organisations the technology to operate their own radio channels, live services, sermons, podcasts and media networks.</p></article> : null}
                {isHomepageProductVisible("ORGANISATIONS") ? <article><span>Organisations</span><p><strong>Ruvanas Organisations</strong> gives NGOs, clubs, associations, community groups, civic organisations and networks technology for their own channels, announcements, events, podcasts, sponsors and displays—without becoming a CRM or administration system.</p></article> : null}
                {isHomepageProductVisible("HEALTH") ? <article><span>Health</span><p><strong>Ruvanas Health</strong> modernises the concept of Hospital Radio, giving hospitals and health-related organisations the tools to operate their own radio, audio and information services for patients, staff and wider communities.</p></article> : null}
              </div>
              <p className={styles.storyPrinciple}>In every case, <strong>Ruvanas provides the platform — the subscriber operates the service.</strong></p>
            </div>
          </section>

          <section className={styles.storyChapter} aria-labelledby="story-more-than-radio">
            <p className={styles.storyChapterNumber}>02</p>
            <div>
              <h3 id="story-more-than-radio">Music and messages, working together</h3>
              <p>Your everyday music continues with AutoDJ, while scheduled programmes and shop announcements give each day its shape.</p>
              <p>The Retail workspace combines <strong>24/7 AutoDJ, weekly scheduling, Ruvanas Studio, promotions, device management, analytics, proof-of-play, multi-location control and rights-aware media management</strong>.</p>
              <p>One connected workspace keeps the music plan and your own announcements organised as your business grows.</p>
            </div>
          </section>

          <section className={styles.storyChapter} aria-labelledby="story-international">
            <p className={styles.storyChapterNumber}>03</p>
            <div>
              <h3 id="story-international">Built in Malta. Designed for an international market.</h3>
              <p>Ruvanas is being developed with an international outlook from the beginning.</p>
              <p>While Malta provides an important foundation for development, testing and early partnerships, the ambition is to build a platform capable of serving organisations across <strong>Europe, the United Kingdom, the United States and beyond</strong>.</p>
              <p>The goal is not simply to follow the way media technology works today, but to build a platform capable of evolving with the organisations that use it.</p>
            </div>
          </section>

          <section className={`${styles.storyChapter} ${styles.storyClosing}`} aria-labelledby="story-still-writing">
            <p className={styles.storyChapterNumber}>04</p>
            <div>
              <h3 id="story-still-writing">The story is still being written.</h3>
              <p>Ruvanas started with a simple question:</p>
              <blockquote>Can decades of broadcasting experience and real-world business experience be transformed into one modern platform that helps organisations create, manage and control their own media?</blockquote>
              <p>That question became Ruvanas.</p>
              <p><strong>And this is only the beginning.</strong></p>
            </div>
          </section>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <p className={styles.sectionEyebrow}>Ready when you are</p>
          <h2>Give your shops a sound worth remembering.</h2>
        </div>
        <div className={styles.finalActions}>
          <a className={styles.primaryButton} href="/login">Log in with issued code <ArrowIcon /></a>
          <a className={styles.finalLogin} href="/login">Already a member? Log in</a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <a className={styles.logo} href="#top" aria-label="Ruvanas home">
            <BrandMark /><span className={styles.logoText}>RUVANAS</span>
          </a>
          <p>Professional music, scheduling and shop announcements for retailers and multi-location businesses.</p>
          <nav aria-label="Footer navigation">
            <a href="#platforms">Retail Radio</a><a href="#services">Services</a><a href="#pricing">Pricing</a><a href="/login">Log in</a>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Ruvanas. A part of 21-Three.</span>
          <span>Built for sound. Ready for the world.</span>
        </div>
      </footer>
    </main>
  );
}
