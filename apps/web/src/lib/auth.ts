import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP } from "better-auth/plugins";
import { db, schema } from "@taiwanhub/database";
import { resolveMailer } from "./mail";
import { hasLiveInvitationForEmail } from "@/features/membership/repository";
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // disableSignUp keeps existing password logins working while permanently
  // closing public account creation (plan section 6, rule 2).
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    disableSignUp: true,
  },
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
  plugins: [
    bearer(),
    // disableSignUp is deliberately left false here: our own
    // /api/v1/membership/join/email/* endpoints call auth.api.sendVerificationOTP
    // and auth.api.signInEmailOTP in-process for a legitimately invited email
    // that has no account yet, and disableSignUp would silently no-op sending
    // for exactly that case (see docs/adr/0001, section on account-creation
    // paths). The public native endpoints are blocked at the HTTP layer
    // instead (apps/web/src/app/api/auth/[...all]/route.ts); the
    // databaseHooks.user.create.before gate below is the actual backstop that
    // decides whether an account may be created at all, for every path
    // including this one and Google.
    emailOTP({
      disableSignUp: false,
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "sign-in") return;
        await resolveMailer().send({
          to: email,
          kind: "membership_otp",
          subject: "Your TaiwanHub code",
          text: `Your one-time code is ${otp}. It expires in 5 minutes.`,
        });
      },
    }),
  ],
  rateLimit: { enabled: true, storage: "database", modelName: "authRateLimit" },
  databaseHooks: {
    user: {
      create: {
        // The actual admission gate: every account-creation call site funnels
        // through here (OTP sign-in, Google's first-time callback, and any
        // future path), and vetoing is a pure read with no atomicity
        // concerns (see docs/adr/0001-membership-invitation-auth-transaction-boundary.md
        // section 2.2). Confirming admission and issuing a usable session is
        // handled separately, in features/membership/service.ts.
        before: async (user) => {
          const email = (user.email ?? "").toLowerCase();
          if (!email || !(await hasLiveInvitationForEmail(email)))
            return false;
        },
        after: async (user) => {
          await db
            .insert(schema.analyticsEvent)
            .values({ userId: user.id, name: "user_signed_up" });
        },
      },
    },
  },
});
