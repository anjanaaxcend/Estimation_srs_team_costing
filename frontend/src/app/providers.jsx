"use client";

import { StudioShell } from "@/components/shell/StudioShell";
import { WorkflowProvider } from "@/context/WorkflowContext";
import { AuthProvider } from "@/context/AuthContext";

export function Providers({ children }) {
  return (
    <AuthProvider>
      <WorkflowProvider>
        <StudioShell>{children}</StudioShell>
      </WorkflowProvider>
    </AuthProvider>
  );
}
