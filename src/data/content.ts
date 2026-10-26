// ============================================================================
// ALL SITE CONTENT LIVES HERE. Edit this file to make the portfolio yours.
// The page, the 3D world (labels, bodies, project ring), the loader, the
// command palette, the "Ask my agent" console, index.html, sitemap.xml and
// robots.txt all read from it. You should not need to touch any other file
// to change text.
//
// The demo person below (Rahel Tesfaye) is fictional, and so are every
// institute, company, university, project and paper named here.
// ============================================================================

/** Site-wide settings: SEO, social cards, resume, footer. */
export const site = {
  /** public URL with trailing slash; used for canonical, OG tags, sitemap and robots */
  url: "https://example.com/",
  /** browser tab and social card title */
  title: "Rahel Tesfaye · Research Data Scientist",
  /** meta description and social card text */
  description:
    "Rahel Tesfaye is a research data scientist in Zurich working on gravitational-wave signal processing, anomaly detection in detector data and simulation-based inference.",
  /** html lang attribute and og:locale */
  lang: "en",
  locale: "en_GB",
  /** the resume file in public/, and the file name visitors download it as */
  resume: "/Resume.pdf",
  resumeName: "Rahel_Tesfaye_Resume.pdf",
  /** social card image in public/ (1200x630) and its alt text */
  ogImage: "/og.png",
  ogAlt: "A ray traced black hole with a golden accretion disk beside the name Rahel Tesfaye",
  /** Twitter / X handle for the social card, or "" for none */
  twitter: "",
  /** small print at the bottom of the contact view; set to "" to remove it */
  footerNote: "Sample portfolio. The person, companies and projects are fictional.",
  /** social links shown in contact and the command palette; use "#" or remove ones you do not have */
  socials: [
    { label: "LinkedIn", href: "#" },
    { label: "GitHub", href: "#" },
    { label: "Google Scholar", href: "#" },
  ],
  /** the "more work" link at the end of the project reel */
  moreWork: { text: "More notebooks, code and data releases live on GitHub.", label: "Open GitHub", href: "#" },
};

export const profile = {
  name: "Rahel Tesfaye",
  role: "Research Data Scientist",
  /** one line under the name in the hero */
  headline: "Research Data Scientist at the Limmat Institute for Wave Physics. Gravitational-wave signals, detector anomalies and fast inference.",
  location: "Zurich, Switzerland",
  /** short place name used as the label on the About body in 3D */
  city: "Zurich",
  coords: "47.37° N, 8.54° E",
  timezone: "CET, UTC+1",
  email: "rahel@example.com",
  /** used by the agent when it talks about you in the third person */
  pronouns: { subject: "she", object: "her", possessive: "her" },
  intro:
    "I build the software that decides whether a wiggle in a detector is a pair of black holes, a passing truck, or a fault in a cooling pump. Most of my days are spent on noise, so that the rare real signal gets an honest answer fast.",
  /** About section heading */
  aboutHeading: "Most of the data is noise. The work is knowing which noise.",
  about: [
    "I'm a Research Data Scientist at the Limmat Institute for Wave Physics in Zurich, where I lead the data analysis side of the low-latency search for gravitational-wave signals. I joined in 2023 after two years building anomaly detection for seismic sensor networks.",
    "My work sits between signal processing and machine learning. I spend a lot of time on detector noise: classifying glitches, tracking spectral lines, and flagging bad data before it reaches a search. When a candidate does come through, I care about getting a trustworthy posterior in seconds, not hours, which is why I work on simulation-based inference.",
    "I did my PhD in physics at Halden University of Technology on neural estimators for transient signals in non-Gaussian noise. I still like the part of the job where a plot looks wrong and nobody knows why yet.",
  ],
};

export type Experience = {
  role: string;
  org: string;
  /** short name used for the label on this orbit in the 3D scene */
  short: string;
  place: string;
  start: string;
  end: string;
  points: string[];
};

