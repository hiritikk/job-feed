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
