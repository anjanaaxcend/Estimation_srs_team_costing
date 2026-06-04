"use client";

import Link from "next/link";
import { 
  FileText, 
  Users, 
  Calculator, 
  ArrowRight,
  Zap,
} from "lucide-react";
import { PageIntro } from "@/components/workflow/PageIntro";

export default function ServicesPage() {
  const services = [
    {
      id: "srs",
      title: "SRS Generation",
      description: "Convert project briefs into professional software requirements specifications and delivery plans.",
      icon: FileText,
      href: "/input",
      color: "blue",
      features: ["NLP Extraction", "Module Hierarchy", "Gantt Charts"]
    },
    {
      id: "team",
      title: "Team Designing",
      description: "Allocate optimized resource structures based on project complexity and delivery timelines.",
      icon: Users,
      href: "/team-design",
      color: "amber",
      features: ["AI Recommendation", "Editable Roles", "Skill Mapping"]
    },
    {
      id: "cost",
      title: "Cost Estimation",
      description: "Generate deep financial insights and project budgets derived from resource allocation.",
      icon: Calculator,
      href: "/cost-estimation",
      color: "emerald",
      features: ["Multi-tier Pricing", "TCO Analysis", "ROI Projections"]
    }
  ];

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow="Service Modules"
        title="One connected AI tool, three planning layers."
        copy="Run SRS generation, team allocation, and cost estimation as separate modules or as one continuous chain."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {services.map((service) => {
            const Icon = service.icon;

            return (
              <Link
                key={service.id}
                href={service.href}
                className="page-panel group flex flex-col transition-all duration-300 hover:-translate-y-1"
              >
                <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-[24px] border border-slate-300/50 bg-white/8 text-accent shadow-xl transition-all group-hover:scale-110">
                  <Icon size={32} />
                </div>

                <h2 className="mb-4 text-2xl font-black text-slate-700">{service.title}</h2>
                <p className="mb-8 flex-1 text-slate-400 group-hover:text-slate-200">
                  {service.description}
                </p>

                <div className="mb-8 flex flex-col gap-2">
                  {service.features.map((feat) => (
                    <div key={feat} className="flex items-center gap-2 text-xs font-bold text-slate-400">
                      <Zap size={12} className="text-accent" />
                      {feat}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-700">
                    Get Started
                  </span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300/50 bg-white/8 text-slate-700 transition-all group-hover:translate-x-1">
                    <ArrowRight size={20} />
                  </div>
                </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
