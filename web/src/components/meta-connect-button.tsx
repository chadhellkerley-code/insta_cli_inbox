"use client";

import { useState } from "react";

type MetaConnectButtonProps = {
  buttonLabel?: string;
  startPath?: string;
  redirectingLabel?: string;
};

export function MetaConnectButton({
  buttonLabel = "Conectar con Instagram (token 60 dias)",
  startPath = "/api/instagram/oauth/start",
  redirectingLabel = "Redirigiendo...",
}: MetaConnectButtonProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  function startOauth() {
    setIsRedirecting(true);
    window.location.assign(startPath);
  }

  return (
    <button
      type="button"
      className="button button-primary"
      onClick={startOauth}
      disabled={isRedirecting}
    >
      {isRedirecting ? `${redirectingLabel} a Instagram...` : buttonLabel}
    </button>
  );
}
