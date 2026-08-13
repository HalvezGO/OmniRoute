import { getSyncedAvailableModels, getAllSyncedAvailableModels } from "@/lib/db/models";
import { getModelContextOverrideRecord } from "@/lib/db/modelContextOverrides";
import { isAuthenticated } from "@/shared/utils/apiAuth";

/**
 * GET /api/synced-available-models?provider=<id>
 * List synced available models for a provider (or all providers).
 * Merges the manual/auto context-window override (#4125) onto each row so the
 * UI shows the effective window without a second round trip.
 */
export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return Response.json(
        { error: { message: "Authentication required", type: "invalid_api_key" } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (provider) {
      const models = await getSyncedAvailableModels(provider);
      const withContextOverride = models.map((model) => {
        const record = getModelContextOverrideRecord(provider, model.id);
        return record
          ? {
              ...model,
              contextWindowOverride: record.realContext,
              contextWindowOverrideSource: record.source,
            }
          : model;
      });
      return Response.json({ models: withContextOverride });
    }

    const allModels = await getAllSyncedAvailableModels();
    const allWithContextOverride = Object.fromEntries(
      Object.entries(allModels).map(([providerId, models]) => [
        providerId,
        models.map((model) => {
          const record = getModelContextOverrideRecord(providerId, model.id);
          return record
            ? {
                ...model,
                contextWindowOverride: record.realContext,
                contextWindowOverrideSource: record.source,
              }
            : model;
        }),
      ])
    );
    return Response.json(allWithContextOverride);
  } catch {
    return Response.json(
      { error: { message: "Failed to fetch synced available models", type: "server_error" } },
      { status: 500 }
    );
  }
}
