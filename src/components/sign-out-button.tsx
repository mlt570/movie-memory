"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl: "/" });
      }}
      className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium transition hover:bg-stone-100 disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-900"
    >
      {pending ? "Signing out…" : "Log out"}
    </button>
  );
}
