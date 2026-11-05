export type LinkOut = { name: string; url: string };

/** Search pages on the boards we deliberately do not scrape, prefilled with the user's keywords and Canada. */
export function linkOuts(query: string): LinkOut[] {
  const q = encodeURIComponent(query.trim() || "new grad software engineer");
  return [
    { name: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=Canada&f_TPR=r86400&sortBy=DD` },
    { name: "Indeed", url: `https://ca.indeed.com/jobs?q=${q}&l=Canada&fromage=1&sort=date` },
    { name: "Glassdoor", url: `https://www.glassdoor.ca/Job/jobs.htm?sc.keyword=${q}&locKeyword=Canada&fromAge=1` },
    { name: "Wellfound", url: `https://wellfound.com/role/l/software-engineer/canada` },
    { name: "Job Bank", url: `https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${q}&locationstring=Canada&sort=D` },
  ];
}

export type BoardGroup = { group: string; links: LinkOut[] };

/**
 * Boards and lists the pipeline does not read: they block scripts, ask scrapers to buy an API (Getro boards),
 * forbid feeding their listings to aggregators (zapplyjobs), or list only internships, which this feed drops.
 */
export const MORE_BOARDS: BoardGroup[] = [
  {
    group: "Canada",
    links: [
      { name: "Work in Tech (Communitech)", url: "https://www1.communitech.ca/jobs" },
      { name: "Golden Ventures", url: "https://jobs.golden.ventures/jobs" },
      { name: "Real Ventures", url: "https://jobs.realventures.com/" },
      { name: "Venture for Canada", url: "https://ventureforcanada.ca/" },
      { name: "Simplify Canada new grad", url: "https://simplify.jobs/l/New-Grad-Jobs-Canada" },
      { name: "Hanzili board", url: "https://jobs.hanzilla.co/" },
    ],
  },
  {
    group: "VC portfolio boards",
    links: [
      { name: "Accel", url: "https://jobs.accel.com/" },
      { name: "a16z", url: "https://jobs.a16z.com/" },
      { name: "Sequoia", url: "https://jobs.sequoiacap.com/jobs" },
      { name: "General Catalyst", url: "https://jobs.generalcatalyst.com/" },
    ],
  },
  {
    group: "Early-career boards",
    links: [
      { name: "Work at a Startup (YC)", url: "https://www.workatastartup.com/" },
      { name: "hiring.cafe", url: "https://hiringcafe.com/" },
      { name: "Levels.fyi", url: "https://www.levels.fyi/jobs" },
      { name: "newgrad-jobs.com", url: "https://www.newgrad-jobs.com/" },
      { name: "Jobright", url: "https://jobright.ai/" },
      { name: "RippleMatch", url: "https://ripplematch.com/" },
      { name: "Handshake", url: "https://joinhandshake.com/" },
    ],
  },
  {
    group: "GitHub lists not read here",
    links: [
      { name: "zapply new-grad SWE 2027", url: "https://github.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2027" },
      { name: "zapply new-grad 2027", url: "https://github.com/zapplyjobs/New-Grad-Jobs-2027" },
      { name: "DereC4 internships + new grad", url: "https://github.com/DereC4/internships-and-newgrad" },
    ],
  },
  {
    group: "Canadian internships (signals who is hiring)",
    links: [
      { name: "hanzili internships", url: "https://github.com/hanzili/canada_sde_intern_position" },
      { name: "Canadian Tech Internships 2027", url: "https://github.com/negarprh/Canadian-Tech-Internships-2027" },
      { name: "zapply Canada internships", url: "https://github.com/zapplyjobs/Canada-Internships-2027" },
    ],
  },
];
