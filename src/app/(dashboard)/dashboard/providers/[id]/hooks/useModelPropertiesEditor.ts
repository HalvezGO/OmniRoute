"use client";

import { useCallback, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { providerText, type ModelPropertiesPatch } from "../providerPageHelpers";

export interface UseModelPropertiesEditorReturn {
  saveModelProperties: (modelId: string, patch: ModelPropertiesPatch) => Promise<void>;
  savingModelProperties: string | null;
}

/**
 * Persist apiFormat/targetFormat/supportsVision edits for a synced/imported
 * model. The route writes these to `modelCompatOverrides` when the model has no
 * customModels row, so a re-sync cannot overwrite the operator's choice and no
 * shadow custom row is created.
 */
export function useModelPropertiesEditor(
  providerId: string,
  onSaved: (() => void | Promise<void>) | undefined,
  t: (key: string, values?: Record<string, unknown>) => string
): UseModelPropertiesEditorReturn {
  const notify = useNotificationStore();
  const [savingModelProperties, setSavingModelProperties] = useState<string | null>(null);

  const saveModelProperties = useCallback(
    async (modelId: string, patch: ModelPropertiesPatch) => {
      setSavingModelProperties(modelId);
      try {
        const response = await fetch("/api/provider-models", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, modelId, ...patch }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          notify.error(
            data?.error?.message ||
              providerText(
                t,
                "failedSaveModelEndpointSettings",
                "Failed to save model endpoint settings"
              )
          );
          return;
        }
        await onSaved?.();
        notify.success(
          providerText(t, "savedModelEndpointSettings", "Saved model endpoint settings")
        );
      } catch (error) {
        console.error("Failed to save model properties:", error);
        notify.error(
          providerText(
            t,
            "failedSaveModelEndpointSettings",
            "Failed to save model endpoint settings"
          )
        );
      } finally {
        setSavingModelProperties(null);
      }
    },
    [notify, onSaved, providerId, t]
  );

  return { saveModelProperties, savingModelProperties };
}
