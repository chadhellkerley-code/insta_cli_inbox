"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type PopupPayload = {
  type: "meta-instagram-oauth";
  status: "success" | "error";
  message: string;
  username?: string;
  helpUrl?: string;
};

type MetaConnectButtonProps = {
  buttonLabel?: string;
};

export function MetaConnectButton({
  buttonLabel = "Conectar cuenta de Instagram",
}: MetaConnectButtonProps) {
  const router = useRouter();
  const [isOpening, setIsOpening] = useState(false);
  const [feedback, setFeedback] = useState<PopupPayload | null>(null);

  function buildPopupFeatures() {
    const width = 640;
    const height = 760;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);

    return [
      `width=${Math.round(width)}`,
      `height=${Math.round(height)}`,
      `left=${Math.round(left)}`,
      `top=${Math.round(top)}`,
      "popup=yes",
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent<PopupPayload>) {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== "meta-instagram-oauth") {
        return;
      }

      setIsOpening(false);
      setFeedback(event.data);
      router.refresh();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  function openPopup() {
    setFeedback(null);
    setIsOpening(true);

    const popup = window.open(
      "/api/meta/oauth/start",
      "meta-instagram-oauth",
      buildPopupFeatures(),
    );

    if (!popup) {
      setIsOpening(false);
      setFeedback({
        type: "meta-instagram-oauth",
        status: "error",
        message: "Tu navegador bloqueo el popup de Meta. Habilitalo e intenta otra vez.",
      });
      return;
    }

    const timer = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }

      window.clearInterval(timer);
      setIsOpening(false);
    }, 500);
  }

  return (
    <div className="connect-action">
      <button
        type="button"
        className="button button-primary"
        onClick={openPopup}
        disabled={isOpening}
      >
        {isOpening ? "Abriendo Meta..." : buttonLabel}
      </button>

      {feedback ? (
        <div className={feedback.status === "success" ? "feedback success" : "feedback error"}>
          <p>{feedback.message}</p>
          {feedback.helpUrl ? (
            <p className="feedback-link-row">
              <Link href={feedback.helpUrl} target="_blank" rel="noreferrer">
                Ver instrucciones para convertir la cuenta a Professional
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
