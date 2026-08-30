/**
 * Placeholder data — recruiter context.
 * All names, companies, and details are fictional.
 */

export const needsActionItems = [
  { id: 1, type: "follow-up", label: "Follow up with Marcus Chen", detail: "Last contact 5 days ago — Marketing Director search", priority: "high" },
  { id: 2, type: "missing", label: "Missing resume — Priya Sharma", detail: "Screening call completed, awaiting updated resume", priority: "high" },
  { id: 3, type: "stalled", label: "Stalled submission — David Park", detail: "Presentation ready, pending your review", priority: "medium" },
  { id: 4, type: "draft", label: "Draft intro email to review", detail: "Introduction to Nexus Health hiring manager", priority: "low" },
];

export const todaySchedule = [
  { id: 1, time: "9:00 AM", type: "call", label: "Screening call — Alex Rivera", detail: "Operations Manager, Meridian Consulting" },
  { id: 2, time: "11:30 AM", type: "interview", label: "Client interview — Sarah Kim", detail: "VP of Marketing, Cascade Partners" },
  { id: 3, time: "2:00 PM", type: "task", label: "Submit branded profile — James Wu", detail: "Finance Director, Pinnacle Advisory" },
  { id: 4, time: "4:00 PM", type: "call", label: "Check-in call — Maria Santos", detail: "Creative Director, BrightPath Agency" },
];

export const priorityJobs = [
  { id: 1, title: "Marketing Director", company: "Meridian Consulting", urgency: "critical", candidates: 2, daysOpen: 12 },
  { id: 2, title: "VP of Marketing", company: "Cascade Partners", urgency: "high", candidates: 4, daysOpen: 8 },
  { id: 3, title: "Finance Director", company: "Pinnacle Advisory", urgency: "medium", candidates: 1, daysOpen: 22 },
];

export const hiringNowCompanies = [
  { id: 1, name: "Meridian Consulting", signal: "Active hiring — 3 open searches", sector: "Management Consulting" },
  { id: 2, name: "BrightPath Agency", signal: "New funding round — expanding leadership", sector: "Creative & Digital" },
  { id: 3, name: "Nexus Health Systems", signal: "Leadership change — rebuilding C-suite", sector: "Healthcare" },
];

export const sampleCandidate = {
  id: 1,
  name: "Marcus Chen",
  title: "Marketing Director",
  location: "San Francisco, CA",
  email: "marcus.chen@email.com",
  phone: "(415) 555-0142",
  status: "Active",
  relatedJob: { title: "Marketing Director", company: "Meridian Consulting" },
  recentMessages: [
    { date: "Aug 25", preview: "Thanks for the update on the search..." },
    { date: "Aug 22", preview: "I'm available for a call Thursday..." },
  ],
  notes: "15 years in brand strategy. Led team of 40 at previous firm. Prefers hybrid, open to relocation for the right role. Targeting $185–210k base.",
  nextAction: "Follow up on interview availability",
  history: [
    { date: "Aug 25", action: "Email sent — search update" },
    { date: "Aug 22", action: "Screening call completed" },
    { date: "Aug 20", action: "Resume received" },
    { date: "Aug 18", action: "Initial outreach via LinkedIn" },
  ],
};

export const mailMessages = [
  { id: 1, from: "Sarah Kim", subject: "Re: VP of Marketing — Cascade Partners", preview: "Thanks for sending over the position brief. I've reviewed it and...", time: "10:42 AM", unread: true },
  { id: 2, from: "David Park", subject: "Updated resume attached", preview: "Hi Ja, please find my updated resume with the latest role...", time: "9:15 AM", unread: true },
  { id: 3, from: "Maria Santos", subject: "Re: Creative Director opportunity", preview: "I'm very interested in the BrightPath role. My availability for...", time: "Yesterday", unread: false },
  { id: 4, from: "Alex Rivera", subject: "Confirming call tomorrow", preview: "Just confirming our call at 9 AM tomorrow. Looking forward to...", time: "Yesterday", unread: false },
  { id: 5, from: "James Wu", subject: "Re: Finance Director — Pinnacle Advisory", preview: "I've reviewed the position details. Happy to discuss the...", time: "Aug 27", unread: false },
];
