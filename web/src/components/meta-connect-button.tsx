"use client";

import { useState } from "react";

type MetaConnectButtonProps = {
  buttonLabel?: string;
};

export function MetaConnectButton({
  buttonLabel = "Conectar cuenta de Instagram",
}: MetaConnectButtonProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  function startOauth() {
    setIsRedirecting(true);
    window.location.assign("/api/meta/oauth/start");
  }

  return (
    <button
      type="button"
      className="button button-primary"
      onClick={startOauth}
      disabled={isRedirecting}
    >
      {isRedirecting ? "Redirigiendo a Instagram..." : buttonLabel}
    </button>
  );
}
