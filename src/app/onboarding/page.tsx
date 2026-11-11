import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  // First-time only: users who already picked a movie go straight to the dashboard.
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          One quick question before we get started.
        </p>
      </div>
      <OnboardingForm />
    </main>
  );
}