/** newest first. The first entry is treated as the current role. */
export const experience: Experience[] = [
  {
    role: "Research Data Scientist",
    org: "Limmat Institute for Wave Physics",
    short: "Limmat Institute",
    place: "Zurich",
    start: "Mar 2023",
    end: "Present",
    points: [
      "Lead data analysis for the institute's low-latency gravitational-wave search, from whitened strain to a published sky map.",
      "Built Chirpline, the four-stage pipeline that now runs during every observing period, with a median of 38 seconds from data to posterior.",
      "Designed the glitch taxonomy detector teams use to trace noise to its source, cutting false triggers in the main search by 41%. Supervise two doctoral students.",
    ],
  },
  {
    role: "Data Scientist",
    org: "Kestrel Seismic Analytics",
    short: "Kestrel Seismic",
    place: "Zurich",
    start: "Jan 2021",
    end: "Feb 2023",
    points: [
      "Built anomaly detection for a network of 600 seismic stations, separating real ground motion from sensor faults and traffic.",
      "Shipped an earthquake early warning model with a median alert lead time of 4.8 seconds on held-out events.",
      "Moved the team's models from nightly batch jobs to a streaming service with monitoring and automatic rollback.",
    ],
  },
  {
    role: "Doctoral Researcher, Physics",
    org: "Halden University of Technology",
    short: "Halden Tech",
    place: "Halden",
    start: "Sep 2016",
    end: "Dec 2020",
    points: [
      "Thesis on neural estimators for short transient signals in non-Gaussian detector noise.",
      "Wrote the first version of the group's open-source glitch simulator, still used in teaching.",
    ],
  },
];

export const education = [
  { degree: "PhD, Physics", school: "Halden University of Technology", year: "2020" },
  { degree: "MSc, Applied Mathematics", school: "Halden University of Technology", year: "2016" },
];

/**
 * Project categories. Each one gets a colour, used for its card accent, its
 * legend dot and its body in the accretion disk. Add, rename or remove freely;
 * every project's `category` must match one of these names.
 */
export const categories = [
  { name: "Signal processing", color: "#cfe0ff" },
  { name: "Anomaly detection", color: "#ffc062" },
  { name: "Inference", color: "#9fe3cf" },
  { name: "Tooling", color: "#ee9466" },
] as const;
export type Category = (typeof categories)[number]["name"];

export type Project = {
  title: string;
  summary: string;
  detail: string;
  category: Category;
  stack: string[];
  /** one headline number shown large on the card */
  metric?: { value: string; label: string };
  year: string;
  links?: { label: string; href: string }[];
  /** small label on the card, e.g. "Published" */
  badge?: string;
  /** shows the badge in gold, for an award */
  award?: boolean;
};

/**
 * The flagship system. Its `parts` become the four bright bodies that orbit
 * together in the 3D scene (four reads best; two to six work), and the
 * selectable list beside the description.
 */
export const featured = {
  title: "Chirpline",
  tagline: "From raw detector strain to a sky map in under a minute.",
  description:
    "Chirpline is the low-latency pipeline I designed for the institute's gravitational-wave search. Four stages hand data to each other in a loop: one cleans and whitens the strain, one finds candidate signals, one checks them against known noise, and one estimates where in the sky and what kind of source they came from. Each stage can be replayed on archived data, so every change is tested against two years of real noise before it goes live.",
  facts: [
    "Median 38 seconds from data to posterior",
    "Replays two years of archived data as a nightly regression test",
    "Runs on a 12 GPU cluster during observing periods",
  ],
  stack: ["Python", "PyTorch", "JAX", "Kafka", "Kubernetes", "Grafana"],
  links: [{ label: "Read the design note", href: "#" }],
  parts: [
    { name: "Whiten", role: "Removes known spectral lines and whitens the strain so a faint chirp is not buried under the noise floor." },
    { name: "Trigger", role: "Runs a matched filter and a small neural trigger side by side, and passes on anything either one finds." },
    { name: "Vet", role: "Compares each candidate with the glitch taxonomy and auxiliary sensors, and rejects it if a known noise source explains it." },
    { name: "Infer", role: "A conditional normalizing flow returns a full posterior over masses, spins and sky position in about two seconds." },
  ],
};

