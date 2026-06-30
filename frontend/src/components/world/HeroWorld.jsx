"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function HeroWorld() {
  return (
    <section className="border-box bg-[var(--bg)] mb-16">
      
      {/* Top Banner */}
      <div className="p-8 border-b-strong flex justify-between items-center">
        <span className="sans-label">Estimator v2</span>
        <span className="sans-label">AI Strategy</span>
      </div>

      <div className="grid lg:grid-cols-2">
        {/* Left Massive Text */}
        <div className="p-8 md:p-16 lg:p-24 border-r-strong">
          <h1 className="editorial-h1 mb-12">
            Automated <br/>
            <span className="italic text-[var(--text-body)]">Strategic</span><br/>
            Planning.
          </h1>
          <p className="font-sans text-2xl max-w-xl leading-relaxed">
            Estimator analyzes your raw briefs, generates technical specifications, designs team architectures, and estimates cost—all instantly.
          </p>
        </div>

        {/* Right Action Area */}
        <div className="flex flex-col">
          <div className="flex-1 p-8 md:p-16 lg:p-24 flex flex-col justify-center border-b-strong">
            <h2 className="editorial-h2 mb-6">10x Faster</h2>
            <p className="font-sans text-xl leading-relaxed max-w-md">
              From an unstructured Google Doc to a fully synthesized architectural specification and Excel output in seconds.
            </p>
          </div>
          <Link href="/input" className="action-massive group border-none!">
            <span>Enter Studio</span>
            <ArrowRight size={48} className="group-hover:translate-x-4 transition-transform" />
          </Link>
        </div>
      </div>

      <div className="marquee-container">
        <div className="marquee-content">
          {[...Array(6)].map((_, i) => (
            <span key={i}>GENERATE SRS &nbsp; • &nbsp; CALCULATE COSTS &nbsp; • &nbsp; DESIGN TEAMS &nbsp; • &nbsp; </span>
          ))}
        </div>
      </div>
    </section>
  );
}
