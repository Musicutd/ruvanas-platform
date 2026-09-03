import styles from "./home.module.css";

export const metadata = {
  title: "Ruvanas | Professional Radio Platforms by 21-Three",
  description:
    "Ruvanas, part of 21-Three, provides professional in-house radio, School Radio and complete online radio platforms with high-quality sound.",
};

const platforms = [
  {
    number: "01",
    title: "In-house & Retail Radio",
    text: "Create a consistent branded atmosphere across one shop or an entire estate, with central scheduling, professional playout and location-level control.",
    features: ["Multi-location control", "Branded messages", "Proof of play"],
    icon: "retail",
  },
  {
    number: "02",
    title: "School Radio",
    text: "Give students a creative voice through a purpose-built platform with supervised production, safeguarded publishing and multi-school administration.",
    features: ["Safeguarded workflows", "Student production", "Noticeboards"],
    icon: "school",
  },
  {
    number: "03",
    title: "Complete Online Radio",
    text: "Build a full online station with live and automated programming, public listening, a growing music database and operational tools in one place.",
    features: ["Live & AutoDJ", "Public web player", "Music database ready"],
    icon: "broadcast",
  },
];

const services = [
  ["High-quality sound", "Professional audio delivery up to 320 kbps for a clear, reliable listening experience."],
  ["Smart scheduling", "Plan music, programmes, announcements and campaigns by day, time, location or audience."],
  ["Continuous AutoDJ", "Keep every channel moving with synchronized playout, smooth transitions and resilient recovery."],
  ["Central control", "Manage players, locations, schools, stations and simultaneous streams from one secure workspace."],
  ["Music & media", "Organise approved music, programmes, jingles and promotional audio in a protected media library."],
  ["Reporting & insight", "Understand activity with listener, player, campaign and proof-of-play reporting."],
  ["Safe collaboration", "Use role-based access, approvals and audit trails designed for teams and supervised environments."],
  ["Room to grow", "Start with one location or station, then add streams, schools, signage and campaigns as you expand."],
];

const pricingFamilies = [
  {
    id: "retail",
    eyebrow: "In-house & Retail Radio",
    title: "Build the right atmosphere in every location.",
    text: "Professional music, messages and reporting for independent shops, growing businesses and multi-site brands.",
    tiers: [
      {
        slug: "retail-start",
        name: "Retail Start",
        price: "9.99",
        description: "For one independent shop or customer-facing space.",
        features: ["1 active location", "10 GB media storage", "Audio up to 192 kbps", "Scheduling and AutoDJ", "Web player and device enrolment"],
      },
      {
        slug: "retail-business",
        name: "Retail Business",
        price: "29",
        description: "For a growing business operating several locations.",
        featured: true,
        features: ["Up to 3 active locations", "50 GB media storage", "Audio up to 256 kbps", "Branded promos and announcements", "Proof of play and reporting"],
      },
      {
        slug: "retail-network",
        name: "Retail Network",
        price: "69",
        description: "For established brands that need central control.",
        features: ["Up to 10 active locations", "200 GB media storage", "High-quality 320 kbps audio", "Advanced analytics and campaigns", "Retail media and signage tools"],
      },
    ],
  },
  {
    id: "school",
    eyebrow: "School Radio",
    title: "Give every school a safe, creative voice.",
    text: "Purpose-built tools for supervised production, protected publishing and confident school-wide broadcasting.",
    tiers: [
      {
        slug: "school-starter",
        name: "School Starter",
        price: "19",
        description: "For one school beginning its radio journey.",
        features: ["1 School Radio workspace", "25 GB protected media", "Supervised student production", "Review and approval workflows", "Scheduled school broadcasts"],
      },
      {
        slug: "school-pro",
        name: "School Pro",
        price: "49",
        description: "For an active school with a growing programme.",
        featured: true,
        features: ["Everything in School Starter", "100 GB protected media", "Live supervised sessions", "Podcast and episode production", "Digital noticeboards and analytics"],
      },
      {
        slug: "school-academy",
        name: "School Academy",
        price: "129",
        description: "For academies and groups managing several schools.",
        features: ["Up to 10 school workspaces", "Multi-school administration", "Verified episode exchange", "Central safeguarding oversight", "Priority onboarding and support"],
      },
    ],
  },
  {
    id: "online",
    eyebrow: "Complete Online Radio",
    title: "Launch a station built to reach listeners everywhere.",
    text: "Live and automated broadcasting, public listening and professional station operations in one complete platform.",
    tiers: [
      {
        slug: "online-start",
        name: "Online Start",
        price: "14.99",
        description: "For a new online station building its audience.",
        features: ["1 public radio channel", "Up to 100 simultaneous listeners", "25 GB media storage", "Audio up to 192 kbps", "AutoDJ and public web player"],
      },
      {
        slug: "online-pro",
        name: "Online Pro",
        price: "49",
        description: "For an established station ready to grow.",
        featured: true,
        features: ["Up to 3 public channels", "Up to 1,000 simultaneous listeners", "200 GB media storage", "High-quality 320 kbps audio", "Live shows, AutoDJ and analytics"],
      },
      {
        slug: "online-network",
        name: "Online Network",
        price: "119",
        description: "For ambitious broadcasters running a network.",
        features: ["Up to 10 public channels", "Up to 5,000 simultaneous listeners", "500 GB media storage", "Advanced scheduling and operations", "Priority support and growth planning"],
      },
    ],
  },
];

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

