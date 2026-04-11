"use client";

import { useEffect } from "react";

type SyncAccount = {
  id: string;
};

type InstagramWebhookSubscriptionSyncProps = {
  accounts: SyncAccount[];
};

export function InstagramWebhookSubscriptionSync({
  accounts,
}: InstagramWebhookSubscriptionSyncProps) {
  useEffect(() => {
    let isCancelled = false;

    async function syncAllAccounts() {
      for (const account of accounts) {
        if (isCancelled) {
          return;
        }

        try {
          await fetch(`/api/instagram/accounts/${account.id}/subscription`, {
            method: "POST",
          });
        } catch {
          // Silent retry path: the server route already returns actionable errors
          // and the next visit or reconnect will try again.
        }
      }
    }

    if (accounts.length > 0) {
      void syncAllAccounts();
    }

    return () => {
      isCancelled = true;
    };
  }, [accounts]);

  return null;
}
