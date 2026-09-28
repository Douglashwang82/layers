import { z } from "zod";
import type { RestaurantArea } from "./daily-pick-restaurant-run";
import {
  createAnthropicCopyAdapter,
  createGooglePlacesDiscoveryAdapter,
  createGooglePlacesQualificationAdapter,
  requireConfiguredModel,
} from "./restaurant-providers";
import type { RestaurantAdapters } from "./restaurant-jobs";

const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const liveConfig = z.object({
  providerPolicyApproval: z.string().trim().min(1),
  areaRectangle: z
    .object({ low: point, high: point })
    .refine(
      (r) =>
        r.low.latitude < r.high.latitude && r.low.longitude < r.high.longitude,
    ),
  queryGroups: z.array(z.string().trim().min(1).max(120)).min(1).max(100),
  discoveryBudgetPerRun: z.number().int().min(1).max(100),
  qualificationBudgetPerRun: z.number().int().min(1).max(200),
});
/** Wiring is available now; live usage remains an explicit operator decision. */
export function createRestaurantRuntime(
  area: RestaurantArea,
  env: NodeJS.ProcessEnv = process.env,
): RestaurantAdapters {
  if (env.FEATURE_RESTAURANT_DISCOVERY_WORKER !== "true" || !area.enabled)
    throw new Error("Restaurant worker is disabled.");
  if (env.RESTAURANT_PROVIDER_POLICY_APPROVED !== "true")
    throw new Error("Restaurant provider policy approval is required.");
  const config = liveConfig.parse(area.config);
  const key = z.string().min(1).parse(env.GOOGLE_PLACES_SERVER_API_KEY);
  const anthropic = z.string().min(1).parse(env.ANTHROPIC_API_KEY);
  return {
    discovery: createGooglePlacesDiscoveryAdapter(key, {
      legalAcknowledged: true,
      maxPages: 1,
      areaRectangle: config.areaRectangle,
    }),
    qualification: createGooglePlacesQualificationAdapter(key, {
      legalAcknowledged: true,
      timeZone: area.timezone,
    }),
    copy: createAnthropicCopyAdapter(anthropic, "restaurant-v2", {
      model: requireConfiguredModel(env.DAILY_PICK_LLM_MODEL),
    }),
  };
}
