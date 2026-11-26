/** Fixtures : configuration du site pilote Navitrends.uk (ex-lib/seo/site-config, pages, faq-data). */
import type { FaqItem, PageEntry, SiteConfig } from "../../src/types";

export const navitrendsSite: SiteConfig = {
  name: "Navitrends UK",
  legalName: "Navitrends Ltd",
  url: "https://navitrends.uk",
  locale: "en_GB",
  language: "en-GB",
  tagline: "Operational Systems, Automation, Data & AI",
  description:
    "Navitrends UK helps SMEs and industrial organisations digitise operations, connect systems, automate workflows and apply AI to measurable business problems.",
  logoPath: "/logo.png",
  defaultOgImage: "/images/software-dashboard.jpg",
  googleSiteVerification: "RvX3EGFTW4dO07yXnohrAIrqfFI6SV8k_cgTLEjGn1U",
  contact: { email: "contact@navitrends.com", telephone: "+442039962137" },
  address: {
    streetAddress: "5 Brayford Square",
    addressLocality: "London",
    postalCode: "E1 0SG",
    addressCountry: "GB",
  },
  areaServed: ["United Kingdom", "Europe", "North Africa"],
  sameAs: [], // TODO: ex. "https://www.linkedin.com/company/..."
  brand: { navy: "#0B1F3A", cyan: "#22D3EE", red: "#E5484D" },
  serviceFamilies: [
    {
      name: "Operational Systems",
      tagline: "Structure and connect the operation.",
      offerings: [
        "ERP Consulting & Process Optimisation",
        "Odoo Implementation & Customisation",
        "ERPNext Implementation & Customisation",
        "Systems & API Integration",
        "Custom Business Applications",
      ],
    },
    {
      name: "Intelligent Workflows",
      tagline: "Remove repetitive work.",
      offerings: [
        "Business Process Automation",
        "Document-to-ERP Automation",
        "AI Document Processing",
        "Quotation Automation",
        "CRM & Sales Automation",
        "AI Workflow Agents",
      ],
    },
    {
      name: "Operational Knowledge",
      tagline: "Turn experience into a reusable asset.",
      offerings: [
        "Knowledge Capture",
        "AI Knowledge Assistant",
        "Decision Support",
        "Digital Twins",
        "Sales Intelligence",
      ],
    },
  ],
};

export const navitrendsPages: readonly PageEntry[] = [
  {
    path: "/",
    type: "home",
    title: "Navitrends UK",
    description: navitrendsSite.description,
    priority: 1,
    changeFrequency: "monthly",
    keywords: ["ERP consulting UK", "business process automation", "AI workflow automation"],
  },
  {
    path: "/odoo",
    type: "service",
    title: "Odoo Implementation & Customisation",
    description:
      "Odoo implementation, customisation and integration for SMEs and industrial organisations, built around how your operation actually runs.",
    section: "Operational Systems",
    priority: 0.9,
    changeFrequency: "monthly",
    keywords: ["Odoo implementation", "Odoo customisation", "Odoo consultant UK"],
  },
  {
    path: "/erpnext",
    type: "service",
    title: "ERPNext Implementation & Customisation",
    description:
      "ERPNext implementation, customisation and integration for SMEs and industrial organisations, connected to the systems you already use.",
    section: "Operational Systems",
    priority: 0.9,
    changeFrequency: "monthly",
    keywords: ["ERPNext implementation", "ERPNext customisation", "ERPNext consultant UK"],
  },
  {
    path: "/case-studies/el-mecano-garage",
    type: "case-study",
    title: "El Mecano Garage Case Study",
    description: "How Navitrends supported El Mecano Garage with operational digitalisation. Challenge, solution and results.",
    section: "Case Studies",
    priority: 0.7,
    breadcrumbLabel: "El Mecano Garage",
  },
  {
    path: "/case-studies/arsenal-bache",
    type: "case-study",
    title: "Arsenal Bâche Case Study",
    description: "How Navitrends supported Arsenal Bâche with operational digitalisation. Challenge, solution and results.",
    section: "Case Studies",
    priority: 0.7,
    breadcrumbLabel: "Arsenal Bâche",
  },
  {
    path: "/case-studies/patient-management",
    type: "case-study",
    title: "Aesthetic Surgery Practice Case Study",
    description: "How Navitrends digitalised patient management for an aesthetic surgery practice. Challenge, solution and results.",
    section: "Case Studies",
    priority: 0.7,
    breadcrumbLabel: "Aesthetic Surgery Practice",
  },
  {
    path: "/insights",
    type: "page",
    title: "Insights on ERP, Automation & Applied AI",
    description:
      "Practical articles on ERP, automation, operational knowledge and applied AI for SMEs and industrial organisations.",
    section: "Insights",
    priority: 0.8,
    changeFrequency: "weekly",
    breadcrumbLabel: "Insights",
  },
  {
    path: "/p/privacy",
    type: "legal",
    title: "Privacy Policy",
    description: "How Navitrends Ltd collects, uses and protects personal data.",
    priority: 0.2,
    changeFrequency: "yearly",
    breadcrumbLabel: "Privacy",
  },
  {
    path: "/p/terms",
    type: "legal",
    title: "Terms of Service",
    description: "The terms under which Navitrends Ltd provides its services and website.",
    priority: 0.2,
    changeFrequency: "yearly",
    breadcrumbLabel: "Terms",
  },
];


export const homeFaq: readonly FaqItem[] = [
  {
    question: "What does Navitrends UK actually do?",
    answer:
      "We help SMEs and industrial organisations digitise operations: connect ERP and other systems, automate the work that still lives in Excel, and apply data or AI only where it moves a measurable KPI.",
  },
  {
    question: "Do you replace our existing ERP?",
    answer:
      "Not by default. We map how the operation really runs, then we reset, connect or extend what you already have. A new ERP is only recommended when the current system cannot carry the process.",
  },
  {
    question: "Who is this for?",
    answer:
      "Operations, finance and IT leaders in growing SMEs and industrial groups who are stuck with expert-dependent processes, disconnected data and reports rebuilt by hand.",
  },
  {
    question: "What happens in the diagnostic?",
    answer:
      "A 30-minute call on one process, one bottleneck and one KPI. No product pitch before we understand the problem. You leave with a clear next step, not a software catalogue.",
  },
  {
    question: "Where is Navitrends based?",
    answer:
      "Navitrends Ltd is registered at 5 Brayford Square, London E1 0SG, and works with organisations in the UK, Europe and North Africa.",
  },
];
