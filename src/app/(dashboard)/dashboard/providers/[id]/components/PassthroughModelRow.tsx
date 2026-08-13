"use client";
/**
 * PassthroughModelRow — Issue #3501 Phase 1e
 *
 * Extracted from ProviderDetailPageClient.tsx. Renders one row in the
 * passthrough / compatible models list.
 *
 * Leaf component: imports from shared, leaf helpers, and sibling components.
 * Never imports from ProviderDetailPageClient.
 */
import React, { useState, useRef, useEffect } from "react";
import { Badge, Button } from "@/shared/components";
import { providerText, type CompatModelRow } from "../providerPageHelpers";
import ModelCompatPopover from "./ModelCompatPopover";
import { ModelSourceBadge, type ModelCompatSavePatch } from "./ModelRow";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PassthroughModelRowProps {
  modelId: string;
  fullModel: string;
  provider: string;
  alias?: string | null;
  source?: string;
  isFree?: boolean;
  isHidden?: boolean;
  copied?: string;
  onCopy: (text: string, key: string) => void;
  onDeleteAlias?: () => void;
  onSetAlias?: (alias: string) => void;
  t: (key: string, values?: Record<string, unknown>) => string;
  showDeveloperToggle?: boolean;
  effectiveModelNormalize: (modelId: string, protocol?: string) => boolean;
  effectiveModelPreserveDeveloper: (modelId: string, protocol?: string) => boolean;
  saveModelCompatFlags: (modelId: string, patch: ModelCompatSavePatch) => void;
  getUpstreamHeadersRecord: (protocol: string) => Record<string, string>;
  compatDisabled?: boolean;
  onToggleHidden?: (modelId: string, hidden: boolean) => Promise<void>;
  togglingHidden?: boolean;
  onTestModel?: (modelId: string, fullModel: string) => Promise<void>;
  testStatus?: "ok" | "error" | null;
  testingModel?: boolean;
  /**
   * Raw catalog/model row for the synced/imported entry. When present the row can
   * render the endpoint tags and the "edit imported model" panel (operator edits
   * persist via model_synced_overrides — see /api/provider-models PUT).
   */
  model?: CompatModelRow;
  onSaveModelEdit?: (patch: ImportedModelEditPatch) => Promise<void> | void;
  isSavingEdit?: boolean;
}

/** Fields an operator can edit for an imported/synced model. Mirrors the PUT
 * /api/provider-models body subset handled by the model_synced_overrides path. */
export interface ImportedModelEditPatch {
  apiFormat?: string;
  targetFormat?: string;
  supportedEndpoints?: string[];
  supportsVision?: boolean | null;
  contextWindowOverride?: number | null;
}

const API_FORMAT_OPTIONS = [
  "chat-completions",
  "responses",
  "embeddings",
  "rerank",
  "audio-transcriptions",
  "audio-speech",
  "images-generations",
] as const;

const ENDPOINT_OPTIONS = ["chat", "embeddings", "rerank", "images", "audio"] as const;

function targetFormatLabel(value: string, t: (key: string) => string): string {
  const keyMap: Record<string, string> = {
    openai: "compatProtocolOpenAI",
    "openai-responses": "compatProtocolOpenAIResponses",
    claude: "compatProtocolClaude",
    gemini: "targetFormatGemini",
    antigravity: "targetFormatAntigravity",
  };
  const key = keyMap[value];
  return key ? t(key) : value;
}

