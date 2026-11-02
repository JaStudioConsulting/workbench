// Sample fixture records for Candidate Review
// AGENTS.md compliance: zero real candidate records, personal data, or real client IDs.
// Uses strictly synthetic job and person IDs, 555 reserved phones, and example.invalid emails.

export const SAMPLE_JOBS = [
  {
    id: "DEMO-JOB-ROBOTICS",
    title: "Robotics Programmer",
    company: "Tier 1 Automotive Systems (Confidential)",
    location: "Kitchener, ON",
    status: "Active",
  },
  {
    id: "DEMO-JOB-LOGISTICS",
    title: "Logistics Coordinator",
    company: "Pinnacle Freight Network",
    location: "Brampton, ON",
    status: "Active",
  },
  {
    id: "DEMO-JOB-MILLWRIGHT",
    title: "Millwright",
    company: "Grand River Steel Works",
    location: "Cambridge, ON",
    status: "Active",
  },
];

export const SAMPLE_CANDIDATES = [
  {
    id: "DEMO-PERSON-001",
    candidateId: "DEMO-CAND-001",
    jobId: "DEMO-JOB-ROBOTICS",
    initials: "AR",
    name: "Alex Rivera",
    title: "Robotics and Automation Technician",
    employer: "Acme Automated Assembly",
    location: "Kitchener, ON",
    email: "alex.rivera@example.invalid",
    phone: "+1 555 0101",
    stage: "Outbound",
    resumeStatus: "resume_on_file",
    fullResumeText: `ALEX RIVERA
Kitchener, ON | +1 555 0101 | alex.rivera@example.invalid

PROFESSIONAL SUMMARY
Robotics and Automation Technician with 6+ years in high volume automotive parts manufacturing. Proven background in Fanuc robot path optimization, GMAW and resistance weld cell troubleshooting, and cycle time reductions.

WORK EXPERIENCE
Robotics and Automation Technician
Acme Automated Assembly | Jan 2024 to Present | Kitchener, ON
- Programmed and maintained 14 Fanuc robotic weld cells across two chassis assembly lines
- Reduced line cycle time by 8.4 seconds per frame through motion trajectory optimization
- Performed daily weld quality audits meeting AWS D1.1 specifications for high tensile automotive steel

Production Team Lead
Acme Automated Assembly | Jun 2021 to Dec 2023 | Kitchener, ON
- Led crew of 12 operators and 2 technicians operating automated resistance and robotic GMAW cells
- Achieved 99.2 percent on time completion for Tier 1 subassemblies
- Coordinated preventative maintenance schedules with production planning

Lean Manufacturing Project Specialist
Continental Tool and Die | Jan 2019 to May 2019 | Windsor, ON
- Coordinated SMED tooling changeover project saving 45 minutes on 500 ton stamping and weld lines
- Standardized fixture clamping procedures for 8 press brake cells

Equipment Maintenance Engineer
Global Industrial Machinery | Jun 2017 to Jul 2018 | Chennai, India
- Preventative maintenance on heavy material handling cranes, hydraulic presses, and conveyor loops
- Diagnosed PLC input output faults and overhauled pneumatic actuator banks

EDUCATION
Diploma in Mechanical Engineering Technology, Conestoga College, 2019`,
    workHistory: [
      {
        id: "job-1",
        title: "Robotics and Automation Technician",
        company: "Acme Automated Assembly",
        location: "Kitchener, ON",
        startDate: "Jan 2024",
        endDate: "Present",
        bullets: [
          "Programmed and maintained 14 Fanuc robotic weld cells across two chassis assembly lines",
          "Reduced line cycle time by 8.4 seconds per frame through motion trajectory optimization",
          "Performed daily weld quality audits meeting AWS D1.1 specifications for high tensile automotive steel",
        ],
      },
      {
        id: "job-2",
        title: "Production Team Lead",
        company: "Acme Automated Assembly",
        location: "Kitchener, ON",
        startDate: "Jun 2021",
        endDate: "Dec 2023",
        bullets: [
          "Led crew of 12 operators and 2 technicians operating automated resistance and robotic GMAW cells",
          "Achieved 99.2 percent on time completion for Tier 1 subassemblies",
          "Coordinated preventative maintenance schedules with production planning",
        ],
      },
      {
        id: "job-3",
        title: "Lean Manufacturing Project Specialist",
        company: "Continental Tool and Die",
        location: "Windsor, ON",
        startDate: "Jan 2019",
        endDate: "May 2019",
        bullets: [
          "Coordinated SMED tooling changeover project saving 45 minutes on 500 ton stamping and weld lines",
          "Standardized fixture clamping procedures for 8 press brake cells",
        ],
      },
      {
        id: "job-4",
        title: "Equipment Maintenance Engineer",
        company: "Global Industrial Machinery",
        location: "Chennai, India",
        startDate: "Jun 2017",
        endDate: "Jul 2018",
        bullets: [
          "Preventative maintenance on heavy material handling cranes, hydraulic presses, and conveyor loops",
          "Diagnosed PLC input output faults and overhauled pneumatic actuator banks",
        ],
      },
    ],
    education: "Diploma in Mechanical Engineering Technology, Conestoga College, 2019",
    activityTrail: [
      {
        id: "act-1",
        type: "Phone Call",
        actor: "Ja Maralit",
        isJa: true,
        actorUnknown: false,
        date: "Oct 28, 2026",
        note: "Left voicemail and sent follow up note regarding Robotics Programmer opening.",
      },
      {
        id: "act-2",
        type: "Sent InMail",
        actor: "Sarah Connor",
        isJa: false,
        actorUnknown: false,
        date: "Oct 25, 2026",
        note: "Reached out via LinkedIn InMail for Cambridge stamping plant role.",
      },
      {
        id: "act-3",
        type: "AI Marked Yes",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Oct 24, 2026",
        note: "Veton resume screen, Good Fit for Robotics Programmer",
      },
      {
        id: "act-4",
        type: "Applied",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Oct 24, 2026",
        note: "Direct application via careers page for Robotics Programmer",
      },
    ],
    alsoFits: [
      {
        id: "fit-1",
        jobTitle: "Welder, Fitter and Installer",
        company: "Keystone Metal Fabrication",
        location: "Waterloo, ON",
        trackerRow: {
          sheet: "Tracker Sheet",
          rowNumber: 42,
          dateAdded: "2026-10-15",
          addedBy: "Ja Maralit",
          notes: "Weld-cell and fitter background, 20 min from Kitchener",
        },
        matchingResumeLines: [
          "Programmed and maintained 14 Fanuc robotic weld cells across two chassis assembly lines",
          "Performed daily weld quality audits meeting AWS D1.1 specifications for high tensile automotive steel",
        ],
      },
      {
        id: "fit-2",
        jobTitle: "Millwright",
        company: "Grand River Steel Works",
        location: "Cambridge, ON",
        trackerRow: {
          sheet: "Tracker Sheet",
          rowNumber: 58,
          dateAdded: "2026-10-18",
          addedBy: "Ja Maralit",
          notes: "Automation and maintenance background, local to Cambridge",
        },
        matchingResumeLines: [
          "Preventative maintenance on heavy material handling cranes, hydraulic presses, and conveyor loops",
          "Coordinated SMED tooling changeover project saving 45 minutes on 500 ton stamping and weld lines",
        ],
      },
    ],
  },
  {
    id: "DEMO-PERSON-002",
    candidateId: "DEMO-CAND-002",
    jobId: "DEMO-JOB-ROBOTICS",
    initials: "JL",
    name: "Jordan Lee",
    title: "Automation Specialist",
    employer: "Summit Precision Machining",
    location: "Guelph, ON",
    email: "jordan.lee@example.invalid",
    phone: "+1 555 0102",
    stage: "Screening",
    resumeStatus: "profile_only",
    fullResumeText: `JORDAN LEE
Guelph, ON | +1 555 0102 | jordan.lee@example.invalid

WORK EXPERIENCE
Senior Robotics Programmer
Summit Precision Machining | Mar 2022 to Present | Guelph, ON
- Integrated 8 ABB and Fanuc articulated arms for powertrain machining cells
- Authored safety PLC logic and interlocks for cell perimeter safety light curtains
- Led commissioning for dual robot deburring and machine tending cells

Controls and Robotics Specialist
Horizon Powertrain Systems | Aug 2018 to Feb 2022 | Guelph, ON
- Commissioned robotic weld cells and vision inspection systems across 3 facilities
- Trained 15 production technicians on robot recovery and weld torch alignment

EDUCATION
B.Tech in Automation and Robotics, McMaster University, 2018`,
    workHistory: [
      {
        id: "jl-1",
        title: "Senior Robotics Programmer",
        company: "Summit Precision Machining",
        location: "Guelph, ON",
        startDate: "Mar 2022",
        endDate: "Present",
        bullets: [
          "Integrated 8 ABB and Fanuc articulated arms for powertrain machining cells",
          "Authored safety PLC logic and interlocks for cell perimeter safety light curtains",
          "Led commissioning for dual robot deburring and machine tending cells",
        ],
      },
      {
        id: "jl-2",
        title: "Controls and Robotics Specialist",
        company: "Horizon Powertrain Systems",
        location: "Guelph, ON",
        startDate: "Aug 2018",
        endDate: "Feb 2022",
        bullets: [
          "Commissioned robotic weld cells and vision inspection systems across 3 facilities",
          "Trained 15 production technicians on robot recovery and weld torch alignment",
        ],
      },
    ],
    education: "B.Tech in Automation and Robotics, McMaster University, 2018",
    activityTrail: [
      {
        id: "act-jl-1",
        type: "Candidate Intake - Recruiter Screening/Interview",
        actor: "Ja Maralit",
        isJa: true,
        actorUnknown: false,
        date: "Oct 29, 2026",
        note: "Completed 20 min screening. Strong technical fit, comp expectation aligns at 46/hr.",
      },
      {
        id: "act-jl-2",
        type: "Responded",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Oct 28, 2026",
        note: "Candidate replied to intake request with availability.",
      },
      {
        id: "act-jl-3",
        type: "Phone Call",
        actor: "Ja Maralit",
        isJa: true,
        actorUnknown: false,
        date: "Oct 27, 2026",
        note: "Initial phone connect, scheduled screening call.",
      },
    ],
    alsoFits: [],
  },
  {
    id: "DEMO-PERSON-003",
    candidateId: "DEMO-CAND-003",
    jobId: "DEMO-JOB-ROBOTICS",
    initials: "TM",
    name: "Taylor Morgan",
    title: "Robotics Field Technician",
    employer: "Nexus Robotics Systems",
    location: "Woodstock, ON",
    email: "taylor.morgan@example.invalid",
    phone: "+1 555 0103",
    stage: "Applied",
    resumeStatus: "no_resume_data",
    fullResumeText: "No resume document or profile work history on record in source profile.",
    workHistory: [],
    education: "Trade Certificate in Industrial Automation",
    activityTrail: [
      {
        id: "act-tm-1",
        type: "Applied",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Nov 01, 2026",
        note: "Applied on Loxo job board. Incomplete profile.",
      },
    ],
    alsoFits: [],
  },
  {
    id: "DEMO-PERSON-004",
    candidateId: "DEMO-CAND-004",
    jobId: "DEMO-JOB-LOGISTICS",
    initials: "CV",
    name: "Casey Vance",
    title: "Logistics Coordinator",
    employer: "Pinnacle Freight Network",
    location: "Brampton, ON",
    email: "casey.vance@example.invalid",
    phone: "+1 555 0104",
    stage: "Outbound",
    resumeStatus: "resume_on_file",
    fullResumeText: `CASEY VANCE
Brampton, ON | +1 555 0104 | casey.vance@example.invalid

SUMMARY
6+ years logistics coordination in refrigerated freight and 3PL transportation across Ontario.

WORK EXPERIENCE
Logistics Coordinator
Pinnacle Freight Network | Dec 2023 to Present | Brampton, ON
- Dispatched and routed 35 refrigerated freight loads daily across Ontario and Quebec
- Maintained carrier compliance and negotiated spot rates in MercuryGate TMS
- Reduced demurrage charges by 18 percent through appointment scheduling improvements

Freight Coordinator
TransGlobal Freight Solutions | Jan 2021 to Aug 2023 | Mississauga, ON
- Handled cross border customs clearance and PARS paperwork for refrigerated grocery accounts
- Coordinated with 20 partner trucking carriers on temperature sensitive line hauls

EDUCATION
Diploma in Supply Chain and Logistics, Humber College, 2020`,
    workHistory: [
      {
        id: "cv-1",
        title: "Logistics Coordinator",
        company: "Pinnacle Freight Network",
        location: "Brampton, ON",
        startDate: "Dec 2023",
        endDate: "Present",
        bullets: [
          "Dispatched and routed 35 refrigerated freight loads daily across Ontario and Quebec",
          "Maintained carrier compliance and negotiated spot rates in MercuryGate TMS",
          "Reduced demurrage charges by 18 percent through appointment scheduling improvements",
        ],
      },
      {
        id: "cv-2",
        title: "Freight Coordinator",
        company: "TransGlobal Freight Solutions",
        location: "Mississauga, ON",
        startDate: "Jan 2021",
        endDate: "Aug 2023",
        bullets: [
          "Handled cross border customs clearance and PARS paperwork for refrigerated grocery accounts",
          "Coordinated with 20 partner trucking carriers on temperature sensitive line hauls",
        ],
      },
    ],
    education: "Diploma in Supply Chain and Logistics, Humber College, 2020",
    activityTrail: [
      {
        id: "act-cv-1",
        type: "Sent InMail",
        actor: "Elena Rostova",
        isJa: false,
        actorUnknown: false,
        date: "Oct 26, 2026",
        note: "InMail sent for Mississauga freight coordinator role.",
      },
      {
        id: "act-cv-2",
        type: "AI Marked Yes",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Oct 25, 2026",
        note: "Veton screen Good Fit for Logistics Coordinator",
      },
      {
        id: "act-cv-3",
        type: "Applied",
        actor: null,
        isJa: false,
        actorUnknown: true,
        date: "Oct 25, 2026",
        note: "Applicant submitted profile via job portal",
      },
    ],
    alsoFits: [],
  },
  {
    id: "DEMO-PERSON-005",
    candidateId: "DEMO-CAND-005",
    jobId: "DEMO-JOB-LOGISTICS",
    initials: "DB",
    name: "Devon Brooks",
    title: "Logistics Specialist",
    employer: "Apex Cargo Logistics",
    location: "Mississauga, ON",
    email: "devon.brooks@example.invalid",
    phone: "+1 555 0105",
    stage: "Submitted",
    resumeStatus: "resume_on_file",
    fullResumeText: `DEVON BROOKS
Mississauga, ON | +1 555 0105 | devon.brooks@example.invalid

WORK EXPERIENCE
Logistics Specialist
Apex Cargo Logistics | Sep 2022 to Present | Mississauga, ON
- Coordinated 40 daily linehaul dispatches across Eastern Canada
- Audited freight bills and carrier BOL documents

EDUCATION
Certificate in Transportation Logistics, Sheridan College, 2021`,
    workHistory: [
      {
        id: "db-1",
        title: "Logistics Specialist",
        company: "Apex Cargo Logistics",
        location: "Mississauga, ON",
        startDate: "Sep 2022",
        endDate: "Present",
        bullets: [
          "Coordinated 40 daily linehaul dispatches across Eastern Canada",
          "Audited freight bills and carrier BOL documents",
        ],
      },
    ],
    education: "Certificate in Transportation Logistics, Sheridan College, 2021",
    activityTrail: [
      {
        id: "act-db-1",
        type: "Marked as Yes",
        actor: "Ja Maralit",
        isJa: true,
        actorUnknown: false,
        date: "Oct 30, 2026",
        note: "Screened profile, solid candidate for 3PL dispatch",
      },
    ],
    submissionHistory: [
      {
        id: "demo-submission-005",
        submittedAt: "2026-10-31T14:00:00.000Z",
        client: "Pinnacle Freight Network",
        location: "Brampton, ON",
        note: "Synthetic imported submission history for interface testing.",
      },
    ],
    alsoFits: [],
  },
];