/** 8 to 11 projects look best in the disk; 4 to 14 work. Order = reel order. */
export const projects: Project[] = [
  {
    title: "Glitchbook",
    summary: "A self-supervised map of the short noise bursts that fake gravitational-wave signals.",
    detail:
      "Contrastive embeddings of 1.2 million spectrogram snippets, clustered into 31 families that detector engineers can each trace to a cause, from mirror motion to a faulty fan. New glitch types show up as clusters that do not fit.",
    category: "Anomaly detection",
    stack: ["PyTorch", "SimCLR", "HDBSCAN", "Spectrograms"],
    metric: { value: "31", label: "glitch families" },
    year: "2024",
    badge: "Best Paper",
    award: true,
  },
  {
    title: "Flowcast",
    summary: "Amortised posteriors for compact binary signals with a conditional normalizing flow.",
    detail:
      "Trained once on 40 million simulated signals in real detector noise, then returns a posterior in seconds for any new event. Calibrated against nested sampling on 500 injections, with coverage checked for every parameter.",
    category: "Inference",
    stack: ["JAX", "Normalizing flows", "Simulation-based inference"],
    metric: { value: "2.1 s", label: "per event posterior" },
    year: "2025",
    badge: "Published",
  },
  {
    title: "Line Hunter",
    summary: "Tracks the narrow spectral lines that drift through detector data, so searches can subtract them.",
    detail:
      "A bank of Kalman filters follows mains harmonics, mirror suspension modes and calibration lines as they wander in frequency and amplitude. Lines that appear without a known source are raised to the commissioning team.",
    category: "Signal processing",
    stack: ["NumPy", "Kalman filters", "SciPy"],
    metric: { value: "180", label: "lines tracked live" },
    year: "2023",
  },
  {
    title: "Quiet Hours",
    summary: "Change-point detection on environmental sensors to flag bad stretches of data.",
    detail:
      "Watches seismometers, magnetometers and microphones around the detector and marks segments where the environment is likely to have coupled into the strain. Analysts get a ranked list instead of raw plots.",
    category: "Anomaly detection",
    stack: ["Bayesian change points", "Python", "Polars"],
    metric: { value: "0.94", label: "ROC-AUC on labelled segments" },
    year: "2024",
  },
  {
    title: "Synthetic Noise Bench",
    summary: "A diffusion model that generates realistic non-Gaussian detector noise for injection studies.",
    detail:
      "Learns the noise of a real observing period, glitches included, so search sensitivity can be measured on far more data than exists. Generated noise passes the same statistical checks as real data.",
    category: "Tooling",
    stack: ["Diffusion models", "PyTorch", "Dask"],
    metric: { value: "9 TB", label: "synthetic noise a week" },
    year: "2025",
  },
  {
    title: "Ringdown Check",
    summary: "Neural ratio estimation to test whether a merger remnant rings with more than one tone.",
    detail:
      "Compares models with and without an overtone directly from simulated data, avoiding the slow likelihood. Every result comes with a calibration run on thousands of simulated events with known answers.",
    category: "Inference",
    stack: ["Neural ratio estimation", "JAX", "Simulation"],
    metric: { value: "5,000", label: "simulations per calibration" },
    year: "2025",
  },
  {
    title: "Scatter Arches",
    summary: "A small CNN that finds scattered-light arches in spectrograms before they hit the search.",
    detail:
      "Scattered light makes slow arch-shaped bands that look nothing like a chirp but still raise the noise floor. The model flags them in near real time and links each one to ground motion at the time.",
    category: "Anomaly detection",
    stack: ["CNN", "PyTorch", "ONNX"],
    metric: { value: "92%", label: "recall at 1% false alarms" },
    year: "2023",
  },
  {
    title: "Segment Atlas",
    summary: "A web tool for browsing data quality flags, glitches and lines across a whole observing period.",
    detail:
      "Replaced a folder of static plots with one searchable timeline. Analysts can jump from a candidate to everything that was happening in the detector at that moment.",
    category: "Tooling",
    stack: ["TypeScript", "FastAPI", "DuckDB"],
    metric: { value: "40", label: "analysts each week" },
    year: "2024",
    links: [{ label: "Code", href: "#" }],
  },
  {
    title: "Tremor Watch",
    summary: "Early warning across 600 seismic stations, with sensor faults filtered out first.",
    detail:
      "An isolation forest removes faulty stations, then a small transformer reads the first seconds of the P wave across the network to estimate magnitude and issue an alert.",
    category: "Signal processing",
    stack: ["Transformers", "Isolation forest", "Kafka"],
    metric: { value: "4.8 s", label: "median alert lead time" },
    year: "2022",
  },
  {
    title: "Calibration Emulator",
    summary: "A Gaussian process emulator for detector calibration uncertainty, fast enough to sample in every analysis.",
    detail:
      "Replaces a slow physical model of the detector response with an emulator that can be drawn from millions of times, so calibration error is folded into every posterior instead of added at the end.",
    category: "Inference",
    stack: ["Gaussian processes", "GPyTorch", "NumPy"],
    metric: { value: "0.6%", label: "max amplitude error" },
    year: "2024",
    links: [{ label: "Code", href: "#" }],
  },
];

