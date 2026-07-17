import type { Metadata } from "next";
import "./globals.css";

const title = "PH E-commerce Profitability Calculator";
const description =
  "Your quick local e-commerce profitability calculator.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1664, height: 960, alt: "PH E-commerce Profitability Calculator" }],
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
