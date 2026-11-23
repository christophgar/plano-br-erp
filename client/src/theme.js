// Preferência visual reutilizável. Nenhum dado de login é salvo em localStorage.
import { useEffect, useState } from "react";

const storageKey = "vertice-theme";
const systemTheme = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function savedTheme() {
  // O navegador pode bloquear o armazenamento; nesse caso, usa o tema do dispositivo.
  try {
    const value = localStorage.getItem(storageKey);
    return ["light", "dark"].includes(value) ? value : null;
  } catch {
    return null;
  }
}

// Aplica o tema antes da primeira tela; guarda apenas a preferência visual.
const initialTheme = savedTheme() || systemTheme();
document.documentElement.dataset.theme = initialTheme;

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    // O CSS único lê data-theme="dark" para aplicar as cores escuras.
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // Segue o sistema enquanto não houver escolha salva e sincroniza outras abas.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (!savedTheme()) setTheme(systemTheme());
    };
    const syncTabs = (event) => {
      if (event.key === storageKey || event.key === null)
        setTheme(savedTheme() || systemTheme());
    };
    media.addEventListener("change", followSystem);
    window.addEventListener("storage", syncTabs);
    return () => {
      media.removeEventListener("change", followSystem);
      window.removeEventListener("storage", syncTabs);
    };
  }, []);

  function toggleTheme() {
    // Atualiza a tela imediatamente e salva só a palavra light ou dark para a próxima visita.
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Tema funciona mesmo sem armazenamento. */
    }
  }
  return { theme, toggleTheme };
}
