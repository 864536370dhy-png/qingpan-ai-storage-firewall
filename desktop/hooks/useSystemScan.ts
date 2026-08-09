import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanResult, ScanStage, ScanState } from "../types";

const stages: ScanStage[] = ["discovering", "metadata", "related", "finalizing"];

export function useSystemScan() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [state, setState] = useState<ScanState>("idle");
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state !== "scanning") return;
    const timer = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, stages.length - 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [state]);

  const startScan = useCallback(async () => {
    setError("");
    setStageIndex(0);
    setState("scanning");
    try {
      const result = await invoke<ScanResult>("scan_system");
      setScan(result);
      setStageIndex(stages.length - 1);
      setState("done");
      return result;
    } catch (scanError) {
      setError(String(scanError));
      setState("error");
      return null;
    }
  }, []);

  return useMemo(() => ({
    scan,
    state,
    stage: stages[stageIndex],
    error,
    startScan,
  }), [error, scan, stageIndex, startScan, state]);
}
