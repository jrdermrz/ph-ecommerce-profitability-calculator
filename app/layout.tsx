import type { Metadata } from "next";
import "./globals.css";

const title = "KitaKalkula — PH E-commerce Net Income Calculator";
const description =
  "Quick net income estimates for Philippine COD e-commerce product runs.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1664, height: 960, alt: "KitaKalkula net income calculator" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fil">
      <body>{children}</body>
    </html>
  );
}
