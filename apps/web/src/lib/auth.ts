import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db, schema } from "@taiwanhub/database";
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
      preferredLanguage: { type: "string", defaultValue: "en" },
      homeCityId: { type: "string", required: false },
      bio: { type: "string", required: false },
    },
  },
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  plugins: [bearer()],
  rateLimit: { enabled: true, storage: "database", modelName: "authRateLimit" },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(schema.analyticsEvent)
            .values({ userId: user.id, name: "user_signed_up" });
        },
      },
    },
  },
});
