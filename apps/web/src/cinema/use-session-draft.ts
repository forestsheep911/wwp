import { useEffect, useRef } from "react";
import { readSession, writeSession } from "./session-state";
export function useSessionDraft(key: string, value: string, setValue: (value: string) => void, enabled: boolean) {
  const loaded = useRef("");
  const skipSave = useRef(false);
  useEffect(() => {
    if (!enabled) { loaded.current = ""; return; }
    loaded.current = key; skipSave.current = true;
    setValue(readSession(`draft:${key}`, ""));
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled || loaded.current !== key) return;
    if (skipSave.current) { skipSave.current = false; return; }
    writeSession(`draft:${key}`, value);
  }, [key, value, enabled]);
}
