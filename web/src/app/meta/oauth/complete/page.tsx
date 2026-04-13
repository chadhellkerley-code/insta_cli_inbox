import { Suspense } from "react";

import { MetaOauthCompleteClient } from "@/components/meta-oauth-complete-client";

type SearchParams = {
  status?: string;
  message?: string;
  helpUrl?: string;
};

function MetaOauthCompleteContent({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const status = searchParams?.status === "success" ? "success" : "error";
  const message =
    searchParams?.message ??
    (status === "success"
      ? "Cuenta conectada correctamente. El username real se sincronizara cuando llegue metadata confiable."
      : "No pudimos completar la conexion.");

  return (
    <MetaOauthCompleteClient
      status={status}
      message={message}
      helpUrl={searchParams?.helpUrl}
    />
  );
}

export default function MetaOauthCompletePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  return (
    <Suspense fallback={null}>
      <MetaOauthCompleteContent searchParams={searchParams} />
    </Suspense>
  );
}
