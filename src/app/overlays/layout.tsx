import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Source navigateur OBS : page nue, fond transparent, aucun habillage du site.
export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: "transparent" }}>
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}
