"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";


import { runSrsPipeline, getTempDraft, normalizeSrs, getApprovedSRS, restoreApprovedSRS } from "@/lib/platformApi";
import { clearCostDraft } from "@/lib/costEstimationStorage";
import { clearApprovedTeam } from "@/lib/workflowArtifacts";
import { useAuth } from "@/context/AuthContext";

const WorkflowContext = createContext(null);
const storageKey = "ai-project-planner-workflow-v1";

const emptyPreview = {
  title: "Project Brief",
  sections: [],
  structuredRequirements: {
    project_name: "",
    features: [],
    modules: [],
    ui_pages: [],
    user_roles: [],
    non_functional_requirements: [],
  },
  cleanedText: "",
};

export function WorkflowProvider({ children }) {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [projectTitle, setProjectTitle] = useState("");
  const [source, setSource] = useState("text");
  const [rawInput, setRawInput] = useState("");
  const [cleanedInput, setCleanedInput] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [srsData, setSrsData] = useState(emptyPreview);
  const [history, setHistory] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState("openai");

  const updateSrsData = (newData) => {
    setHistory((prev) => [...prev, srsData]);
    setSrsData(newData);
    try {
      const payload = { projectTitle, source, rawInput, cleanedInput, selectedEngine, srsData: newData };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (e) {}
  };

  // Restore state from DB or localStorage on mount (fixes the blank SRS after refresh bug)
  useEffect(() => {
    const restoreState = async () => {
      let localPayload = null;
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          localPayload = JSON.parse(stored);
        }
      } catch (e) {}

      try {
        const dbResponse = await getTempDraft();
        if (dbResponse && dbResponse.draft) {
          const draft = dbResponse.draft;
          const normalized = normalizeSrs(draft);
          setSrsData(normalized);
          if (normalized.structuredRequirements?.project_name) {
            setProjectTitle(normalized.structuredRequirements.project_name);
          }
          if (draft.cleaned_text) {
            setCleanedInput(draft.cleaned_text);
            setRawInput(draft.cleaned_text);
          }
          if (dbResponse.team_draft) {
            window.localStorage.setItem("ai-project-planner-team-draft-v1", JSON.stringify(dbResponse.team_draft));
            if (dbResponse.team_draft.teamData) {
              window.localStorage.setItem("nexaforge-approved-team-v1", JSON.stringify(dbResponse.team_draft.teamData));
            }
          }
          if (dbResponse.cost_draft) {
            window.localStorage.setItem("ai-project-planner-cost-estimation-v1", JSON.stringify(dbResponse.cost_draft));
          }
          setIsHydrated(true);
          return;
        } else {
          // If no temporary draft exists, check for the latest approved SRS in the DB
          try {
            const approvedList = await getApprovedSRS();
            if (approvedList && approvedList.length > 0) {
              const latestApproved = approvedList[0];
              const normalized = normalizeSrs(latestApproved.content);
              setSrsData(normalized);
              if (normalized.structuredRequirements?.project_name) {
                setProjectTitle(normalized.structuredRequirements.project_name);
              }
              if (normalized.cleanedText) {
                setCleanedInput(normalized.cleanedText);
                setRawInput(normalized.cleanedText);
              }
              setIsHydrated(true);
              return;
            }
          } catch (approvedErr) {
            console.warn("Failed to fetch approved SRS:", approvedErr);
          }
        }
      } catch (err) {
        console.error("Failed to restore draft from DB, falling back to localStorage", err);
      }

      // Fallback to localStorage
      if (localPayload) {
        if (localPayload.srsData?.sections?.length > 0) setSrsData(localPayload.srsData);
        if (localPayload.projectTitle) setProjectTitle(localPayload.projectTitle);
        if (localPayload.source) setSource(localPayload.source);
        if (localPayload.rawInput) setRawInput(localPayload.rawInput);
        if (localPayload.cleanedInput) setCleanedInput(localPayload.cleanedInput);
        if (localPayload.selectedEngine) setSelectedEngine(localPayload.selectedEngine);
      }
      setIsHydrated(true);
    };

    restoreState();
  }, []);

  // Persist to localStorage whenever any key state changes
  useEffect(() => {
    if (!isHydrated) return;
    try {
      const payload = { projectTitle, source, rawInput, cleanedInput, selectedEngine };
      // Only include srsData if it has real content
      if (srsData?.sections?.length > 0) {
        payload.srsData = srsData;
      }
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (e) {
      // ignore storage quota errors
    }
  }, [isHydrated, srsData, projectTitle, source, rawInput, cleanedInput, selectedEngine]);

  const submitInput = async ({ nextSource, textValue, file, selectedEngine }) => {
    setIsProcessing(true);
    setErrorMessage("");
    setSource(nextSource);
    setRawInput(textValue);
    setUploadedFileName(file?.name ?? "");
    setSrsData(emptyPreview);
    clearApprovedTeam();

    try {
      const result = await runSrsPipeline({
        projectTitle,
        source: nextSource,
        rawText: textValue,
        file,
        selectedEngine,
      });

      setCleanedInput(result.cleanedText || textValue);
      // For file uploads textValue is "" — store the extracted cleanedText as rawInput
      // so the Regenerate button always has source text to send to the backend.
      if (!textValue && result.cleanedText) {
        setRawInput(result.cleanedText);
      }
      setHistory((prev) => [...prev, srsData]);
      setSrsData(result.srs);
      await refreshUser();

      if (result.srs?.structuredRequirements?.project_name) {
        setProjectTitle(result.srs.structuredRequirements.project_name);
      }

      router.push("/srs");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate the SRS from the provided source."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const resetWorkflow = () => {
    setProjectTitle("");
    setSource("text");
    setRawInput("");
    setCleanedInput("");
    setUploadedFileName("");
    setSrsData(emptyPreview);
    setHistory([]);
    setErrorMessage("");
    try { window.localStorage.removeItem(storageKey); } catch (e) {}
    try { window.localStorage.removeItem("ai-project-planner-team-draft-v1"); } catch (e) {}
    clearCostDraft();
    clearApprovedTeam();
    router.push("/input");
  };

  const clearInputFields = () => {
    setProjectTitle("");
    setSource("text");
    setRawInput("");
    setCleanedInput("");
    setUploadedFileName("");
    setSrsData(emptyPreview);
    setHistory([]);
    setErrorMessage("");
    try { window.localStorage.removeItem(storageKey); } catch (e) {}
    try { window.localStorage.removeItem("ai-project-planner-team-draft-v1"); } catch (e) {}
    clearCostDraft();
    clearApprovedTeam();
  };

  const undoChange = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setSrsData(previous);
    setHistory((prev) => prev.slice(0, -1));
  };

  const loadApprovedSrs = async (approvedData) => {
    try {
      await restoreApprovedSRS(approvedData.id);
    } catch (e) {
      console.error("Failed to restore blueprint in backend:", e);
    }

    const srs = approvedData.content;
    const normalized = normalizeSrs(srs);
    setSrsData(normalized);
    setProjectTitle(approvedData.project_name || srs.title || "Project Blueprint");
    
    const inputVal = srs.cleaned_text || normalized.cleanedText || "";
    setCleanedInput(inputVal);
    setRawInput(inputVal);

    // Save to localStorage so frontend pages can load it immediately
    try {
      const workflowPayload = {
        projectTitle: approvedData.project_name || srs.title || "Project Blueprint",
        source: "text",
        rawInput: inputVal,
        cleanedInput: inputVal,
        selectedEngine: srs.selected_model?.provider || "openai",
        srsData: normalized
      };
      window.localStorage.setItem(storageKey, JSON.stringify(workflowPayload));

      if (approvedData.team_content) {
        window.localStorage.setItem("ai-project-planner-team-draft-v1", approvedData.team_content);
        try {
          const teamDraft = JSON.parse(approvedData.team_content);
          if (teamDraft.teamData) {
            window.localStorage.setItem("nexaforge-approved-team-v1", JSON.stringify(teamDraft.teamData));
          }
        } catch (err) {}
      } else {
        window.localStorage.removeItem("ai-project-planner-team-draft-v1");
        window.localStorage.removeItem("nexaforge-approved-team-v1");
      }

      if (approvedData.cost_content) {
        window.localStorage.setItem("ai-project-planner-cost-estimation-v1", approvedData.cost_content);
      } else {
        window.localStorage.removeItem("ai-project-planner-cost-estimation-v1");
      }

      if (approvedData.axcend_estimation_content) {
        window.localStorage.setItem("axcend-effort-estimation-v1", approvedData.axcend_estimation_content);
      } else {
        window.localStorage.removeItem("axcend-effort-estimation-v1");
      }
    } catch (e) {
      console.error("Failed to write restored blueprint to localStorage:", e);
    }

    router.push("/srs");
  };

  const value = useMemo(
    () => ({
      projectTitle,
      setProjectTitle,
      source,
      rawInput,
      cleanedInput,
      uploadedFileName,
      srsData,
      updateSrsData,
      isProcessing,
      setIsProcessing,
      errorMessage,
      isHydrated,
      selectedEngine,
      setSelectedEngine,
      submitInput,
      resetWorkflow,
      clearInputFields,
      undoChange,
      loadApprovedSrs,
      canUndo: history.length > 0,
    }),
    [
      projectTitle,
      source,
      rawInput,
      cleanedInput,
      uploadedFileName,
      srsData,
      history,
      isProcessing,
      setIsProcessing,
      errorMessage,
      isHydrated,
      selectedEngine,
    ]
  );

  // Don't render children until hydration is complete to prevent blank flashes
  if (!isHydrated) {
    return (
      <WorkflowContext.Provider value={value}>
        <div className="min-h-screen bg-[#0a1120]" />
      </WorkflowContext.Provider>
    );
  }

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow() {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used inside WorkflowProvider.");
  }
  return context;
}
