"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // Come back to "/", which sends the user to onboarding or the dashboard.
        void signIn("google", { callbackUrl: "/" });
      }}
      className="rounded-full bg-foreground px-6 py-3 font-medium text-background transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Sign in with Google"}
    </button>
  );
}
