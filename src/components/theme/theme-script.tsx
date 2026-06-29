const themeScript = `
(() => {
  try {
    const savedTheme = window.localStorage.getItem("adstart-w3-theme");
    const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;

export function ThemeScript({ nonce }: { nonce?: string | null }) {
  return (
    <script
      nonce={nonce ?? undefined}
      dangerouslySetInnerHTML={{ __html: themeScript }}
    />
  );
}
