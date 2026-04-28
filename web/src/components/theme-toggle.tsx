"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "insta-cli-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme: Theme = storedTheme === "light" ? "light" : "dark";

    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  }

  const switchingToLight = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={switchingToLight ? "Activar modo dia" : "Activar modo oscuro"}
      title={switchingToLight ? "Modo dia" : "Modo oscuro"}
    >
      <span
        className={
          switchingToLight
            ? "theme-toggle-icon theme-toggle-icon-sun"
            : "theme-toggle-icon theme-toggle-icon-moon"
        }
        aria-hidden="true"
      />
      <span className="theme-toggle-label">
        {switchingToLight ? "Modo dia" : "Modo oscuro"}
      </span>
    </button>
  );
}