export default function HomePage() {
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
            <a href="#platforms">Platforms</a>
            <a href="#services">Services</a>
            <a href="#pricing">Pricing</a>
            <a href="#story">Our story</a>
          </nav>

          <div className={styles.navActions}>
            <a className={styles.loginLink} href="/login">Log in</a>
            <a className={styles.navCta} href="/register">Sign up <ArrowIcon /></a>
          </div>
        </div>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid} id="main-content">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> Audio platforms by 21-Three</p>
            <h1>Every space deserves its <em>own sound.</em></h1>
            <p className={styles.heroLead}>
              Ruvanas brings professional radio within reach—from in-house and retail audio to School Radio and complete online broadcasting.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="/register">Create your account <ArrowIcon /></a>
              <a className={styles.secondaryButton} href="#platforms">Explore the platforms</a>
            </div>
            <div className={styles.heroProof} aria-label="Ruvanas platform highlights">
              <div><strong>320</strong><span>kbps high-quality audio</span></div>
              <div><strong>24/7</strong><span>automated playout</span></div>
              <div><strong>1–30+</strong><span>simultaneous streams</span></div>
            </div>
          </div>

          <div className={styles.heroVisual} aria-label="Illustration of the Ruvanas live audio network">
            <div className={styles.livePanel}>
              <div className={styles.panelTop}>
                <div>
                  <span className={styles.liveBadge}><i /> Live network</span>
                  <p>Ruvanas master channel</p>
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
                <button type="button" aria-label="Playing live audio preview" disabled>
                  <span /><span /><span />
                </button>
              </div>
              <div className={styles.waveform} aria-hidden="true">
                {waveform.map((height, index) => <span key={index} style={{ "--bar-height": `${height}%` }} />)}
              </div>
              <div className={styles.networkLine}>
                <span>Live</span><i /><span>Synced</span><i /><span>Protected</span>
              </div>
            </div>

            <div className={`${styles.floatingCard} ${styles.cardRetail}`}>
              <PlatformIcon type="retail" /><span><strong>Retail</strong>12 locations online</span>
            </div>
            <div className={`${styles.floatingCard} ${styles.cardSchool}`}>
              <PlatformIcon type="school" /><span><strong>School</strong>Safeguarded publishing</span>
            </div>
            <div className={`${styles.floatingCard} ${styles.cardOnline}`}>
              <PlatformIcon type="broadcast" /><span><strong>Online</strong>Listeners connected</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.introStrip} aria-label="Ruvanas introduction">
        <p>One professional foundation.</p>
        <div><span>Retail radio</span><i /><span>School Radio</span><i /><span>Online radio</span></div>
      </section>

      <section className={styles.section} id="platforms">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Three platforms. One standard.</p>
            <h2>Built around the way you broadcast.</h2>
          </div>
          <p>Choose the platform that fits today, then bring every channel, location and audience together as your ambitions grow.</p>
        </div>

        <div className={styles.platformGrid}>
          {platforms.map((platform) => (
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
          <p>From the first uploaded track to a multi-location live network, the platform keeps creative and operational work together.</p>
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
          <p className={styles.sectionEyebrow}>Plans shaped around your platform</p>
          <h2>Choose the service you need. Grow when you are ready.</h2>
          <p>Retail, School Radio and complete online broadcasting each have their own tiers, limits and specialist tools.</p>
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
                  <article className={`${styles.priceCard} ${tier.featured ? styles.featuredTier : ""}`} key={tier.name}>
                    {tier.featured ? <span className={styles.popularLabel}>Most popular</span> : null}
                    <h4>{tier.name}</h4>
                    <p className={styles.tierDescription}>{tier.description}</p>
                    <div className={styles.price}>
                      <span>€</span><strong>{tier.price}</strong><small>/ month</small>
                    </div>
                    <a className={tier.featured ? styles.priceCtaFeatured : styles.priceCta} href={`/register?platform=${family.id}&tier=${tier.slug}`}>
                      Choose {tier.name} <ArrowIcon />
                    </a>
                    <ul>
                      {tier.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.enterprisePlan}>
          <div><p>Enterprise</p><h3>Need a larger or specially configured service?</h3></div>
          <p>We can tailor streams, listeners, schools, storage, identity, governance, onboarding and support around your organisation.</p>
          <a href="/register?platform=enterprise">Talk to Ruvanas <ArrowIcon /></a>
        </div>
        <p className={styles.pricingNote}>Prices are shown in euro and exclude applicable tax. Music licensing, production, media, unusually high delivery volumes and bespoke services may be agreed separately. Final eligibility and service configuration are confirmed during onboarding.</p>
      </section>

      <section className={styles.storySection} id="story">
        <div className={styles.storyLabel}><span>Our story</span><i /></div>
        <div className={styles.storyContent}>
          <p className={styles.storyKicker}>Ruvanas · A 21-Three platform</p>
          <h2>The Ruvanas story is still being written.</h2>
          <p>This space is reserved for the people, purpose and ideas behind Ruvanas. We will share how the platform began, what drives the team and the worldwide future we are working toward.</p>
          <div className={styles.placeholderNote}><span>Story placeholder</span>Full company story and timeline to be added.</div>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <p className={styles.sectionEyebrow}>Ready when you are</p>
          <h2>Give your audience a sound worth remembering.</h2>
        </div>
        <div className={styles.finalActions}>
          <a className={styles.primaryButton} href="/register">Sign up to Ruvanas <ArrowIcon /></a>
          <a className={styles.finalLogin} href="/login">Already a member? Log in</a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <a className={styles.logo} href="#top" aria-label="Ruvanas home">
            <BrandMark /><span className={styles.logoText}>RUVANAS</span>
          </a>
          <p>Professional radio platforms for brands, schools and online broadcasters.</p>
          <nav aria-label="Footer navigation">
            <a href="#platforms">Platforms</a><a href="#services">Services</a><a href="#pricing">Pricing</a><a href="/login">Log in</a>
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