export type Publication = {
  title: string;
  /** short venue name, also the label on its pulsar in the 3D scene */
  venue: string;
  where: string;
  publisher: string;
  year: string;
  note?: string;
  /** marks an award: shown in gold, and its pulsar shines brighter */
  award?: boolean;
};

/** 0 to 6 entries. With none, the Research section and its nav entry disappear. */
export const publications: Publication[] = [
  {
    title: "Amortised Posteriors for Compact Binary Signals with Conditional Flows",
    venue: "JCAM 2025",
    where: "Journal article",
    publisher: "Journal of Computational Astrophysics Methods",
    year: "2025",
    note: "The method behind Flowcast and Chirpline's Infer stage",
  },
  {
    title: "Thirty-One Kinds of Noise: Self-Supervised Glitch Taxonomy for Interferometer Data",
    venue: "ACSPP 2024",
    where: "Alpine Conference on Signal Processing in Physics, Davos",
    publisher: "Conference proceedings",
    year: "2024",
    award: true,
    note: "Best Paper Award",
  },
  {
    title: "What the Noise Knows: Anomaly Detection for Detectors That Never Sit Still",
    venue: "Invited talk",
    where: "Zurich Data Science Colloquium",
    publisher: "Talk and slides",
    year: "2025",
  },
];

/** Research section copy */
export const research = {
  heading: "Papers and talks",
  lead: "Work on fast inference and detector noise, including a Best Paper Award at ACSPP 2024.",
};

/** Toolkit: 1 to 6 groups. The first four also orbit near the inner edge in 3D. */
export const skills: { group: string; items: string[] }[] = [
  {
    group: "Signal processing",
    items: ["Matched filtering", "Whitening", "Spectral estimation", "Kalman filters", "Wavelets", "Time-frequency analysis"],
  },
  {
    group: "Machine learning",
    items: ["PyTorch", "JAX", "Self-supervised learning", "Normalizing flows", "Diffusion models", "Anomaly detection", "Scikit-learn"],
  },
  {
    group: "Inference and statistics",
    items: ["Simulation-based inference", "Neural ratio estimation", "Nested sampling", "Gaussian processes", "Bayesian change points", "Calibration checks"],
  },
  {
    group: "Engineering",
    items: ["Python", "TypeScript", "Kafka", "Kubernetes", "Dask", "DuckDB", "Grafana", "Git"],
  },
];

export const certifications = [
  { name: "Advanced Bayesian Workflow", issuer: "Rhine Summer School of Statistics", date: "Aug 2022" },
  { name: "GPU Programming for Scientists", issuer: "Halden Computing Centre", date: "Mar 2020" },
  { name: "Research Software Engineering", issuer: "Nordic Research Software Network", date: "Jun 2019" },
];

/** Contact section copy */
export const contact = {
  heading: "Send a signal.",
  lead: "Working on noisy sensor data, fast inference, or a detector that will not sit still? I am happy to compare notes, review a pipeline, or talk about a role.",
};