function endpointOptionLabel(ep: string, t: (key: string) => string): string {
  switch (ep) {
    case "chat":
      return `💬 ${t("supportedEndpointChat")}`;
    case "embeddings":
      return `📐 ${t("supportedEndpointEmbeddings")}`;
    case "rerank":
      return providerText(t, "rerankEndpoint", "Rerank");
    case "images":
      return `🖼️ ${t("supportedEndpointImages")}`;
    case "audio":
      return `🔊 ${t("supportedEndpointAudio")}`;
    default:
      return ep;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PassthroughModelRow({
  modelId,
  fullModel,
  alias,
  source,
  isFree,
  isHidden,
  copied,
  onCopy,
  onDeleteAlias,
  onSetAlias,
  t,
  showDeveloperToggle = true,
  effectiveModelNormalize,
  effectiveModelPreserveDeveloper,
  getUpstreamHeadersRecord,
  saveModelCompatFlags,
  provider,
  compatDisabled,
  onToggleHidden,
  togglingHidden,
  onTestModel,
  testStatus,
  testingModel,
  model,
  onSaveModelEdit,
  isSavingEdit,
}: PassthroughModelRowProps) {
  const [editing, setEditing] = useState(false);
  const [aliasValue, setAliasValue] = useState(alias || "");
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingProperties, setEditingProperties] = useState(false);
  const [editApiFormat, setEditApiFormat] = useState(model?.apiFormat || "chat-completions");
  const [editTargetFormat, setEditTargetFormat] = useState(model?.targetFormat || "");
  const [editEndpoints, setEditEndpoints] = useState<string[]>(
    Array.isArray(model?.supportedEndpoints) && model.supportedEndpoints.length
      ? model.supportedEndpoints
      : ["chat"]
  );
  const [editContextWindow, setEditContextWindow] = useState(
    typeof model?.contextWindowOverride === "number" ? String(model.contextWindowOverride) : ""
  );
  const [editSupportsVision, setEditSupportsVision] = useState(model?.supportsVision === true);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setAliasValue(alias || "");
    setEditing(true);
  };

  const handleAliasSubmit = () => {
    const trimmed = aliasValue.trim();
    if (trimmed && trimmed !== alias) {
      onSetAlias?.(trimmed);
    } else if (!trimmed && alias) {
      onDeleteAlias?.();
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAliasSubmit();
    }
    if (e.key === "Escape") {
      setAliasValue(alias || "");
      setEditing(false);
    }
  };

  const beginPropertyEdit = () => {
    setEditApiFormat(model?.apiFormat || "chat-completions");
    setEditTargetFormat(model?.targetFormat || "");
    setEditEndpoints(
      Array.isArray(model?.supportedEndpoints) && model.supportedEndpoints.length
        ? model.supportedEndpoints
        : ["chat"]
    );
    setEditContextWindow(
      typeof model?.contextWindowOverride === "number" ? String(model.contextWindowOverride) : ""
    );
    setEditSupportsVision(model?.supportsVision === true);
    setEditingProperties(true);
  };

  const cancelPropertyEdit = () => {
    setEditingProperties(false);
  };

  const savePropertyEdit = async () => {
    if (!editEndpoints.length) {
      alert(providerText(t, "selectSupportedEndpoint", "Select at least one supported endpoint"));
      return;
    }
    const trimmed = editContextWindow.trim();
    let contextWindowOverride: number | null = null;
    if (trimmed) {
      if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
        alert(providerText(t, "contextWindowOverrideInvalid", "Invalid context window override"));
        return;
      }
      contextWindowOverride = Number(trimmed);
    }
    await onSaveModelEdit?.({
      apiFormat: editApiFormat,
      ...(editTargetFormat ? { targetFormat: editTargetFormat } : {}),
      supportedEndpoints: editEndpoints,
      contextWindowOverride,
      supportsVision: editSupportsVision ? true : null,
    });
    setEditingProperties(false);
  };

  // Only synced/imported rows are editable here. Custom models are edited in the
  // "Custom models" section below; showing a duplicate edit control here would
  // confuse (the row-level PUT path targets model_synced_overrides, not customModels).
  const canEditProperties = Boolean(onSaveModelEdit && model && source === "imported");

  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded-lg border border-border px-3.5 py-3 transition-opacity hover:bg-sidebar/50 ${
        isHidden ? "opacity-50" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="material-symbols-outlined shrink-0 text-base text-text-muted"
          style={{ color: isHidden ? "var(--color-text-muted)" : undefined }}
        >
          smart_toy
        </span>
        <code
          className="min-w-0 truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted"
          title={fullModel}
        >
          {fullModel}
        </code>
        {onSetAlias && (
          <span className="flex min-w-0 items-center text-[9px] gap-1">
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                value={aliasValue}
                onChange={(e) => setAliasValue(e.target.value)}
                onBlur={handleAliasSubmit}
                onKeyDown={handleKeyDown}
                placeholder={providerText(t, "aliasInputPlaceholder", "alias name")}
                className="bg-surface border border-primary/50 rounded px-1 py-0.5 text-[9px] text-text-main outline-none w-24"
              />
            ) : (
              <span
                className={`truncate text-[9px] italic cursor-pointer hover:text-primary transition-colors ${alias ? "text-primary/80" : "text-text-muted/70"}`}
                onClick={startEditing}
                title={
                  alias
                    ? providerText(t, "clickToEditAlias", "Alias: {alias} (click to edit)", {
                        alias,
                      })
                    : providerText(t, "clickToSetAlias", "Click to set alias")
                }
              >
                {alias || providerText(t, "clickToSetAlias", "Click to set alias")}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ModelSourceBadge source={source} />
          {isFree && (
            <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px]">
              {providerText(t, "freeBadge", "Free")}
            </Badge>
          )}
          {model?.apiFormat === "responses" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
              {t("responses")}
            </span>
          )}
          {model?.targetFormat && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium"
              title={t("targetFormatHint")}
            >
              {`→ ${targetFormatLabel(model.targetFormat, t)}`}
            </span>
          )}
          {typeof model?.contextWindowOverride === "number" && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-medium"
              title={t("contextWindowOverrideHint")}
            >
              {`🪟 ${model.contextWindowOverride.toLocaleString()}`}
            </span>
          )}
          {model?.supportsVision === true && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/15 text-pink-400 font-medium"
              title={t("visionCapableHint")}
            >
              {`👁️ ${t("visionCapableLabel")}`}
            </span>
          )}
          {model?.supportedEndpoints?.includes("embeddings") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium">
              {`📐 ${t("supportedEndpointEmbeddings")}`}
            </span>
          )}
          {model?.supportedEndpoints?.includes("images") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
              {`🖼️ ${t("imagesShortLabel")}`}
            </span>
          )}
          {model?.supportedEndpoints?.includes("audio") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
              {`🔊 ${t("audioShortLabel")}`}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEditProperties && (
            <button
              onClick={beginPropertyEdit}
              className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
              title={providerText(t, "editModelProperties", "Edit model properties")}
            >
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          )}
          <button
            onClick={() => onCopy(fullModel, `model-${modelId}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
            title={t("copyModel")}
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${modelId}` ? "check" : "content_copy"}
            </span>
          </button>
          {onTestModel && (
            <button
              onClick={() => onTestModel(modelId, fullModel)}
              disabled={testingModel}
              className={`rounded p-0.5 hover:bg-sidebar transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${testStatus === "ok" ? "text-green-500" : testStatus === "error" ? "text-red-500" : "text-text-muted hover:text-primary"}`}
              title={
                testingModel
                  ? t("testingModel")
                  : testStatus === "ok"
                    ? "OK"
                    : testStatus === "error"
                      ? "Error"
                      : t("testModel")
              }
            >
              {testingModel ? (
                <span className="material-symbols-outlined text-sm animate-spin">
                  progress_activity
                </span>
              ) : testStatus === "ok" ? (
                <span className="material-symbols-outlined text-sm">check_circle</span>
              ) : testStatus === "error" ? (
                <span className="material-symbols-outlined text-sm">error</span>
              ) : (
                <span className="material-symbols-outlined text-sm">play_circle</span>
              )}
            </button>
          )}
          {onToggleHidden && (
            <button
              onClick={() => onToggleHidden(modelId, !isHidden)}
              disabled={togglingHidden}
              className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title={
                isHidden
                  ? providerText(t, "showModel", "Show model")
                  : providerText(t, "hideModel", "Hide model")
              }
            >
              <span className="material-symbols-outlined text-sm">
                {isHidden ? "visibility_off" : "visibility"}
              </span>
            </button>
          )}
          <ModelCompatPopover
            t={t}
            providerId={provider}
            modelId={modelId}
            effectiveModelNormalize={(p) => effectiveModelNormalize(modelId, p)}
            effectiveModelPreserveDeveloper={(p) => effectiveModelPreserveDeveloper(modelId, p)}
            getUpstreamHeadersRecord={getUpstreamHeadersRecord}
            onCompatPatch={(protocol, payload) =>
              saveModelCompatFlags(modelId, { compatByProtocol: { [protocol]: payload } })
            }
            showDeveloperToggle={showDeveloperToggle}
            compact
            disabled={compatDisabled}
          />
          {onDeleteAlias && (
            <button
              onClick={onDeleteAlias}
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title={t("removeModel")}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
      </div>

      {canEditProperties && editingProperties && (
        <div className="mt-1 min-w-0 max-w-full rounded-lg border border-border bg-muted p-3 dark:bg-zinc-900">
          <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
            <div className="w-[11rem] shrink-0 min-w-0">
              <label className="text-xs text-text-muted mb-1 block">{t("apiFormatLabel")}</label>
              <select
                value={editApiFormat}
                onChange={(e) => setEditApiFormat(e.target.value)}
                className="w-full px-2.5 py-2 text-xs border border-border rounded-lg bg-background text-text-main focus:outline-none focus:border-primary"
              >
                {API_FORMAT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === "chat-completions"
                      ? t("chatCompletions")
                      : value === "responses"
                        ? t("responsesApi")
                        : value === "embeddings"
                          ? t("embeddings")
                          : value === "rerank"
                            ? providerText(t, "rerankEndpoint", "Rerank")
                            : value === "audio-transcriptions"
                              ? t("audioTranscriptions")
                              : value === "audio-speech"
                                ? t("audioSpeech")
                                : t("imagesGenerations")}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[11rem] shrink-0 min-w-0">
              <label className="text-xs text-text-muted mb-1 block">{t("targetFormatLabel")}</label>
              <select
                value={editTargetFormat}
                onChange={(e) => setEditTargetFormat(e.target.value)}
                title={t("targetFormatHint")}
                className="w-full px-2.5 py-2 text-xs border border-border rounded-lg bg-background text-text-main focus:outline-none focus:border-primary"
              >
                <option value="">{t("targetFormatAuto")}</option>
                <option value="openai">{t("compatProtocolOpenAI")}</option>
                <option value="openai-responses">{t("compatProtocolOpenAIResponses")}</option>
                <option value="claude">{t("compatProtocolClaude")}</option>
                <option value="gemini">{t("targetFormatGemini")}</option>
                <option value="antigravity">{t("targetFormatAntigravity")}</option>
              </select>
            </div>
            <div className="w-[10rem] shrink-0 min-w-0">
              <label className="text-xs text-text-muted mb-1 block">
                {t("contextWindowOverrideLabel")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={editContextWindow}
                onChange={(e) => setEditContextWindow(e.target.value)}
                placeholder={t("contextWindowOverridePlaceholder")}
                title={t("contextWindowOverrideHint")}
                className="w-full px-2.5 py-2 text-xs border border-border rounded-lg bg-background text-text-main focus:outline-none focus:border-primary"
              />
            </div>
            <div className="w-[9rem] shrink-0 min-w-0">
              <label className="text-xs text-text-muted mb-1 block">&nbsp;</label>
              <label
                htmlFor={`imported-model-edit-vision-${modelId}`}
                className="flex items-center gap-1.5 text-xs text-text-main cursor-pointer whitespace-nowrap px-2.5 py-2"
                title={t("visionCapableHint")}
              >
                <input
                  id={`imported-model-edit-vision-${modelId}`}
                  type="checkbox"
                  checked={editSupportsVision}
                  onChange={(e) => setEditSupportsVision(e.target.checked)}
                  className="rounded border-border"
                />
                {`👁️ ${t("visionCapableLabel")}`}
              </label>
            </div>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs text-text-muted shrink-0">{t("supportedEndpointsLabel")}</span>
            <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1 min-w-0">
              {ENDPOINT_OPTIONS.map((ep) => (
                <label
                  key={ep}
                  className="flex items-center gap-1.5 text-xs text-text-main cursor-pointer whitespace-nowrap"
                >
                  <input
                    type="checkbox"
                    checked={editEndpoints.includes(ep)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditEndpoints((prev) => (prev.includes(ep) ? prev : [...prev, ep]));
                      } else {
                        setEditEndpoints((prev) => prev.filter((x) => x !== ep));
                      }
                    }}
                    className="rounded border-border"
                  />
                  {endpointOptionLabel(ep, t)}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={savePropertyEdit} disabled={isSavingEdit}>
              {isSavingEdit ? t("saving") : t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelPropertyEdit}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
